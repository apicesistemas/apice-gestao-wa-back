// @ts-check
// Recibos de entrega e leitura (✓ / ✓✓ / ✓✓ azul) das mensagens enviadas pela equipe (pelo CRM ou
// pelo aparelho), a partir de dois eventos do Baileys 6.7.24:
// - `messages.update` (conversa privada): `update.status` com o WAMessageStatus. SERVER_ACK →
//   ENVIADA, DELIVERY_ACK → ENTREGUE, READ e PLAYED (áudio ouvido) → LIDA. ERROR e PENDING não
//   viram status (o erro de envio é tratado pelo pipeline de saída, Task 7.2);
// - `message-receipt.update` (grupo): um recibo por participante, com `receiptTimestamp` (entregue)
//   ou `readTimestamp`/`playedTimestamp` (lido).
//
// Regras:
// - só mensagens com `key.fromMe` (enviadas pela equipe) têm status. Um `messages.update` de
//   leitura de uma mensagem RECEBIDA (lida em outro aparelho da equipe) é ignorado;
// - em grupo, o recibo da própria equipe (outro aparelho dela, `sender`/`read-self`) é ignorado;
// - vale o maior status recebido: no grupo, a mensagem fica LIDA quando o primeiro participante lê,
//   e os recibos dos demais (ou um recibo atrasado menor) não chamam o back de novo. O status nunca
//   regride. Um envio que falhou não conta, e o próximo recibo tenta de novo;
// - update sem id válido ou sem status mapeável não chama o back. Um id que o back não conhece é
//   enviado normalmente (o back responde 200 sem efeito), e falha do back só loga.
const NodeCache = require("node-cache");
const { mensagemWaIdValido, normalizarJid } = require("./filtroEntrada");
const mensagemStatusInternoClient = require("../services/mensagemStatusInternoClient");

/** WAMessageStatus (proto.WebMessageInfo.Status) do Baileys 6.7.24 → status no CRM. */
const STATUS_DO_CODIGO = new Map([
  [2, "ENVIADA"], // SERVER_ACK
  [3, "ENTREGUE"], // DELIVERY_ACK
  [4, "LIDA"], // READ
  [5, "LIDA"], // PLAYED
]);
/** Ordem dos status: só um status maior que o já enviado vai ao back. */
const ORDEM = { ENVIADA: 1, ENTREGUE: 2, LIDA: 3 };
/** Por quanto tempo o maior status enviado de cada mensagem fica em memória. */
const MS_TTL_STATUS = 24 * 60 * 60 * 1000;

/** @typedef {import("../services/mensagemStatusInternoClient").StatusMensagem} StatusMensagem */
/** @typedef {import("../services/mensagemInternoClient").ContextoInstancia} ContextoInstancia */
/** @typedef {import("./filtroEntrada").IdentidadePropria} IdentidadePropria */
/** @typedef {{ mensagem_wa_id: string, status: StatusMensagem }} StatusRecebido */

/**
 * @param {unknown} codigo
 * @returns {StatusMensagem | null}
 */
function statusDoCodigo(codigo) {
  return typeof codigo === "number" ? /** @type {StatusMensagem | undefined} */ (STATUS_DO_CODIGO.get(codigo)) ?? null : null;
}

/**
 * @param {unknown} valor timestamp (number ou Long do protobufjs)
 * @returns {boolean}
 */
function temTimestamp(valor) {
  if (typeof valor === "number") return valor > 0;
  return Boolean(valor && typeof valor === "object");
}

/**
 * @param {any} receipt `proto.IUserReceipt`
 * @returns {StatusMensagem | null}
 */
function statusDoRecibo(receipt) {
  if (!receipt || typeof receipt !== "object") return null;
  if (temTimestamp(receipt.readTimestamp) || temTimestamp(receipt.playedTimestamp)) return "LIDA";
  if (temTimestamp(receipt.receiptTimestamp)) return "ENTREGUE";
  return null;
}

