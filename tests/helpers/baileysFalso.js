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
 *   emitir: (evento: string, dado: any) => Promise<void>,
 * }} SocketFalso
 */

/** @type {SocketFalso[]} */
const sockets = [];
/** @type {string[]} */
const pastasAuthState = [];

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
  });
}

/** Como o real, cria a pasta da sessão; as credenciais ficam só em memória. */
/** @param {string} pasta */
async function useMultiFileAuthState(pasta) {
  pastasAuthState.push(pasta);
  fs.mkdirSync(pasta, { recursive: true });
  return { state: { creds: {}, keys: {} }, saveCreds: async () => {} };
}

const exportsFalsos = {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  /** @param {any} keys */
  makeCacheableSignalKeyStore: (keys) => keys,
  isJidBroadcast: () => false,
  isJidNewsletter: () => false,
  fetchLatestWaWebVersion: async () => ({ version: [2, 3000, 0], isLatest: true }),
};

function instalarBaileysFalso() {
  const caminho = require.resolve("@whiskeysockets/baileys");
  require.cache[caminho] = /** @type {any} */ ({ id: caminho, filename: caminho, loaded: true, exports: exportsFalsos });
}

/** Zera o histórico de sockets e pastas entre testes. */
function limparHistorico() {
  sockets.length = 0;
  pastasAuthState.length = 0;
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

module.exports = { instalarBaileysFalso, limparHistorico, ultimoSocket, drenar, sockets, pastasAuthState, DisconnectReason };
