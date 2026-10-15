// @ts-check
// Reação do atendente a uma mensagem da conversa: `{ react: { text, key } }` no chat da mensagem
// alvo (emoji "" remove a reação). Mesmo caminho do envio (envio.js): tenant e conexão conferidos,
// id gerado e marcado no cache de eco antes do `sendMessage` (o eco da reação não vira "aparelho").
const { validarChatJid, validarKey, obterSocketDaEquipe, enviarPeloSocket, ErroEnvio } = require("./envio");

/** Um emoji (inclusive sequências ZWJ, bandeiras e tons de pele) cabe com folga neste teto. */
const MAX_EMOJI = 32;

/** @typedef {import("./envio").ManagerEnvio} ManagerEnvio */
/** @typedef {import("./envio").ChaveWa} ChaveWa */

/**
 * @param {unknown} emoji
 * @returns {string}
 */
function validarEmoji(emoji) {
  if (typeof emoji !== "string" || emoji.length > MAX_EMOJI || /[\s\u0000-\u001f]/u.test(emoji) || /[A-Za-z]{2}/.test(emoji)) {
    throw new ErroEnvio("CONTEUDO_INVALIDO", "Emoji da reação inválido.");
  }
  return emoji;
}

/** Prazo técnico do `sendMessage` da reação (o back desiste em 15 s): passou, 504 "Envio não confirmado.". */
const PRAZO_REACAO_MS = 10_000;

/**
 * @param {{ manager?: ManagerEnvio }} [opcoes] manager das instâncias (padrão: o do processo)
 */
function criarReacao({ manager } = {}) {
  /** @returns {ManagerEnvio} */
  const obterManager = () => manager ?? /** @type {ManagerEnvio} */ (/** @type {unknown} */ (require("./instanciaManager")));

  /**
   * Reage (ou remove a reação, com emoji "") a uma mensagem da conversa.
   * @param {string | number} codEquipe
   * @param {string} chat_jid conversa da mensagem alvo
   * @param {ChaveWa} key key Baileys da mensagem alvo (guardada pelo back)
   * @param {string} emoji
   * @param {string} hashEmpresa tenant dono da equipe
   * @returns {Promise<{ status: "ENVIADA" }>}
   * @throws {ErroEnvio}
   */
  async function reagir(codEquipe, chat_jid, key, emoji, hashEmpresa) {
    const jid = validarChatJid(chat_jid);
    const alvo = validarKey(key, jid);
    const text = validarEmoji(emoji);
    const { adapter, socket } = obterSocketDaEquipe(obterManager(), codEquipe, hashEmpresa);
    await enviarPeloSocket(adapter, socket, jid, { react: { text, key: alvo } }, {}, { prazoMs: PRAZO_REACAO_MS });
    return { status: "ENVIADA" };
  }

  return { reagir };
}

const padrao = criarReacao();

module.exports = { reagir: padrao.reagir, criarReacao, validarEmoji, PRAZO_REACAO_MS };
