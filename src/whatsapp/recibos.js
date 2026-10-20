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
//   enviado normalmente (o back responde 200 sem efeito), e falha do back só loga;
// - envio do CRM (Task 7.2): o back só grava a mensagem DEPOIS da resposta do `POST /enviar`, então
//   um ENTREGUE/LIDA que chegasse antes cairia num id ainda desconhecido e se perderia. Os recibos de
//   um id marcado com `adiarRecibos` ficam retidos por `RECIBO_ATRASO_ENVIO_MS` (padrão 3000 ms, 0
//   desliga) e depois saem na ordem em que chegaram, pela mesma regra do maior status.
//
// Recibo por destinatário (Fase 38, contrato C1): além do status agregado acima (que NÃO muda), cada
// recibo gera um item por destinatário `{ mensagem_wa_id, destinatario, entregue_em, lida_em }`, que vai ao
// `loteRecibos` (lotes em `POST /interno/mensagem-recibos`). D2: PLAYED conta como lida. D3: na conversa
// individual (`messages.update`, sem horário) o horário é o instante em que o wa-back extraiu o evento,
// capturado em `extrairDeAtualizacoes` (nunca na liberação do lote nem da retenção). No grupo
// (`message-receipt.update`) vale `receiptTimestamp`/`readTimestamp`/`playedTimestamp`, e o destinatário é
// o participante `{ lid, telefone }` (nunca JID nem nome). O próprio número da equipe nunca entra. A
// retenção do envio do CRM vale também para o item por destinatário.
// Exceção à D3: na conversa individual que chega por `extrairDeRecibos` (o `userReceipt` que o Baileys
// junta numa mensagem enviada pela equipe) o horário é o do próprio WhatsApp (`receiptTimestamp` /
// `readTimestamp`), não o da extração, porque esse recibo traz horário. O horário de extração só vale
// para o `messages.update`, que não traz horário.
const NodeCache = require("node-cache");
const { mensagemWaIdValido, normalizarJid, lidDe, telefoneDe } = require("./filtroEntrada");
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
/** Retenção padrão dos recibos de um envio do CRM (dá tempo de o back gravar a mensagem enviada). */
const MS_ATRASO_ENVIO_PADRAO = 3000;

/** @typedef {import("../services/mensagemStatusInternoClient").StatusMensagem} StatusMensagem */
/** @typedef {import("../services/mensagemInternoClient").ContextoInstancia} ContextoInstancia */
/** @typedef {import("./filtroEntrada").IdentidadePropria} IdentidadePropria */
/** @typedef {{ mensagem_wa_id: string, status: StatusMensagem }} StatusRecebido */
/** @typedef {import("../services/mensagemReciboInternoClient").ReciboPorDestinatario} ReciboPorDestinatario */
/** @typedef {StatusRecebido | ReciboPorDestinatario} ItemRecibo status agregado ou recibo por destinatário */
/** @typedef {{ adicionar: (item: ReciboPorDestinatario) => unknown, limpar?: () => unknown }} LoteRecibos */
/** @typedef {{ completarIdentidade: (identidade: import("./filtroEntrada").Identidade) => import("./filtroEntrada").Identidade }} ResolvedorIdentidade */

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
 * @param {unknown} item
 * @returns {item is ReciboPorDestinatario}
 */
function ehPorDestinatario(item) {
  return Boolean(item) && typeof item === "object" && "destinatario" in /** @type {object} */ (item);
}

/**
 * Timestamp do Baileys (number ou Long do protobufjs) em epoch de segundos, ou null.
 * @param {unknown} valor
 * @returns {number | null}
 */
