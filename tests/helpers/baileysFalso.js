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
}

/** Último socket criado (falha o teste se nenhum foi criado). */
function ultimoSocket() {
  const socket = sockets[sockets.length - 1];
  if (!socket) throw new Error("Nenhum socket Baileys foi criado.");
  return socket;
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
  contagem,
  sockets,
  pastasAuthState,
  downloads,
  idsGerados,
  DisconnectReason,
};
