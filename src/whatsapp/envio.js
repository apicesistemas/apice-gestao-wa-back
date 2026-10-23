// @ts-check
// Pipeline de saída (Task 7.2): o conteúdo destinado ao cliente vira o conteúdo do Baileys 6.7.24 e
// sai pelo socket da equipe. Base: `enviarTexto/enviarDocumento/enviarImagem/enviarAudio` do gateway
// do apice-financeiro-wa-wa-back (envio sem disco) e o `enviarMensagem` do comandax_crm_wa_back.
//
// Regras:
// - só o conteúdo do cliente entra aqui: `montarConteudo` copia campo a campo (texto, mídia, legenda,
//   nome do arquivo, nota de voz, menções). Nenhum outro campo chega ao `sendMessage`;
// - o id é gerado ANTES do envio (`generateMessageIDV2`) e marcado no adapter (`marcarEnviadaPeloCrm`:
//   cache de eco e retenção dos recibos) ANTES do `sendMessage`, que recebe `messageId`: o eco pode
//   chegar pelo `messages.upsert` antes de o `sendMessage` devolver;
// - o envio vai para o `chat_jid` da conversa como ele chegou (LID, telefone ou grupo), que é o
//   remoteJid em que o contato fala com a equipe. Nada de resolver por telefone aqui;
// - nada em disco: imagem e vídeo com `jpegThumbnail: null` (senão o Baileys grava o original na
//   pasta temporária para gerar a miniatura) e áudio sempre com `seconds` (senão ele grava para medir);
// - Exceção aceita pelo responsável do projeto em 2026-10-14: o Baileys grava temporário cifrado
//   durante o upload de mídia; a recepção e o restante do pipeline continuam sem disco. O arquivo
//   (`<tipo><id>-enc`, do `encryptedStream`) cai na pasta dedicada de `tmpMidia` e o Baileys o apaga
//   ao fim do upload. O upload tem prazo (`mediaUploadTimeoutMs` = prazo do envio; sem ele o axios
//   do Baileys espera para sempre) e passa pelo rastreador de uploads, que varre a pasta quando o
//   último termina (cobre o órfão da corrida do Baileys). Boot e desligamento também limpam a pasta;
// - o Baileys não emite SERVER_ACK para os envios do próprio socket: o sucesso do `sendMessage` já é
//   o status ENVIADA;
// - o `sendMessage` tem prazo (ENVIO_PRAZO_MS, padrão 90 s, abaixo dos 120 s do back): passado o
//   prazo, o envio responde ENVIO_NAO_CONFIRMADO ("Envio não confirmado.", HTTP 504), porque a
//   mensagem PODE ter saído. Se ele terminar depois, o resultado só alimenta o cache de reenvio;
// - o `message` devolvido pelo `sendMessage` vai ao cache de reenvio do adapter (`guardarEnviada`),
//   que atende o `getMessage` do Baileys ("Aguardando mensagem" no aparelho do cliente);
// - uma mensagem por chamada (nada de envio em massa). Erros saem como `ErroEnvio` com mensagem
//   genérica em pt-BR (o erro do Baileys pode trazer JID ou telefone e só vai ao log pelo nome).
const { normalizarJid, lidDe, telefoneDe, mensagemWaIdValido } = require("./filtroEntrada");
const { duracaoOggOpusSegundos, normalizarMimetype, MIME_DOCX, MIME_XLSX, MIME_DOC, MIME_XLS, MIME_PKCS12 } = require("./tipoMidia");
const { normalizarCodEquipe } = require("./BaileysAdapter");
const tmpMidia = require("./tmpMidia");

const PADRAO_GRUPO = /^[\d-]{1,40}@g\.us$/;
/** Limites técnicos do WhatsApp (não são regra de negócio). */
const MAX_TEXTO = 65536;
const MAX_LEGENDA = 1024;
const MAX_NOME_ARQUIVO = 200;
/** Menções de uma mensagem (um grupo do WhatsApp tem no máximo 1024 participantes). */
const MAX_MENCOES = 1024;
const MIME_NOTA_DE_VOZ = "audio/ogg; codecs=opus";
/** Chaves de mídia do conteúdo Baileys (as que passam pelo upload). */
const CHAVES_MIDIA = ["image", "video", "audio", "document"];
/** Prazo técnico padrão do `sendMessage` (o back desiste em 120 s; a mídia inclui o upload). */
const PRAZO_ENVIO_PADRAO_MS = 90_000;