function paraEpoch(valor) {
  /** @type {unknown} */
  let n = valor;
  if (valor && typeof valor === "object" && typeof (/** @type {{ toNumber?: unknown }} */ (valor).toNumber) === "function") {
    n = /** @type {{ toNumber: () => number }} */ (valor).toNumber();
  }
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

/**
 * @param {number | null} a
 * @param {number | null} b
 * @returns {number | null}
 */
function menorEpoch(a, b) {
  if (a === null) return b;
  if (b === null) return a;
  return Math.min(a, b);
}

/**
 * `messages.update` → status das mensagens enviadas pela equipe e, na conversa individual, o recibo por
 * destinatário (`destinatario: null`) com o horário desta extração (D3). Nunca lança.
 * @param {unknown} atualizacoes `WAMessageUpdate[]`
 * @param {() => number} [agora] relógio em ms (o horário do recibo individual é o instante da extração)
 * @returns {ItemRecibo[]}
 */
function extrairDeAtualizacoes(atualizacoes, agora = Date.now) {
  if (!Array.isArray(atualizacoes)) return [];
  /** @type {ItemRecibo[]} */
  const itens = [];
  const instante = Math.floor(agora() / 1000);
  for (const item of atualizacoes) {
    const id = idDaEnviada(item);
    const status = id ? statusDoCodigo(item.update?.status) : null;
    if (!id || !status) continue;
    itens.push({ mensagem_wa_id: id, status });
    // Só conversa individual: no grupo o recibo vem por participante (`message-receipt.update`).
    const privado = Boolean(lidDe(item.key.remoteJid) || telefoneDe(item.key.remoteJid));
    if (privado && status !== "ENVIADA") {
      itens.push({
        mensagem_wa_id: id,
        destinatario: null,
        entregue_em: status === "ENTREGUE" ? instante : null,
        lida_em: status === "LIDA" ? instante : null,
      });
    }
  }
  return itens;
}

/**
 * `message-receipt.update` (grupo) e o `userReceipt` de uma mensagem enviada pela equipe → status
 * agregado e recibo por destinatário (o participante `{ lid, telefone }`, com o par completado pelo
 * `resolvedor`; um recibo unido vira um item com os dois horários). Sem os recibos da própria equipe.
 * Fora de grupo (recibo trazido por uma mensagem de conversa individual) o destinatário é `null`. Nunca lança.
 * @param {unknown} recibos `MessageUserReceiptUpdate[]`
 * @param {IdentidadePropria} eu `sock.user` (`id` e `lid`) da equipe
 * @param {ResolvedorIdentidade} [resolvedor] pares LID ↔ telefone da equipe
 * @returns {ItemRecibo[]}
 */
function extrairDeRecibos(recibos, eu, resolvedor) {
  if (!Array.isArray(recibos)) return [];
  const proprioLid = lidDe(eu?.lid) ?? lidDe(eu?.jid);
  const proprioTelefone = telefoneDe(eu?.jid) ?? telefoneDe(eu?.lid);
  const proprios = new Set([normalizarJid(eu?.jid), normalizarJid(eu?.lid)].filter(Boolean));
  /** @type {ItemRecibo[]} */
  const itens = [];
  for (const item of recibos) {
    const id = idDaEnviada(item);
    if (!id) continue;
    const quem = normalizarJid(item.receipt?.userJid);
    if (quem && proprios.has(quem)) continue;
    const status = statusDoRecibo(item.receipt);
    if (!status) continue;
    itens.push({ mensagem_wa_id: id, status });

    const entregue = paraEpoch(item.receipt.receiptTimestamp);
    const lida = menorEpoch(paraEpoch(item.receipt.readTimestamp), paraEpoch(item.receipt.playedTimestamp)); // PLAYED = lida (D2)
    if (entregue === null && lida === null) continue;
    const grupo = typeof item.key.remoteJid === "string" && item.key.remoteJid.endsWith("@g.us");
    if (!grupo) {
      itens.push({ mensagem_wa_id: id, destinatario: null, entregue_em: entregue, lida_em: lida });
      continue;
    }
    const base = { jid: quem, lid: lidDe(quem), telefone: telefoneDe(quem) };
    const completa = resolvedor ? resolvedor.completarIdentidade(base) : base;
    const lid = completa.lid ?? null;
    const telefone = completa.telefone ?? null;
    if (!lid && !telefone) continue;
    if ((lid && lid === proprioLid) || (telefone && telefone === proprioTelefone)) continue;
    itens.push({ mensagem_wa_id: id, destinatario: { lid, telefone }, entregue_em: entregue, lida_em: lida });
  }
  return itens;
}

/**
 * Retenção dos recibos de um envio do CRM, lida do ambiente a cada envio (`RECIBO_ATRASO_ENVIO_MS`,
 * inteiro ≥ 0; ausente ou inválido → 3000 ms; 0 desliga a retenção).
 * @returns {number}
 */
function obterAtrasoReciboEnvio() {
  const valor = process.env.RECIBO_ATRASO_ENVIO_MS;
  const n = Number(valor);
  return valor !== undefined && valor.trim() !== "" && Number.isSafeInteger(n) && n >= 0 ? n : MS_ATRASO_ENVIO_PADRAO;
}

/**
 * Envio dos status de uma equipe ao back, com o maior status já enviado de cada mensagem em memória.
 * @param {{
 *   contexto: ContextoInstancia,
 *   registrarStatusMensagem?: (mensagem_wa_id: string, status: StatusMensagem, contexto: ContextoInstancia) => Promise<unknown>,
 *   msTtl?: number,
 *   msAtrasoEnvio?: number,
 *   liberar?: (itens: ItemRecibo[]) => unknown,
 *   lote?: LoteRecibos,
 * }} opcoes `msAtrasoEnvio`: retenção dos recibos de um envio do CRM (padrão: `obterAtrasoReciboEnvio()`
 *   a cada envio); `liberar`: para onde vão os recibos retidos ao fim da retenção (o adapter usa a fila
 *   serial da entrada; padrão: `processar`); `lote`: para onde vão os recibos por destinatário (sem ele, só
 *   o status agregado é enviado)
 */
function criarRecibos({
  contexto,
  registrarStatusMensagem = mensagemStatusInternoClient.registrarStatusMensagem,
  msTtl = MS_TTL_STATUS,
  msAtrasoEnvio,
  liberar,
  lote,
}) {
  const enviados = new NodeCache({ stdTTL: Math.ceil(msTtl / 1000), checkperiod: 600, useClones: false });
  /** Recibos retidos dos envios do CRM: id → itens na ordem de chegada e o timer da liberação. */
  /** @type {Map<string, { itens: ItemRecibo[], timer: ReturnType<typeof setTimeout> }>} */
  const retidos = new Map();

  /**
   * Retém os recibos deste id (envio do CRM) até o back ter gravado a mensagem. Chamar antes do
   * `sendMessage`, junto com o cache de eco.
   * @param {string} mensagemWaId
   */
  function adiarRecibos(mensagemWaId) {
    if (!mensagemWaIdValido(mensagemWaId)) return;
    const ms = msAtrasoEnvio ?? obterAtrasoReciboEnvio();
    if (!(ms > 0)) return;
    const anterior = retidos.get(mensagemWaId);
    if (anterior) clearTimeout(anterior.timer);
    const timer = setTimeout(() => {
      const retido = retidos.get(mensagemWaId);
      retidos.delete(mensagemWaId);
      if (!retido || retido.itens.length === 0) return;
      Promise.resolve()
        .then(() => (liberar ?? processar)(retido.itens))
        .catch((erro) => console.error(`[RECIBOS] Falha ao liberar recibos retidos da equipe ${contexto.cod_equipe}:`, erro instanceof Error ? erro.name : "erro"));
    }, ms);
    timer.unref?.();
    retidos.set(mensagemWaId, { itens: anterior?.itens ?? [], timer });
  }

  /**
   * Envia os status em ordem, um por vez (o ENTREGUE nunca chega ao back depois do LIDA). O recibo por
   * destinatário vai ao lote (sem esperar o back). Os dois respeitam a retenção do envio do CRM, que guarda
   * o item como chegou (com o horário original). Nunca rejeita.
   * @param {ItemRecibo[]} itens
   * @returns {Promise<void>}
   */
  async function processar(itens) {
    for (const item of itens) {
      const retido = retidos.get(item.mensagem_wa_id);
      if (retido) {
        retido.itens.push(item);
        continue;
      }
      if (ehPorDestinatario(item)) {
        try {
          lote?.adicionar(item);
        } catch (erro) {
          console.error(`[RECIBOS] Falha ao juntar um recibo por destinatário da equipe ${contexto.cod_equipe}:`, erro instanceof Error ? erro.name : "erro");
        }
        continue;
      }
      const { mensagem_wa_id, status } = item;
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

  function limpar() {
    for (const { timer } of retidos.values()) clearTimeout(timer);
    retidos.clear();
    enviados.flushAll();
    lote?.limpar?.();
  }

  return { processar, adiarRecibos, limpar };
}

module.exports = {
  criarRecibos,
  extrairDeAtualizacoes,
  extrairDeRecibos,
  statusDoCodigo,
  statusDoRecibo,
  ehPorDestinatario,
  obterAtrasoReciboEnvio,
  MS_ATRASO_ENVIO_PADRAO,
};
