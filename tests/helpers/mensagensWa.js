// @ts-check
// Builders de payloads do `messages.upsert` do Baileys 6.7.24 para os testes da entrada. Todos os
// números, LIDs e ids são fictícios (nenhum dado real de cliente). Fica fora do padrão `*.test.js`.

const TELEFONE_CLIENTE = "5511900000001";
const JID_CLIENTE = `${TELEFONE_CLIENTE}@s.whatsapp.net`;
const LID_CLIENTE = "100000000000001@lid";

const JID_GRUPO = "120363000000000001@g.us";
const TELEFONE_PARTICIPANTE = "5511900000002";
const JID_PARTICIPANTE = `${TELEFONE_PARTICIPANTE}@s.whatsapp.net`;
const LID_PARTICIPANTE = "100000000000002@lid";

/** Número da equipe (o próprio aparelho), com sufixo de dispositivo como vem em `sock.user`. */
const TELEFONE_EQUIPE = "5511900000099";
const EU = { jid: `${TELEFONE_EQUIPE}:7@s.whatsapp.net`, lid: "100000000000099:7@lid" };

const TIMESTAMP = 1760400000;

let sequencia = 0;
/** Id de mensagem fictício e único no processo de teste. */
function novoId() {
  sequencia += 1;
  return `3EB0TESTE${String(sequencia).padStart(6, "0")}`;
}

/**
 * Monta um WAMessage como o Baileys entrega no `messages.upsert`.
 * @param {any} message conteúdo (`proto.IMessage`)
 * @param {{ key?: Record<string, any>, pushName?: string | null, messageTimestamp?: any }} [opcoes]
 * @returns {any}
 */
function mensagemWa(message, { key = {}, pushName = "Cliente Teste", messageTimestamp = TIMESTAMP } = {}) {
  return {
    key: { remoteJid: JID_CLIENTE, fromMe: false, id: novoId(), ...key },
    message,
    messageTimestamp,
    ...(pushName === null ? {} : { pushName }),
  };
}

/**
 * Mensagem de grupo enviada por um participante (`key.participant`).
 * @param {any} message
 * @param {{ key?: Record<string, any>, pushName?: string | null }} [opcoes]
 */
function mensagemGrupo(message, { key = {}, pushName = "Participante Teste" } = {}) {
  return mensagemWa(message, {
    key: { remoteJid: JID_GRUPO, participant: JID_PARTICIPANTE, participantLid: LID_PARTICIPANTE, ...key },
    pushName,
  });
}

/**
 * Long do protobufjs (como o Baileys entrega `fileLength`).
 * @param {number} valor
 */
function long(valor) {
  return { low: valor, high: 0, unsigned: true, toNumber: () => valor };
}

module.exports = {
  mensagemWa,
  mensagemGrupo,
  novoId,
  long,
  TELEFONE_CLIENTE,
  JID_CLIENTE,
  LID_CLIENTE,
  JID_GRUPO,
  TELEFONE_PARTICIPANTE,
  JID_PARTICIPANTE,
  LID_PARTICIPANTE,
  TELEFONE_EQUIPE,
  EU,
  TIMESTAMP,
};
