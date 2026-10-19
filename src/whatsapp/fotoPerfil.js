// @ts-check
// Miniatura da foto de perfil (Fase 32, Task 32.1, contrato D2), só a "preview" do Baileys 6.7.24.
// Fluxo: `profilePictureUrl(jid, "preview", prazo)` -> sem URL, ou Boom com `data` 401 (privacidade) / 404
// (sem foto) -> SEM_FOTO; `rate-overlimit` (429) -> LIMITE_WHATSAPP. A URL só é seguida quando é https, de um
// host terminado em ".whatsapp.net", sem credencial nem porta (anti-SSRF), com `redirect: "error"` (um
// redirecionamento nunca é seguido), prazo e teto técnico de leitura. O tipo vem do CONTEÚDO (JPEG, PNG ou
// WebP, `tipoMidia.js`); o que não for imagem é SEM_FOTO.
// Nada em disco, nenhum cache de imagem e nenhum log: a URL do CDN, o JID e o LID não saem desta função
// (quem chama decide o que registrar, e só com `cod_equipe` e código).
const { detectarTipoPorConteudo } = require("./tipoMidia");
const { comPrazo, statusDoErro } = require("./grupoGestao");

/** Prazo técnico (IQ de `profilePictureUrl` e, separadamente, download da imagem). Não é regra de negócio. */
const MS_PRAZO_FOTO = 10_000;
/** Teto técnico da miniatura em bytes (a "preview" do WhatsApp tem poucos KB). Não é limite de produto. */
const TETO_FOTO_BYTES = 100 * 1024;
/** Sufixo do host do CDN de fotos do WhatsApp (ex.: `pps.whatsapp.net`, `mmg.whatsapp.net`). */
const HOST_PERMITIDO = ".whatsapp.net";
const TIPOS_ACEITOS = new Set(["image/jpeg", "image/png", "image/webp"]);

const MENSAGENS_ERRO_FOTO = {
  PRAZO_ESGOTADO: "A consulta da foto não respondeu.",
  LIMITE_WHATSAPP: "O WhatsApp limitou as consultas. Tente mais tarde.",
  FALHA: "Não foi possível consultar a foto.",
};

/** Falha da consulta da foto; a mensagem não leva URL, JID nem LID. */
class ErroFoto extends Error {
  /** @param {keyof typeof MENSAGENS_ERRO_FOTO} codigo */
  constructor(codigo) {
    super(MENSAGENS_ERRO_FOTO[codigo]);
    this.name = "ErroFoto";
    this.codigo = codigo;
  }
}

/** @typedef {{ situacao: "SEM_FOTO" } | { situacao: "COM_FOTO", mimetype: string, conteudo_base64: string }} ResultadoFoto */
/**
 * Parte da `Response` do fetch que a leitura usa (os testes injetam um objeto simples).
 * @typedef {{ ok: boolean, status: number, headers: { get: (nome: string) => string | null }, body: AsyncIterable<any> | null }} RespostaFoto
 */
/** @typedef {(url: string, init: { redirect: "error", signal: AbortSignal }) => Promise<RespostaFoto>} FuncaoBaixarFoto */

const SEM_FOTO = /** @type {const} */ ({ situacao: "SEM_FOTO" });

/**
 * A URL pode ser seguida? https, host `*.whatsapp.net` (sufixo exato, minúsculas), porta padrão e sem credencial.
 * @param {unknown} valor
 * @returns {boolean}
 */
function urlPermitida(valor) {
  if (typeof valor !== "string") return false;
  let url;
  try {
    url = new URL(valor);
  } catch {
    return false;
  }
  return url.protocol === "https:" && url.port === "" && url.username === "" && url.password === "" && url.hostname.endsWith(HOST_PERMITIDO) && url.hostname.length > HOST_PERMITIDO.length;
}

/** @type {FuncaoBaixarFoto} */
const baixarPadrao = (url, init) => /** @type {Promise<RespostaFoto>} */ (/** @type {unknown} */ (fetch(url, init)));

/**
 * O `fetch` com `redirect: "error"` rejeita com `TypeError("fetch failed")` e `cause` "unexpected redirect".
 * @param {unknown} erro
 */
function foiRedirecionamento(erro) {
  const causa = erro && typeof erro === "object" ? /** @type {{ cause?: { message?: unknown } }} */ (erro).cause : undefined;
  return causa?.message === "unexpected redirect";
}