/** Extensão do nome do documento enviado, pelo mimetype validado. */
const EXTENSAO_DOCUMENTO = {
  "application/pdf": "pdf",
  [MIME_DOCX]: "docx",
  [MIME_XLSX]: "xlsx",
  [MIME_DOC]: "doc",
  [MIME_XLS]: "xls",
  [MIME_PKCS12]: "pfx",
};

/** Outras extensões que já valem para o mimetype (não recebem a extensão padrão no fim). */
/** @type {Record<string, string[]>} */
const EXTENSOES_EXTRAS = { [MIME_PKCS12]: ["p12"] };

/** @typedef {"CONTEUDO_INVALIDO" | "EQUIPE_NAO_ENCONTRADA" | "EQUIPE_DESCONECTADA" | "FALHA_ENVIO" | "ENVIO_NAO_CONFIRMADO"} CodigoErroEnvio */

class ErroEnvio extends Error {
  /**
   * @param {CodigoErroEnvio} codigo
   * @param {string} mensagem pt-BR, sem JID, telefone nem conteúdo
   */
  constructor(codigo, mensagem) {
    super(mensagem);
    this.name = "ErroEnvio";
    this.codigo = codigo;
  }
}

/** @param {string} mensagem */
const invalido = (mensagem) => new ErroEnvio("CONTEUDO_INVALIDO", mensagem);

/**
 * Prazo do `sendMessage` (`ENVIO_PRAZO_MS`); vazio ou inválido cai no padrão.
 * @param {Record<string, string | undefined>} [env]
 * @returns {number}
 */
function obterPrazoEnvioMs(env = process.env) {
  const valor = Number(env.ENVIO_PRAZO_MS);
  return Number.isSafeInteger(valor) && valor > 0 ? valor : PRAZO_ENVIO_PADRAO_MS;
}

/**
 * @typedef {{
 *   buffer: Buffer,
 *   mimetype: string,
 *   nome?: string | null,
 *   legenda?: string | null,
 *   ptt?: boolean,
 * }} MidiaParaEnvio mídia já validada (magic bytes e teto) pelo controller
 */
/** @typedef {{ texto: string } | { midia: MidiaParaEnvio }} ConteudoCliente */
/** @typedef {{ remoteJid: string, fromMe: boolean, id: string, participant?: string }} ChaveWa */
/** @typedef {{ key: ChaveWa, message: Record<string, any> }} MensagemCitada */
/**
 * @typedef {{
 *   user?: { id?: string, lid?: string },
 *   sendMessage: (jid: string, conteudo: any, opcoes?: any) => Promise<any>,
 * }} SocketEnvio
 */
/**
 * @typedef {{
 *   hashEmpresa: string,
 *   socketConectado: () => SocketEnvio | null,
 *   marcarEnviadaPeloCrm: (mensagemWaId: string) => void,
 *   guardarEnviada?: (mensagemWaId: string, message: any, chatJid: string) => void,
 * }} AdapterEnvio
 */
/**
 * @typedef {{
 *   obter: (codEquipe: string | number) => AdapterEnvio | null,
 *   listarRegistradas: () => { cod_equipe: string, hash_empresa: string }[],
 * }} ManagerEnvio
 */
/** @typedef {{ mensagem_wa_id: string, key: ChaveWa, timestamp_wa: number, status: "ENVIADA" }} ResultadoEnvio */

/**
 * @param {unknown} valor
 * @param {number} max
 * @returns {string | null} o texto, ou null quando ausente/vazio
 */
function textoOpcional(valor, max) {
  if (valor === undefined || valor === null || valor === "") return null;
  if (typeof valor !== "string") throw invalido("Texto inválido ou longo demais.");
  // O multipart/form-data entrega as quebras de linha como CRLF: para o WhatsApp é só "\n". Nada mais
  // muda no texto (sem trim, sem colapsar linhas), e o limite vale sobre o texto já normalizado.
  const normalizado = valor.replace(/\r\n?/g, "\n");
  if (normalizado.length > max) throw invalido("Texto inválido ou longo demais.");
  return normalizado.trim() === "" ? null : normalizado;
}

