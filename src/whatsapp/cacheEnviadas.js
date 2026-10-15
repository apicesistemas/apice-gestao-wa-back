// @ts-check
// Cache das mensagens enviadas pelo CRM para o `getMessage` do Baileys (Task 14.3, pendência da 7.2).
// Quando o aparelho do cliente não consegue decifrar uma mensagem ("Aguardando mensagem"), o
// WhatsApp pede o reenvio e o Baileys chama `getMessage(key)` para retransmitir. Base: o cache
// `enviadas` + `getMessage` do gateway do apice-financeiro-wa-wa-back.
//
// Regras:
// - SÓ EM MEMÓRIA e por equipe (nunca em disco nem em log): guarda o `message` devolvido pelo
//   `sendMessage` (na mídia é a referência cifrada já enviada, url e mediaKey, sem os bytes);
// - sem a mensagem (expirada, outro processo, nunca enviada) devolve `undefined`, NUNCA
//   `{ conversation: "" }`: o Baileys retransmite literalmente o que vier, e a bolha vazia
//   substituiria a original de vez. Com `undefined`, o pior caso é o "Aguardando mensagem";
// - só atende o pedido do destino do envio (o chat, ou o outro JID do mesmo contato, LID ↔ telefone).
const { normalizarJid } = require("./filtroEntrada");

/** Prazo e teto do cache (técnicos: o pedido de reenvio chega em segundos ou minutos). */
const TTL_ENVIADAS_MS = 60 * 60 * 1000;
const MAX_ENVIADAS = 500;

/**
 * @param {{ ttlMs?: number, max?: number, agora?: () => number }} [opcoes]
 */
function criarCacheEnviadas({ ttlMs = TTL_ENVIADAS_MS, max = MAX_ENVIADAS, agora = Date.now } = {}) {
  /** id → { message, destinos, em }; a ordem de inserção é a ordem de tempo (FIFO). */
  /** @type {Map<string, { message: any, destinos: Set<string>, em: number }>} */
  const enviadas = new Map();

  function expirar() {
    const limite = agora() - ttlMs;
    for (const [id, entrada] of enviadas) {
      if (entrada.em >= limite) break;
      enviadas.delete(id);
    }
  }

  /**
   * Guarda uma mensagem enviada (depois do `sendMessage`).
   * @param {string} id `key.id` da mensagem enviada
   * @param {any} message o `message` do WAMessage devolvido pelo `sendMessage`
   * @param {string[]} destinos JIDs que podem pedir o reenvio
   */
  function guardar(id, message, destinos) {
    if (typeof id !== "string" || id === "" || !message || typeof message !== "object") return;
    const validos = new Set((Array.isArray(destinos) ? destinos : []).map(normalizarJid).filter((j) => typeof j === "string"));
    if (validos.size === 0) return;
    enviadas.delete(id);
    enviadas.set(id, { message, destinos: /** @type {Set<string>} */ (validos), em: agora() });
    expirar();
    while (enviadas.size > max) {
      const maisAntiga = enviadas.keys().next().value;
      if (maisAntiga === undefined) break;
      enviadas.delete(maisAntiga);
    }
  }

  /**
   * O `getMessage` do Baileys.
   * @param {{ remoteJid?: string | null, id?: string | null, participant?: string | null } | null | undefined} key
   * @returns {Promise<any | undefined>}
   */
  async function obter(key) {
    const id = key?.id;
    if (typeof id !== "string") return undefined;
    expirar();
    const entrada = enviadas.get(id);
    if (!entrada) return undefined;
    const remoto = normalizarJid(key?.remoteJid);
    // Pedido de outro destino não recebe nada (a entrada fica para o destino certo).
    if (!remoto || !entrada.destinos.has(remoto)) return undefined;
    return entrada.message;
  }

  return { guardar, obter, limpar: () => enviadas.clear(), tamanho: () => enviadas.size };
}

module.exports = { criarCacheEnviadas, TTL_ENVIADAS_MS, MAX_ENVIADAS };
