// @ts-check
// Download da mídia recebida, logo no recebimento (a URL da mídia do WhatsApp expira). Base: o
// `baixarComPrazo`/`lerConteudo` do gateway do apice-financeiro-wa-wa-back e o
// `downloadMediaMessage` com `reuploadRequest` do comandax_crm_wa_back.
//
// - Em stream, nunca em modo "buffer": o `fileLength` declarado pode faltar ou mentir, e o modo
//   "buffer" do Baileys lê o arquivo inteiro antes de qualquer conferência. Aqui os chunks são
//   somados e, ao passar do teto, o stream é destruído (o resto nunca é baixado).
// - `reuploadRequest: sock.updateMediaMessage`: o Baileys pede ao aparelho do remetente que reenvie
//   a mídia cuja URL já expirou.
// - Prazo total (obter o stream + ler): estourou, o stream é destruído, inclusive se só chegar depois.
// - Tudo em memória: nada é gravado em disco.
//
// O teto e o prazo são parâmetros (`MIDIA_TETO_BYTES`, `MIDIA_PRAZO_MS`), não regra fixa no código.
// O teto é técnico, do processo (proteção de memória). O limite por empresa (parâmetros de mídia e de
// documento do superadmin) é conferido pelo back, que recusa o excesso em `/interno/midia` e no envio.
const pino = require("pino");
const { validarMidia, duracaoOggOpusSegundos } = require("./tipoMidia");

/** Teto técnico padrão do processo (Fase 58): 100 MiB por arquivo, o maior limite que o back aceita. */
const TETO_PADRAO_BYTES = 100 * 1024 * 1024;
/** Prazo total do download (stream lento ou parado não trava a fila de entrada para sempre). */
const PRAZO_PADRAO_MS = 60 * 1000;

const loggerBaileys = pino({ level: "silent" });

/** @typedef {"DOWNLOAD_FALHOU" | "PRAZO_ESGOTADO" | "ACIMA_DO_TETO"} CodigoErroMidia */
/** @typedef {CodigoErroMidia | import("./tipoMidia").MotivoRecusaMidia} MotivoPendenciaMidia */
/** @typedef {{ tetoBytes: number, prazoMs: number }} LimitesMidia */
/** @typedef {(waMessage: any, tipo: "stream", opcoes: object, contexto: { logger: any, reuploadRequest: any }) => Promise<any>} FuncaoDownload */
/** @typedef {import("./filtroEntrada").MetadadosMidia} MetadadosMidia */
/**
 * @typedef {{ ok: true, buffer: Buffer, mimetype: string, tamanho_bytes: number, nome_arquivo: string | null, duracao_segundos: number | null }
 *   | { ok: false, motivo: MotivoPendenciaMidia }} ResultadoMidia
 */

class ErroMidia extends Error {
  /**
   * @param {CodigoErroMidia} codigo
   * @param {string} mensagem sempre genérica (o erro do Baileys pode trazer JID ou URL)
   */
  constructor(codigo, mensagem) {
    super(mensagem);
    this.name = "ErroMidia";
    this.codigo = codigo;
  }
}

/**
 * @param {string | undefined} valor
 * @param {number} padrao
 */
function inteiroPositivo(valor, padrao) {
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 ? n : padrao;
}

/**
 * Teto e prazo do download, lidos do ambiente a cada chamada (padrões: 100 MiB e 60 s).
 * @returns {LimitesMidia}
 */
function obterLimitesMidia() {
  return {
    tetoBytes: inteiroPositivo(process.env.MIDIA_TETO_BYTES, TETO_PADRAO_BYTES),
    prazoMs: inteiroPositivo(process.env.MIDIA_PRAZO_MS, PRAZO_PADRAO_MS),
  };
}

/** @returns {FuncaoDownload} */
function downloadDoBaileys() {
  // Carga tardia, como no BaileysAdapter: os testes trocam o pacote via `require.cache`.
  return require("@whiskeysockets/baileys").downloadMediaMessage;
}

/** @param {any} stream */
function destruir(stream) {
  if (stream && !stream.destroyed && typeof stream.destroy === "function") stream.destroy();
}

/**
 * Junta os chunks em memória com contador; ao passar do teto destrói o stream (para de baixar).
 * @param {AsyncIterable<any> & { destroy?: () => void, destroyed?: boolean }} stream
 * @param {number} tetoBytes
 * @returns {Promise<Buffer>}
 */
async function lerComTeto(stream, tetoBytes) {
  /** @type {Buffer[]} */
  const partes = [];
  let total = 0;
  try {
    for await (const chunk of stream) {
      const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += b.length;
      if (total > tetoBytes) throw new ErroMidia("ACIMA_DO_TETO", "Mídia acima do tamanho máximo.");
      partes.push(b);
    }
  } finally {
    destruir(stream); // fim, teto ou erro de leitura: nenhuma conexão fica pendurada
  }
  return Buffer.concat(partes, total);
}