/**
 * Nome do documento: só o nome (sem pasta), sem caracteres de controle, com a extensão do tipo.
 * @param {unknown} nome
 * @param {string} mimetype
 * @returns {string}
 */
function nomeDocumento(nome, mimetype) {
  const extensao = /** @type {Record<string, string>} */ (EXTENSAO_DOCUMENTO)[mimetype] ?? "bin";
  const base =
    typeof nome === "string"
      ? (nome.split(/[\\/]/).pop() ?? "")
          .replace(/[\u0000-\u001f\u007f]/g, "")
          .trim()
          .slice(0, MAX_NOME_ARQUIVO)
      : "";
  const semPontos = base.replace(/^\.+/, "");
  if (!semPontos) return `documento.${extensao}`;
  const validas = [extensao, ...(EXTENSOES_EXTRAS[mimetype] ?? [])];
  return validas.some((e) => semPontos.toLowerCase().endsWith(`.${e}`)) ? semPontos : `${semPontos}.${extensao}`;
}

/**
 * Menções: JIDs de pessoa (telefone ou LID), sem repetição.
 * @param {unknown} mencoes
 * @returns {string[]}
 */
function validarMencoes(mencoes) {
  if (mencoes === undefined || mencoes === null) return [];
  if (!Array.isArray(mencoes) || mencoes.length > MAX_MENCOES) throw invalido("Menções inválidas.");
  const lista = mencoes.map((jid) => {
    const n = normalizarJid(jid);
    if (!n || !(lidDe(n) || telefoneDe(n))) throw invalido("Menções inválidas.");
    return n;
  });
  return [...new Set(lista)];
}

/**
 * Conteúdo Baileys a partir do conteúdo do cliente. Função pura: copia só os campos conhecidos.
 * @param {ConteudoCliente} conteudo
 * @param {{ mencoes?: string[] }} [opcoes] menções já validadas
 * @returns {Record<string, any>}
 */
function montarConteudo(conteudo, { mencoes = [] } = {}) {
  /** @type {Record<string, any>} */
  const extra = mencoes.length > 0 ? { mentions: [...mencoes] } : {};

  if (conteudo && "texto" in conteudo && !("midia" in conteudo)) {
    const texto = textoOpcional(conteudo.texto, MAX_TEXTO);
    if (!texto) throw invalido("Informe o texto da mensagem.");
    return { text: texto, ...extra };
  }

  /** @type {MidiaParaEnvio | null} */
  const midia = conteudo && "midia" in conteudo ? /** @type {{ midia: MidiaParaEnvio }} */ (conteudo).midia : null;
  if (!midia || !Buffer.isBuffer(midia.buffer) || midia.buffer.length === 0) throw invalido("Informe o conteúdo da mensagem.");
  const mimetype = normalizarMimetype(midia.mimetype);
  const legenda = textoOpcional(midia.legenda, MAX_LEGENDA);
  /** @type {Record<string, any>} */
  const caption = legenda ? { caption: legenda } : {};

  if (mimetype.startsWith("image/")) return { image: midia.buffer, mimetype, ...caption, jpegThumbnail: null, ...extra };
  if (mimetype.startsWith("video/")) return { video: midia.buffer, mimetype, ...caption, jpegThumbnail: null, ...extra };
  if (mimetype.startsWith("audio/")) {
    const ptt = midia.ptt === true;
    const ogg = mimetype === "audio/ogg";
    const duracao = ogg ? duracaoOggOpusSegundos(midia.buffer) : null;
    if (ptt && (duracao === null || !Number.isFinite(duracao))) throw invalido("A nota de voz precisa ser um áudio ogg/opus válido.");
    // `seconds` vai sempre: sem ele o Baileys grava o áudio na pasta temporária para medir a duração.
    // Fora do Ogg/Opus a duração não é lida do conteúdo e vai 0 (o player do WhatsApp mostra a real).
    const seconds = duracao === null ? 0 : Math.round(duracao);
    return { audio: midia.buffer, mimetype: ogg ? MIME_NOTA_DE_VOZ : mimetype, ptt, seconds };
  }
  if (!(mimetype in EXTENSAO_DOCUMENTO)) throw invalido("Tipo de arquivo não aceito para envio.");
  return { document: midia.buffer, mimetype, fileName: nomeDocumento(midia.nome, mimetype), ...caption, ...extra };
}