/**
 * Lê o corpo em memória com contador; ao passar do teto sai do laço (o `for await` encerra o stream).
 * @param {AsyncIterable<any>} corpo
 * @param {number} tetoBytes
 * @returns {Promise<Buffer | null>} null quando passou do teto
 */
async function lerComTeto(corpo, tetoBytes) {
  /** @type {Buffer[]} */
  const partes = [];
  let total = 0;
  for await (const chunk of corpo) {
    const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += b.length;
    if (total > tetoBytes) return null;
    partes.push(b);
  }
  return Buffer.concat(partes, total);
}

/**
 * Baixa a imagem (https, host permitido, sem redirecionar) dentro do prazo e do teto.
 * @param {string} url
 * @param {{ msPrazo: number, tetoBytes: number, baixar: FuncaoBaixarFoto }} opcoes
 * @returns {Promise<ResultadoFoto>}
 * @throws {ErroFoto} PRAZO_ESGOTADO, LIMITE_WHATSAPP ou FALHA
 */
async function baixarImagem(url, { msPrazo, tetoBytes, baixar }) {
  const controle = new AbortController();
  let expirado = false;
  const timer = setTimeout(() => {
    expirado = true;
    controle.abort();
  }, msPrazo);
  try {
    const resposta = await baixar(url, { redirect: "error", signal: controle.signal });
    if (resposta.status === 429) throw new ErroFoto("LIMITE_WHATSAPP");
    if (!resposta.ok) {
      if (resposta.status >= 400 && resposta.status < 500) return SEM_FOTO; // URL vencida ou foto removida
      throw new ErroFoto("FALHA");
    }
    const declarado = Number(resposta.headers.get("content-length"));
    if (!resposta.body || (Number.isFinite(declarado) && declarado > tetoBytes)) {
      await /** @type {{ cancel?: () => Promise<void> } | null} */ (resposta.body)?.cancel?.().catch(() => {});
      return SEM_FOTO;
    }
    const conteudo = await lerComTeto(resposta.body, tetoBytes);
    if (!conteudo) return SEM_FOTO;
    const mimetype = detectarTipoPorConteudo(conteudo);
    if (!mimetype || !TIPOS_ACEITOS.has(mimetype)) return SEM_FOTO;
    return { situacao: "COM_FOTO", mimetype, conteudo_base64: conteudo.toString("base64") };
  } catch (erro) {
    if (erro instanceof ErroFoto) throw erro;
    if (expirado) throw new ErroFoto("PRAZO_ESGOTADO");
    if (foiRedirecionamento(erro)) return SEM_FOTO;
    throw new ErroFoto("FALHA");
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Miniatura (preview) da foto de perfil de um JID (pessoa ou grupo).
 * @param {{ profilePictureUrl?: (jid: string, tipo?: "preview" | "image", timeoutMs?: number) => Promise<string | undefined> }} socket
 * @param {string} jid
 * @param {{ msPrazo?: number, tetoBytes?: number, baixar?: FuncaoBaixarFoto }} [opcoes] `baixar` só para testes
 * @returns {Promise<ResultadoFoto>}
 * @throws {ErroFoto} PRAZO_ESGOTADO (IQ ou download), LIMITE_WHATSAPP (`rate-overlimit`) ou FALHA
 */
async function obterPreview(socket, jid, { msPrazo = MS_PRAZO_FOTO, tetoBytes = TETO_FOTO_BYTES, baixar = baixarPadrao } = {}) {
  const consultar = socket?.profilePictureUrl;
  if (typeof consultar !== "function") throw new ErroFoto("FALHA");
  /** @type {string | undefined} */
  let url;
  try {
    url = await comPrazo(Promise.resolve().then(() => consultar.call(socket, jid, "preview", msPrazo)), msPrazo);
  } catch (erro) {
    if (erro instanceof Error && erro.name === "TimeoutError") throw new ErroFoto("PRAZO_ESGOTADO");
    const status = statusDoErro(erro);
    if (status === 401 || status === 404) return SEM_FOTO; // privacidade ou sem foto
    if (status === 429) throw new ErroFoto("LIMITE_WHATSAPP");
    throw new ErroFoto("FALHA");
  }
  if (!url || !urlPermitida(url)) return SEM_FOTO;
  return baixarImagem(url, { msPrazo, tetoBytes, baixar });
}

module.exports = { obterPreview, urlPermitida, foiRedirecionamento, ErroFoto, MS_PRAZO_FOTO, TETO_FOTO_BYTES, HOST_PERMITIDO };
