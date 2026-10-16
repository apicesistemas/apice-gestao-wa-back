// @ts-check
// Menções detalhadas da mensagem recebida (`mencoes_detalhe` de `/interno/mensagem-recebida`, rota
// que também leva a edição). O WhatsApp entrega só os JIDs mencionados (em grupo, quase sempre
// LID); o livechat precisa do par LID ↔ telefone para mostrar o nome em vez de "@10000000000001".
// Função pura: sem socket e sem rede. Quem chama passa o resolvedor de LID da equipe e os
// participantes do grupo já consultados (nomeGrupo). Item sem par conhecido sai com `telefone: null`
// (ou `lid: null`) e a mensagem é registrada normalmente. Nada aqui vai a log.
const { normalizarJid, lidDe, telefoneDe } = require("./filtroEntrada");

/** Limite do `jid` no contrato com o back. */
const MAX_JID = 100;

/**
 * @typedef {{ jid: string, lid: string | null, telefone: string | null, propria: boolean }} MencaoDetalhe
 */
/** @typedef {{ jid?: unknown, lid?: unknown }} EuSocket `sock.user` do Baileys (id com sufixo de aparelho) */
/** @typedef {import("./nomeGrupo").ParticipanteGrupo} ParticipanteGrupo */

/**
 * O par (LID, telefone) é o número da própria equipe?
 * @param {{ lid: string | null, telefone: string | null }} identidade
 * @param {EuSocket | undefined} eu
 * @returns {boolean}
 */
function ehProprio({ lid, telefone }, eu) {
  const meuLid = lidDe(eu?.lid);
  const meuTelefone = telefoneDe(eu?.jid);
  return Boolean((lid && meuLid && lid === meuLid) || (telefone && meuTelefone && telefone === meuTelefone));
}

/**
 * Um item por JID de `mencoes`, na mesma ordem.
 * @param {string[]} mencoes JIDs de `contextInfo.mentionedJid` já normalizados
 * @param {{
 *   resolvedorLid?: { telefoneDoLid: (lid: unknown) => string | null, lidDoTelefone: (telefone: unknown) => string | null },
 *   participantes?: ParticipanteGrupo[] | null,
 *   eu?: EuSocket,
 * }} [contexto]
 * @returns {MencaoDetalhe[]}
 */
function detalharMencoes(mencoes, { resolvedorLid, participantes, eu } = {}) {
  if (!Array.isArray(mencoes)) return [];
  const lista = Array.isArray(participantes) ? participantes : [];
  /** @type {MencaoDetalhe[]} */
  const detalhes = [];
  for (const bruto of mencoes) {
    const jid = normalizarJid(bruto);
    if (!jid || jid.length > MAX_JID) continue;
    let lid = lidDe(jid);
    let telefone = telefoneDe(jid);
    const participante = lista.find((p) => p.jid === jid || (lid !== null && p.lid === lid) || (telefone !== null && p.telefone === telefone));
    if (!telefone && lid) telefone = resolvedorLid?.telefoneDoLid(lid) ?? participante?.telefone ?? null;
    if (!lid && telefone) lid = resolvedorLid?.lidDoTelefone(telefone) ?? participante?.lid ?? null;
    detalhes.push({ jid, lid, telefone, propria: ehProprio({ lid, telefone }, eu) });
  }
  return detalhes;
}

module.exports = { detalharMencoes, ehProprio, MAX_JID };
