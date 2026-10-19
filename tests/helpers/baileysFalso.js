// @ts-check
// Baileys falso para os testes: substitui `@whiskeysockets/baileys` no `require.cache` (padrão do
// comandax_crm_wa_back), então nenhum teste abre conexão real com o WhatsApp nem baixa a versão do
// WhatsApp Web. Precisa ser instalado ANTES de qualquer require do código que usa o Baileys.
// Fica fora do padrão `*.test.js`, então o scripts/run-tests.js não o executa como teste.
const fs = require("node:fs");

/**
 * @typedef {{
 *   config: any,
 *   listeners: Record<string, (dado: any) => any>,
 *   removidos: string[],
 *   chamadasEnd: number,
 *   chamadasLogout: number,
 *   emitir: (evento: string, dado: any) => Promise<void>,
 * }} SocketFalso
 */

/** @type {SocketFalso[]} */
const sockets = [];
/** @type {string[]} */
const pastasAuthState = [];
/** @type {any[][]} argumentos de cada chamada ao downloadMediaMessage falso */
const downloads = [];
/** @type {(...args: any[]) => Promise<any>} */
let tratadorDownload = async () => {
  throw new Error("downloadMediaMessage falso sem tratador definido.");
};

const DisconnectReason = {
  connectionClosed: 428,
  connectionLost: 408,
  connectionReplaced: 440,
  timedOut: 408,
  loggedOut: 401,
  badSession: 500,
  restartRequired: 515,
};

/** @typedef {"ok" | "loggedOut" | "falha" | "pendurado"} ModoLogout */
/** @type {ModoLogout} */
let modoLogout = "ok";
/**
 * Define o que o `logout()` falso faz: conclui (`ok`), emite o fechamento com loggedOut e conclui
 * (`loggedOut`), rejeita (`falha`) ou nunca termina (`pendurado`). Volta a `ok` em `limparHistorico`.
 * @param {ModoLogout} modo
 */
function definirLogout(modo) {
  modoLogout = modo;
}

/** @type {Promise<void> | null} porta que segura o `useMultiFileAuthState` (abertura lenta) */
let portaAuthState = null;
/**
 * Segura a abertura do socket até a promessa resolver (simula uma abertura em andamento).
 * @param {Promise<void> | null} porta
 */
function definirPortaAuthState(porta) {
  portaAuthState = porta;
}

/** @param {any} config */
function makeWASocket(config) {
  /** @type {SocketFalso} */
  const socket = {
    config,
    listeners: {},
    removidos: [],
    chamadasEnd: 0,
    chamadasLogout: 0,
    async emitir(evento, dado) {
      const handler = socket.listeners[evento];
      if (handler) await handler(dado);
    },
  };
  const ev = {
    /** @param {string} evento @param {(dado: any) => any} handler */
    on(evento, handler) {
      socket.listeners[evento] = handler;
    },
    /** @param {string} evento */
    removeAllListeners(evento) {
      socket.removidos.push(evento);
      delete socket.listeners[evento];
    },
  };
  sockets.push(socket);
  return Object.assign(socket, {
    ev,
    end() {
      socket.chamadasEnd += 1;
    },
    // O desligamento gracioso nunca pode chamar o logout (apagaria o pareamento no aparelho).
    async logout() {
      socket.chamadasLogout += 1;
      if (modoLogout === "falha") throw new Error("logout falso falhou");
      if (modoLogout === "pendurado") return new Promise(() => {});
      if (modoLogout === "loggedOut") {
        // Como o Baileys real: o logout termina emitindo o fechamento com loggedOut.
        await socket.emitir("connection.update", {
          connection: "close",
          lastDisconnect: { error: { output: { statusCode: DisconnectReason.loggedOut } } },
        });
      }
    },
    /** @param {any} mensagem */
    updateMediaMessage: async (mensagem) => mensagem,
  });
}

/** @type {() => Promise<void>} gravação das credenciais (os testes trocam para controlar o tempo) */
let tratadorSaveCreds = async () => {};
/** Quantas vezes o saveCreds falso foi chamado. */
const contagem = { saveCreds: 0 };

/** Como o real, cria a pasta da sessão; as credenciais ficam só em memória. */
/** @param {string} pasta */
async function useMultiFileAuthState(pasta) {
  pastasAuthState.push(pasta);
  if (portaAuthState) await portaAuthState;
  fs.mkdirSync(pasta, { recursive: true });
  return {
    state: { creds: {}, keys: {} },
    saveCreds: () => {
      contagem.saveCreds += 1;
      return tratadorSaveCreds();
    },
  };
}

