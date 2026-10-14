// @ts-check
// Separa o eco dos envios do CRM das mensagens `fromMe` digitadas no celular ou no WhatsApp Web da
// equipe (base: agente/registroAparelho.js e o cache `enviadas` do gateway do financeiro).
//
// Toda mensagem que o CRM envia volta pelo `messages.upsert` com `fromMe` (o Baileys emite o
// próprio envio como `append`). Sem este filtro ela seria registrada de novo como "aparelho".
// O pipeline de saída precisa marcar o id ANTES do `sendMessage` (gerando o id com
// `generateMessageIDV2` e passando em `messageId`), porque o Baileys pode emitir o eco antes de o
// `sendMessage` devolver a chave.
//
// Cache só em memória e por equipe: um restart esquece os ids, e um eco que chegue depois disso
// seria registrado como aparelho. O back deduplica pelo `mensagem_wa_id`, então isso não duplica.

/** Prazo e teto do cache de ids enviados pelo CRM (cache técnico, não é regra de negócio). */
const TTL_ENVIADAS_MS = 24 * 60 * 60 * 1000;
const MAX_ENVIADAS = 5000;

/** @typedef {Pick<import("./filtroEntrada").MensagemRecebida, "mensagem_wa_id" | "origem">} MensagemComOrigem */

/**
 * @param {{ ttlMs?: number, maxEnviadas?: number, agora?: () => number }} [opcoes]
 */
function criarRegistroAparelho({ ttlMs = TTL_ENVIADAS_MS, maxEnviadas = MAX_ENVIADAS, agora = Date.now } = {}) {
  /** id → instante em que foi marcado; a ordem de inserção é a ordem de tempo (FIFO). */
  /** @type {Map<string, number>} */
  const enviadas = new Map();

  function expirar() {
    const limite = agora() - ttlMs;
    for (const [id, em] of enviadas) {
      if (em >= limite) break;
      enviadas.delete(id);
    }
  }

  /**
   * Marca um id enviado pelo CRM (chamar antes do `sendMessage`).
   * @param {string} mensagemWaId
   */
  function marcarEnviada(mensagemWaId) {
    if (typeof mensagemWaId !== "string" || mensagemWaId === "") return;
    enviadas.delete(mensagemWaId);
    enviadas.set(mensagemWaId, agora());
    expirar();
    while (enviadas.size > maxEnviadas) {
      const maisAntiga = enviadas.keys().next().value;
      if (maisAntiga === undefined) break;
      enviadas.delete(maisAntiga);
    }
  }

  /**
   * É o eco de uma mensagem que o próprio CRM enviou?
   * @param {MensagemComOrigem} mensagem
   * @returns {boolean}
   */
  function ehEcoDoCrm(mensagem) {
    if (mensagem.origem !== "APARELHO") return false;
    expirar();
    return enviadas.has(mensagem.mensagem_wa_id);
  }

  /**
   * Mensagem do cliente sempre; do aparelho, só se não for eco do CRM.
   * @param {MensagemComOrigem} mensagem
   * @returns {boolean}
   */
  function deveRegistrar(mensagem) {
    return !ehEcoDoCrm(mensagem);
  }

  return { marcarEnviada, ehEcoDoCrm, deveRegistrar, limpar: () => enviadas.clear() };
}

module.exports = { criarRegistroAparelho, TTL_ENVIADAS_MS, MAX_ENVIADAS };