/**
 * JID da conversa: pessoa (telefone ou LID) ou grupo. Status, broadcast e newsletter não.
 * @param {unknown} chatJid
 * @returns {string}
 */
function validarChatJid(chatJid) {
  const n = normalizarJid(chatJid);
  if (!n || !(PADRAO_GRUPO.test(n) || lidDe(n) || telefoneDe(n))) throw invalido("Conversa (chat_jid) inválida.");
  return n;
}

/**
 * A key pertence à conversa? Grupo: o mesmo JID. Privada: qualquer JID de pessoa (o contato pode
 * aparecer por telefone ou por LID na mesma conversa).
 * @param {string} remoteJid
 * @param {string} chatJid já validado
 */
function mesmaConversa(remoteJid, chatJid) {
  const n = normalizarJid(remoteJid);
  if (!n) return false;
  if (PADRAO_GRUPO.test(chatJid) || PADRAO_GRUPO.test(n)) return n === chatJid;
  return Boolean(lidDe(n) || telefoneDe(n));
}

/**
 * Valida uma key Baileys de mensagem e devolve só os campos dela.
 * @param {any} key
 * @param {string} chatJid já validado
 * @returns {ChaveWa}
 */
function validarKey(key, chatJid) {
  if (!key || typeof key !== "object" || Array.isArray(key)) throw invalido("Mensagem de referência (key) inválida.");
  const { remoteJid, fromMe, id, participant } = key;
  if (typeof remoteJid !== "string" || typeof fromMe !== "boolean" || !mensagemWaIdValido(id)) throw invalido("Mensagem de referência (key) inválida.");
  if (!mesmaConversa(remoteJid, chatJid)) throw invalido("A mensagem de referência é de outra conversa.");
  if (participant !== undefined && participant !== null && (typeof participant !== "string" || !normalizarJid(participant))) {
    throw invalido("Mensagem de referência (key) inválida.");
  }
  /** @type {ChaveWa} */
  const copia = { remoteJid, fromMe, id };
  if (typeof participant === "string" && participant !== "") copia.participant = participant;
  return copia;
}

/**
 * Desfaz a serialização JSON do back (paraJson/BufferJSON do Baileys): `{ type: "Buffer", data }`
 * (base64 ou array) volta a ser Buffer, em qualquer profundidade.
 * @param {any} valor
 * @param {number} [profundidade]
 * @returns {any}
 */
function reviverBuffers(valor, profundidade = 0) {
  if (profundidade > 32 || !valor || typeof valor !== "object") return valor;
  if (valor.type === "Buffer" || valor.buffer === true) {
    const dados = valor.data ?? valor.value;
    return typeof dados === "string" ? Buffer.from(dados, "base64") : Buffer.from(Array.isArray(dados) ? dados : []);
  }
  if (Array.isArray(valor)) return valor.map((item) => reviverBuffers(item, profundidade + 1));
  /** @type {Record<string, any>} */
  const copia = {};
  for (const [chave, item] of Object.entries(valor)) copia[chave] = reviverBuffers(item, profundidade + 1);
  return copia;
}

/**
 * WAMessage citado (`quoted`) a partir do que o back guardou: só `key` e `message`.
 * @param {any} citacao `{ key, message }` (o WAMessage original guardado pelo back)
 * @param {string} chatJid já validado
 * @returns {MensagemCitada | null}
 */
function montarCitacao(citacao, chatJid) {
  if (citacao === undefined || citacao === null) return null;
  if (typeof citacao !== "object" || Array.isArray(citacao)) throw invalido("Citação inválida.");
  const key = validarKey(citacao.key, chatJid);
  const message = citacao.message;
  if (!message || typeof message !== "object" || Array.isArray(message) || Object.keys(message).length === 0) {
    throw invalido("A citação precisa da mensagem original.");
  }
  return { key, message: reviverBuffers(message) };
}

/**
 * Socket da equipe para envio, conferindo o tenant. Equipe de outro tenant → EQUIPE_NAO_ENCONTRADA;
 * sem instância ou fora de CONECTADO → EQUIPE_DESCONECTADA.
 * @param {ManagerEnvio} manager
 * @param {string | number} codEquipe
 * @param {unknown} hashEmpresa
 * @returns {{ adapter: AdapterEnvio, socket: SocketEnvio }}
 */