/**
 * Define o que o saveCreds falso faz (ex.: uma promessa que o teste resolve quando quiser).
 * @param {() => Promise<void>} tratador
 */
function definirSaveCreds(tratador) {
  tratadorSaveCreds = tratador;
}

/** Ids gerados pelo generateMessageIDV2 falso (sequenciais, como os do Baileys: `3EB0` + hex). */
let sequenciaIds = 0;
/** @type {(string | undefined)[]} `userId` recebido em cada chamada ao generateMessageIDV2 falso */
const idsGerados = [];

const exportsFalsos = {
  makeWASocket,
  /** @param {string} [userId] */
  generateMessageIDV2: (userId) => {
    idsGerados.push(userId);
    sequenciaIds += 1;
    return `3EB0FALSO${String(sequenciaIds).padStart(12, "0")}`;
  },
  useMultiFileAuthState,
  DisconnectReason,
  /** @param {any} keys */
  makeCacheableSignalKeyStore: (keys) => keys,
  isJidBroadcast: () => false,
  isJidNewsletter: () => false,
  fetchLatestWaWebVersion: async () => ({ version: [2, 3000, 0], isLatest: true }),
  /**
   * Como o real (`downloadMediaMessage(msg, "stream", {}, { logger, reuploadRequest })`), sem rede.
   * @param {any[]} args
   */
  downloadMediaMessage: (...args) => {
    downloads.push(args);
    return tratadorDownload(...args);
  },
};

/**
 * Define o que o downloadMediaMessage falso devolve (um stream em memória) ou rejeita.
 * @param {(...args: any[]) => Promise<any>} tratador
 */
function definirDownload(tratador) {
  tratadorDownload = tratador;
}

function instalarBaileysFalso() {
  const caminho = require.resolve("@whiskeysockets/baileys");
  require.cache[caminho] = /** @type {any} */ ({ id: caminho, filename: caminho, loaded: true, exports: exportsFalsos });
}

/** Zera o histórico de sockets e pastas entre testes. */
function limparHistorico() {
  sockets.length = 0;
  pastasAuthState.length = 0;
  downloads.length = 0;
  idsGerados.length = 0;
  contagem.saveCreds = 0;
  tratadorSaveCreds = async () => {};
  modoLogout = "ok";
  portaAuthState = null;
}

/** Último socket criado (falha o teste se nenhum foi criado). */
function ultimoSocket() {
  const socket = sockets[sockets.length - 1];
  if (!socket) throw new Error("Nenhum socket Baileys foi criado.");
  return socket;
}

/**
 * Métodos de grupo para acoplar a um socket falso (`Object.assign(ultimoSocket(), grupo.metodos)`) ou a um
 * socket de teste unitário: `onWhatsApp`, `groupMetadata`, `groupParticipantsUpdate` e `sendMessage`
 * (inclusive o de `groupInvite`). Cada chamada fica em `chamadas`, na ordem em que ocorreu (`ordem`).
 * Números fictícios: `numeros` mapeia o telefone digitado ao JID real devolvido pelo `onWhatsApp` (número
 * ausente = sem WhatsApp, como o Baileys, que o omite); `adds` mapeia o JID ao item (ou erro) do `add`.
 * @param {{
 *   participantes?: any[],
 *   subject?: string,
 *   memberAddMode?: boolean,
 *   numeros?: Record<string, string | { jid: string, lid?: string } | Error>,
 *   adds?: Record<string, { status: string, content?: any } | Error | any[]>,
 *   aoChamar?: (evento: string) => void | Promise<void>,
 *   criacao?: Error | "travar" | { id: string },
 *   falhaMetadata?: boolean,
 * }} [config]
 */
