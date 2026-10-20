// @ts-check
// Apagar para todos a mensagem enviada pelo atendente (Fase 41): `{ delete: key }` no chat da mensagem
// original. Mesmo caminho da edição (edicao.js): tenant e conexão conferidos, e o id do ENVELOPE do
// REVOKE gerado e marcado no cache de eco antes do `sendMessage`, então o eco (`protocolMessage` REVOKE
// com esse id) não volta ao back; o REVOKE feito no aparelho (id não marcado) continua indo. O id
// devolvido é o do envelope, nunca o da mensagem original. Só apaga mensagem enviada pelo número da
// equipe (`fromMe`): nunca o modo administrador (`edit: '8'`). Log: só ids e o nome do erro (envio.js).
const { validarChatJid, validarKey, obterSocketDaEquipe, enviarPeloSocket, ErroEnvio } = require("./envio");

/** Prazo técnico do `sendMessage` da exclusão (o back desiste em 15 s): passou, 504 "Envio não confirmado.". */
const PRAZO_EXCLUSAO_MS = 10_000;

/** @typedef {import("./envio").ManagerEnvio} ManagerEnvio */
/** @typedef {import("./envio").ChaveWa} ChaveWa */

/**
 * @param {{ manager?: ManagerEnvio, prazoMs?: number }} [opcoes] manager das instâncias (padrão: o do
 *   processo) e prazo do `sendMessage` (padrão: PRAZO_EXCLUSAO_MS)
 */
function criarExclusao({ manager, prazoMs = PRAZO_EXCLUSAO_MS } = {}) {
  /** @returns {ManagerEnvio} */
  const obterManager = () => manager ?? /** @type {ManagerEnvio} */ (/** @type {unknown} */ (require("./instanciaManager")));

  /**
   * Apaga para todos uma mensagem enviada pela equipe.
   * @param {string | number} codEquipe
   * @param {string} chat_jid conversa da mensagem (o `remoteJid` da própria mensagem)
   * @param {ChaveWa} key key Baileys da mensagem original (`fromMe: true`)
   * @param {string} hashEmpresa tenant dono da equipe
   * @returns {Promise<{ mensagem_wa_id: string, timestamp_wa: number, status: "ENVIADA" }>}
   * @throws {ErroEnvio}
   */
  async function apagar(codEquipe, chat_jid, key, hashEmpresa) {
    const jid = validarChatJid(chat_jid);
    const alvo = validarKey(key, jid);
    if (alvo.fromMe !== true) throw new ErroEnvio("CONTEUDO_INVALIDO", "Só mensagens enviadas pelo número da equipe podem ser apagadas.");
    const { adapter, socket } = obterSocketDaEquipe(obterManager(), codEquipe, hashEmpresa);
    const { mensagem_wa_id, timestamp_wa, status } = await enviarPeloSocket(adapter, socket, jid, { delete: alvo }, {}, { prazoMs });
    return { mensagem_wa_id, timestamp_wa, status };
  }

  return { apagar };
}

const padrao = criarExclusao();

module.exports = { apagar: padrao.apagar, criarExclusao, PRAZO_EXCLUSAO_MS };