/**
 * Id da mensagem enviada pela equipe, ou null quando o item não tem status a reportar.
 * @param {any} item
 * @returns {string | null}
 */
function idDaEnviada(item) {
  const key = item && typeof item === "object" ? item.key : null;
  if (!key || key.fromMe !== true || !mensagemWaIdValido(key.id)) return null;
  return key.id;
}

/**
 * `messages.update` → status das mensagens enviadas pela equipe. Nunca lança.
 * @param {unknown} atualizacoes `WAMessageUpdate[]`
 * @returns {StatusRecebido[]}
 */
function extrairDeAtualizacoes(atualizacoes) {
  if (!Array.isArray(atualizacoes)) return [];
  /** @type {StatusRecebido[]} */
  const itens = [];
  for (const item of atualizacoes) {
    const id = idDaEnviada(item);
    const status = id ? statusDoCodigo(item.update?.status) : null;
    if (id && status) itens.push({ mensagem_wa_id: id, status });
  }
  return itens;
}

/**
 * `message-receipt.update` (grupo) → status das mensagens enviadas pela equipe, sem os recibos da
 * própria equipe. Nunca lança.
 * @param {unknown} recibos `MessageUserReceiptUpdate[]`
 * @param {IdentidadePropria} eu `sock.user` (`id` e `lid`) da equipe
 * @returns {StatusRecebido[]}
 */
function extrairDeRecibos(recibos, eu) {
  if (!Array.isArray(recibos)) return [];
  const proprios = new Set([normalizarJid(eu?.jid), normalizarJid(eu?.lid)].filter(Boolean));
  /** @type {StatusRecebido[]} */
  const itens = [];
  for (const item of recibos) {
    const id = idDaEnviada(item);
    if (!id) continue;
    const quem = normalizarJid(item.receipt?.userJid);
    if (quem && proprios.has(quem)) continue;
    const status = statusDoRecibo(item.receipt);
    if (status) itens.push({ mensagem_wa_id: id, status });
  }
  return itens;
}

/**
 * Envio dos status de uma equipe ao back, com o maior status já enviado de cada mensagem em memória.
 * @param {{
 *   contexto: ContextoInstancia,
 *   registrarStatusMensagem?: (mensagem_wa_id: string, status: StatusMensagem, contexto: ContextoInstancia) => Promise<unknown>,
 *   msTtl?: number,
 * }} opcoes
 */
function criarRecibos({ contexto, registrarStatusMensagem = mensagemStatusInternoClient.registrarStatusMensagem, msTtl = MS_TTL_STATUS }) {
  const enviados = new NodeCache({ stdTTL: Math.ceil(msTtl / 1000), checkperiod: 600, useClones: false });

  /**
   * Envia os status em ordem, um por vez (o ENTREGUE nunca chega ao back depois do LIDA). Nunca rejeita.
   * @param {StatusRecebido[]} itens
   * @returns {Promise<void>}
   */
  async function processar(itens) {
    for (const { mensagem_wa_id, status } of itens) {
      const anterior = /** @type {number | undefined} */ (enviados.get(mensagem_wa_id)) ?? 0;
      if (ORDEM[status] <= anterior) continue;
      try {
        await registrarStatusMensagem(mensagem_wa_id, status, contexto);
        enviados.set(mensagem_wa_id, ORDEM[status]);
      } catch (erro) {
        const { name, status: http } = /** @type {{ name?: unknown, status?: unknown }} */ (erro && typeof erro === "object" ? erro : {});
        console.error(
          `[RECIBOS] Falha ao registrar o status ${status} da mensagem ${mensagem_wa_id} da equipe ${contexto.cod_equipe}:`,
          `${typeof name === "string" ? name : "erro"}${typeof http === "number" ? ` HTTP ${http}` : ""}`
        );
      }
    }
  }

  return { processar, limpar: () => enviados.flushAll() };
}

module.exports = { criarRecibos, extrairDeAtualizacoes, extrairDeRecibos, statusDoCodigo, statusDoRecibo };