function criarGrupoFalso({ participantes = [], subject = "Suporte Loja Centro", memberAddMode = false, numeros = {}, adds = {}, aoChamar, criacao = { id: "120363000000000777@g.us" }, falhaMetadata = false } = {}) {
  /** @type {{ onWhatsApp: any[][], metadata: number, add: { jid: string, alvos: string[], acao: string }[], envios: { jid: string, conteudo: any, opcoes: any }[], criacoes: { subject: string, participantes: string[] }[], ordem: string[] }} */
  const chamadas = { onWhatsApp: [], metadata: 0, add: [], envios: [], criacoes: [], ordem: [] };
  const metodos = {
    /** @param {string[]} jids */
    async onWhatsApp(...jids) {
      chamadas.onWhatsApp.push(jids);
      chamadas.ordem.push("onWhatsApp");
      await aoChamar?.("onWhatsApp");
      /** @type {any[]} */
      const resposta = [];
      for (const jid of jids) {
        const real = numeros[String(jid).split("@")[0] ?? ""];
        if (real instanceof Error) throw real;
        if (real) resposta.push(typeof real === "string" ? { jid: real, exists: true } : { exists: true, ...real });
      }
      return resposta;
    },
    /** @param {string} jid */
    async groupMetadata(jid) {
      chamadas.metadata += 1;
      chamadas.ordem.push("groupMetadata");
      await aoChamar?.("groupMetadata");
      if (falhaMetadata) throw new Error("falha do groupMetadata");
      return { id: jid, subject, memberAddMode, participants: participantes };
    },
    /** @param {string} nome @param {string[]} alvos */
    async groupCreate(nome, alvos) {
      chamadas.criacoes.push({ subject: nome, participantes: alvos });
      chamadas.ordem.push("groupCreate");
      await aoChamar?.("groupCreate");
      if (criacao === "travar") return new Promise(() => {});
      if (criacao instanceof Error) throw criacao;
      return { id: criacao.id, subject: nome, participants: alvos.map((id) => ({ id })) };
    },
    /** @param {string} jid @param {string[]} alvos @param {string} acao */
    async groupParticipantsUpdate(jid, alvos, acao) {
      chamadas.add.push({ jid, alvos, acao });
      chamadas.ordem.push("add");
      await aoChamar?.("add");
      const resposta = adds[/** @type {string} */ (alvos[0])];
      if (resposta instanceof Error) throw resposta;
      if (Array.isArray(resposta)) return resposta;
      return [Object.assign({ status: "200", jid: alvos[0], content: { tag: "participant", attrs: { jid: alvos[0] } } }, resposta)];
    },
    /** @param {string} jid @param {any} conteudo @param {any} opcoes */
    async sendMessage(jid, conteudo, opcoes) {
      chamadas.envios.push({ jid, conteudo, opcoes });
      chamadas.ordem.push("sendMessage");
      await aoChamar?.("sendMessage");
      return { key: { remoteJid: jid, fromMe: true, id: opcoes?.messageId }, message: conteudo, messageTimestamp: Math.floor(Date.now() / 1000) };
    },
  };
  return { metodos, chamadas };
}

/**
 * `profilePictureUrl` falso para acoplar a um socket (Fase 32, contrato D2). `urls` mapeia o JID consultado
 * à URL devolvida, a `undefined` (sem foto, como o Baileys quando o nó `picture` não vem) ou a um Error
 * (a consulta rejeita, como o Boom do `assertNodeErrorFree`). JID fora do mapa = sem foto. Cada chamada fica
 * em `chamadas` (`jid`, `tipo`, `timeoutMs`). `"travar"` nunca responde.
 * @param {{ urls?: Record<string, string | undefined | Error | "travar"> }} [config]
 */
function criarFotoFalsa({ urls = {} } = {}) {
  /** @type {{ jid: string, tipo: string | undefined, timeoutMs: number | undefined }[]} */
  const chamadas = [];
  const metodos = {
    /** @param {string} jid @param {string} [tipo] @param {number} [timeoutMs] */
    async profilePictureUrl(jid, tipo, timeoutMs) {
      chamadas.push({ jid, tipo, timeoutMs });
      const resposta = urls[jid];
      if (resposta === "travar") return new Promise(() => {});
      if (resposta instanceof Error) throw resposta;
      return resposta;
    },
  };
  return { metodos, chamadas };
}

/**
 * Erro como o `assertNodeErrorFree` do Baileys 6.7.24: Boom com `output.statusCode` 500 e o código real em `data`.
 * @param {string} texto
 * @param {number} data
 */
function erroBoomFalso(texto, data) {
  return Object.assign(new Error(texto), { isBoom: true, data, output: { statusCode: 500 } });
}

/** Item `participant` do BinaryNode do 403, com o `add_request` do convite (como o Baileys devolve em `content`). */
/** @param {string} jid @param {string} code @param {string | number} expiration */
function conteudoComAddRequest(jid, code, expiration) {
  return { tag: "participant", attrs: { jid, error: "403" }, content: [{ tag: "add_request", attrs: { code, expiration: String(expiration) } }] };
}

/** Drena microtasks e callbacks de I/O pendentes (o `iniciar()` da reconexão é fire-and-forget). */
async function drenar() {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

module.exports = {
  instalarBaileysFalso,
  limparHistorico,
  ultimoSocket,
  drenar,
  definirDownload,
  definirSaveCreds,
  definirLogout,
  definirPortaAuthState,
  criarGrupoFalso,
  criarFotoFalsa,
  erroBoomFalso,
  conteudoComAddRequest,
  contagem,
  sockets,
  pastasAuthState,
  downloads,
  idsGerados,
  DisconnectReason,
};