/**
 * Baixa a mídia de uma mensagem recebida, em stream e em memória, dentro do teto e do prazo.
 * @param {{ updateMediaMessage?: any }} sock socket da equipe que recebeu (para o `reuploadRequest`)
 * @param {any} waMessage WAMessage original do `messages.upsert`
 * @param {LimitesMidia & { baixar?: FuncaoDownload }} opcoes `baixar` só para testes
 * @returns {Promise<Buffer>}
 * @throws {ErroMidia} `ACIMA_DO_TETO`, `PRAZO_ESGOTADO` ou `DOWNLOAD_FALHOU`
 */
async function baixarMidia(sock, waMessage, { tetoBytes, prazoMs, baixar = downloadDoBaileys() }) {
  let expirado = false;
  /** @type {any} */
  let streamAtual = null;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  /** @type {Promise<never>} */
  const prazo = new Promise((_, reject) => {
    timer = setTimeout(() => {
      expirado = true;
      destruir(streamAtual);
      reject(new ErroMidia("PRAZO_ESGOTADO", "Tempo esgotado ao baixar a mídia."));
    }, prazoMs); // sem unref: o prazo precisa vencer mesmo com nada mais no event loop (limpo no finally)
  });

  async function operar() {
    /** @type {any} */
    let stream;
    try {
      stream = await baixar(waMessage, "stream", {}, { logger: loggerBaileys, reuploadRequest: sock.updateMediaMessage });
    } catch {
      throw new ErroMidia("DOWNLOAD_FALHOU", "Falha ao baixar a mídia do WhatsApp.");
    }
    streamAtual = stream;
    if (expirado) {
      destruir(stream); // chegou depois do prazo: descarta sem ler
      return Buffer.alloc(0);
    }
    if (typeof stream?.[Symbol.asyncIterator] !== "function") {
      throw new ErroMidia("DOWNLOAD_FALHOU", "O download da mídia não devolveu um stream.");
    }
    try {
      return await lerComTeto(stream, tetoBytes);
    } catch (erro) {
      if (erro instanceof ErroMidia) throw erro;
      throw new ErroMidia(expirado ? "PRAZO_ESGOTADO" : "DOWNLOAD_FALHOU", "Falha ao ler a mídia do WhatsApp.");
    }
  }

  const operacao = operar();
  operacao.catch(() => {}); // perdeu a corrida para o prazo: a rejeição tardia não fica sem tratamento
  try {
    return await Promise.race([operacao, prazo]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Baixa e valida a mídia de uma mensagem recebida. Nunca rejeita: devolve o buffer com o tipo
 * detectado, o tamanho real e a duração (real no OGG/Opus), ou o motivo de a mídia ficar pendente.
 * Um tamanho declarado acima do teto é recusado sem começar o download.
 * @param {{ updateMediaMessage?: any }} sock
 * @param {any} waMessage
 * @param {MetadadosMidia} midia metadados declarados (da MensagemRecebida)
 * @param {LimitesMidia & { baixar?: FuncaoDownload, documentoGenerico?: boolean }} opcoes `documentoGenerico`: mensagem DOCUMENTO aceita qualquer arquivo
 * @returns {Promise<ResultadoMidia>}
 */
async function obterMidiaValidada(sock, waMessage, midia, opcoes) {
  if (typeof midia.tamanho_bytes === "number" && midia.tamanho_bytes > opcoes.tetoBytes) return { ok: false, motivo: "ACIMA_DO_TETO" };

  /** @type {Buffer} */
  let buffer;
  try {
    buffer = await baixarMidia(sock, waMessage, opcoes);
  } catch (erro) {
    return { ok: false, motivo: erro instanceof ErroMidia ? erro.codigo : "DOWNLOAD_FALHOU" };
  }

  const validacao = validarMidia(buffer, midia.mimetype, opcoes.tetoBytes, { documentoGenerico: opcoes.documentoGenerico });
  if (!validacao.ok) return validacao;

  const duracaoReal = validacao.mimetype === "audio/ogg" ? duracaoOggOpusSegundos(buffer) : null;
  return {
    ok: true,
    buffer,
    mimetype: validacao.mimetype,
    tamanho_bytes: validacao.tamanho_bytes,
    nome_arquivo: midia.nome_arquivo,
    duracao_segundos: duracaoReal !== null ? Math.round(duracaoReal) : midia.duracao_segundos,
  };
}

module.exports = { baixarMidia, obterMidiaValidada, obterLimitesMidia, ErroMidia, TETO_PADRAO_BYTES, PRAZO_PADRAO_MS };