function obterSocketDaEquipe(manager, codEquipe, hashEmpresa) {
  if (typeof hashEmpresa !== "string" || hashEmpresa.trim() === "") throw invalido("Informe o hash_empresa da equipe.");
  let cod;
  try {
    cod = normalizarCodEquipe(codEquipe);
  } catch {
    throw invalido("Código da equipe inválido.");
  }
  const naoEncontrada = () => new ErroEnvio("EQUIPE_NAO_ENCONTRADA", "Equipe não encontrada.");
  const adapter = manager.obter(cod);
  if (adapter && adapter.hashEmpresa !== hashEmpresa) throw naoEncontrada();
  if (!adapter) {
    const registrada = manager.listarRegistradas().find((e) => e.cod_equipe === cod);
    if (registrada && registrada.hash_empresa !== hashEmpresa) throw naoEncontrada();
  }
  const socket = adapter?.socketConectado() ?? null;
  if (!adapter || !socket) throw new ErroEnvio("EQUIPE_DESCONECTADA", "O WhatsApp da equipe não está conectado.");
  return { adapter, socket };
}

/**
 * @param {any} valor timestamp (number ou Long)
 * @returns {number | null}
 */
function segundos(valor) {
  const n = typeof valor === "number" ? valor : typeof valor?.toNumber === "function" ? valor.toNumber() : Number(valor);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/**
 * Guarda o `message` enviado no cache de reenvio do adapter (nunca derruba o envio).
 * @param {AdapterEnvio} adapter
 * @param {string} id
 * @param {any} enviada retorno do `sendMessage`
 * @param {string} jid
 */
function guardarParaReenvio(adapter, id, enviada, jid) {
  try {
    const keyId = enviada?.key?.id;
    if (enviada?.message) adapter.guardarEnviada?.(mensagemWaIdValido(keyId) ? keyId : id, enviada.message, jid);
  } catch (erro) {
    console.error(`[ENVIO] Falha ao guardar a mensagem ${id} para reenvio:`, erro instanceof Error ? erro.name : "erro");
  }
}

/** @typedef {{ iniciar: () => () => void }} RastreadorUploads */

/** Marcador interno do prazo esgotado (nunca sai deste módulo). */
const PRAZO_ESGOTADO = Symbol("prazoEsgotado");

/**
 * Gera o id, marca no adapter (cache de eco e recibos) e só então chama o `sendMessage`, com prazo.
 * @param {AdapterEnvio} adapter
 * @param {SocketEnvio} socket
 * @param {string} jid
 * @param {Record<string, any>} conteudo
 * @param {Record<string, any>} [opcoes] opções do `sendMessage` (ex.: `quoted`)
 * @param {{ prazoMs?: number, rastreadorUploads?: RastreadorUploads }} [controle] prazo do `sendMessage`
 *   (padrão: ENVIO_PRAZO_MS) e rastreador dos uploads de mídia (padrão: o do processo)
 * @returns {Promise<ResultadoEnvio>}
 */
async function enviarPeloSocket(
  adapter,
  socket,
  jid,
  conteudo,
  opcoes = {},
  { prazoMs = obterPrazoEnvioMs(), rastreadorUploads = tmpMidia.rastreadorUploads } = {}
) {
  // Carga tardia, como no BaileysAdapter: os testes trocam o pacote via `require.cache`.
  const { generateMessageIDV2 } = require("@whiskeysockets/baileys");
  const id = generateMessageIDV2(socket.user?.id);
  adapter.marcarEnviadaPeloCrm(id);
  let esgotou = false;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  let enviada;
  try {
    // Mídia: o upload tem o prazo do envio e fica no rastreador até o `sendMessage` terminar de fato
    // (mesmo depois do 504), porque só então o Baileys terminou de mexer no temporário.
    const ehMidia = CHAVES_MIDIA.some((chave) => chave in conteudo);
    const opcoesEnvio = ehMidia ? { ...opcoes, messageId: id, mediaUploadTimeoutMs: prazoMs } : { ...opcoes, messageId: id };
    const concluirUpload = ehMidia ? rastreadorUploads.iniciar() : null;
    const envio = Promise.resolve().then(() => socket.sendMessage(jid, conteudo, opcoesEnvio));
    if (concluirUpload) envio.then(concluirUpload, concluirUpload);
    // Terminou depois do prazo: a mensagem saiu, então ainda serve ao pedido de reenvio.
    envio.then((tardia) => esgotou && guardarParaReenvio(adapter, id, tardia, jid)).catch(() => {});
    const prazo = new Promise((_resolve, rejeitar) => {
      timer = setTimeout(() => rejeitar(PRAZO_ESGOTADO), prazoMs); // limpo no finally
    });
    enviada = await Promise.race([envio, prazo]);
  } catch (erro) {
    if (erro === PRAZO_ESGOTADO) {
      esgotou = true;
      console.error(`[ENVIO] Prazo de ${prazoMs} ms esgotado no sendMessage da mensagem ${id}.`);
      throw new ErroEnvio("ENVIO_NAO_CONFIRMADO", "Envio não confirmado.");
    }
    const nome = erro instanceof Error ? erro.name : "erro";
    console.error(`[ENVIO] Falha no sendMessage da mensagem ${id}:`, nome);
    throw new ErroEnvio("FALHA_ENVIO", "Falha ao enviar a mensagem pelo WhatsApp.");
  } finally {
    clearTimeout(timer);
  }
  guardarParaReenvio(adapter, id, enviada, jid);
  const key = enviada?.key && typeof enviada.key === "object" ? enviada.key : null;
  /** @type {ChaveWa} */
  const chave = {
    remoteJid: typeof key?.remoteJid === "string" ? key.remoteJid : jid,
    fromMe: true,
    id: mensagemWaIdValido(key?.id) ? key.id : id,
  };
  if (typeof key?.participant === "string" && key.participant !== "") chave.participant = key.participant;
  return {
    mensagem_wa_id: chave.id,
    key: chave,
    timestamp_wa: segundos(enviada?.messageTimestamp) ?? Math.floor(Date.now() / 1000),
    status: "ENVIADA",
  };
}

/**
 * @param {{ manager?: ManagerEnvio, prazoMs?: number, rastreadorUploads?: RastreadorUploads }} [opcoes]
 *   manager das instâncias (padrão: o do processo), prazo do `sendMessage` (padrão: ENVIO_PRAZO_MS,
 *   lido a cada envio) e rastreador dos uploads de mídia (padrão: o do processo)
 */
function criarEnvio({ manager, prazoMs, rastreadorUploads } = {}) {
  /** @returns {ManagerEnvio} */
  const obterManager = () => manager ?? /** @type {ManagerEnvio} */ (/** @type {unknown} */ (require("./instanciaManager")));

  /**
   * Envia UMA mensagem do atendente ao cliente.
   * @param {string | number} codEquipe
   * @param {{
   *   hash_empresa: string,
   *   chat_jid: string,
   *   conteudo: ConteudoCliente,
   *   citacao?: MensagemCitada | null,
   *   mencoes?: string[] | null,
   * }} dados
   * @returns {Promise<ResultadoEnvio>}
   * @throws {ErroEnvio}
   */
  async function enviar(codEquipe, { hash_empresa, chat_jid, conteudo, citacao, mencoes }) {
    const jid = validarChatJid(chat_jid);
    const conteudoBaileys = montarConteudo(conteudo, { mencoes: validarMencoes(mencoes) });
    const quoted = montarCitacao(citacao, jid);
    const { adapter, socket } = obterSocketDaEquipe(obterManager(), codEquipe, hash_empresa);
    return enviarPeloSocket(adapter, socket, jid, conteudoBaileys, quoted ? { quoted } : {}, {
      prazoMs: prazoMs ?? obterPrazoEnvioMs(),
      rastreadorUploads: rastreadorUploads ?? tmpMidia.rastreadorUploads,
    });
  }

  return { enviar };
}

const padrao = criarEnvio();

module.exports = {
  enviar: padrao.enviar,
  criarEnvio,
  montarConteudo,
  montarCitacao,
  validarChatJid,
  validarKey,
  validarMencoes,
  obterSocketDaEquipe,
  enviarPeloSocket,
  obterPrazoEnvioMs,
  PRAZO_ENVIO_PADRAO_MS,
  ErroEnvio,
  EXTENSAO_DOCUMENTO,
};
