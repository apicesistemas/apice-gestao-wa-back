// @ts-check
// Edição de mensagem de texto enviada pelo atendente (Fase 40): `{ text, edit: key, mentions? }` no
// chat da mensagem original. Mesmo caminho da reação e do envio (envio.js): tenant e conexão
// conferidos, e o id do ENVELOPE da edição gerado e marcado no cache de eco antes do `sendMessage`,
// então o eco (`protocolMessage` MESSAGE_EDIT com esse id) não volta ao back. O id devolvido é o do
// envelope, nunca o da mensagem original. Só edita mensagem enviada pelo número da equipe (`fromMe`).
// Log: nada de texto, JID nem LID (o envio.js só loga o id do envelope e o nome do erro).
const { validarChatJid, validarKey, validarMencoes, montarConteudo, obterSocketDaEquipe, enviarPeloSocket, ErroEnvio } = require("./envio");

/** Prazo técnico do `sendMessage` da edição (o back desiste em 15 s): passou, 504 "Envio não confirmado.". */
const PRAZO_EDICAO_MS = 10_000;

/** @typedef {import("./envio").ManagerEnvio} ManagerEnvio */
/** @typedef {import("./envio").ChaveWa} ChaveWa */

/**
 * @param {{ manager?: ManagerEnvio, prazoMs?: number }} [opcoes] manager das instâncias (padrão: o do
 *   processo) e prazo do `sendMessage` (padrão: PRAZO_EDICAO_MS)
 */
function criarEdicao({ manager, prazoMs = PRAZO_EDICAO_MS } = {}) {
  /** @returns {ManagerEnvio} */
  const obterManager = () => manager ?? /** @type {ManagerEnvio} */ (/** @type {unknown} */ (require("./instanciaManager")));

  /**
   * Edita o texto de uma mensagem enviada pela equipe.
   * @param {string | number} codEquipe
   * @param {string} chat_jid conversa da mensagem (o `remoteJid` da própria mensagem)
   * @param {ChaveWa} key key Baileys da mensagem original (`fromMe: true`)
   * @param {string} texto novo texto, já com o cabeçalho
   * @param {string[] | undefined} mencoes JIDs de pessoa mencionados
   * @param {string} hashEmpresa tenant dono da equipe
   * @returns {Promise<{ mensagem_wa_id: string, timestamp_wa: number, status: "ENVIADA" }>}
   * @throws {ErroEnvio}
   */
  async function editar(codEquipe, chat_jid, key, texto, mencoes, hashEmpresa) {
    const jid = validarChatJid(chat_jid);
    const alvo = validarKey(key, jid);
    if (alvo.fromMe !== true) throw new ErroEnvio("CONTEUDO_INVALIDO", "Só mensagens enviadas pelo número da equipe podem ser editadas.");
    const conteudo = montarConteudo({ texto }, { mencoes: validarMencoes(mencoes) });
    const { adapter, socket } = obterSocketDaEquipe(obterManager(), codEquipe, hashEmpresa);
    const { mensagem_wa_id, timestamp_wa, status } = await enviarPeloSocket(adapter, socket, jid, { ...conteudo, edit: alvo }, {}, { prazoMs });
    return { mensagem_wa_id, timestamp_wa, status };
  }

  return { editar };
}

const padrao = criarEdicao();

module.exports = { editar: padrao.editar, criarEdicao, PRAZO_EDICAO_MS };
