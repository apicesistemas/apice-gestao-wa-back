// @ts-check
// Cliente da rota interna dos recibos por destinatário (`POST /interno/mensagem-recibos`, contrato C1
// da Fase 38) do apice-gestao-back.
//
// Contrato (JSON):
// - `hash_empresa` e `cod_equipe` (número): tenant e equipe da instância que recebeu os recibos;
// - `recibos`: de 1 a 200 itens `{ mensagem_wa_id, destinatario, entregue_em, lida_em }`:
//   - `destinatario`: `null` na conversa individual; no grupo, o participante `{ lid, telefone }` (LID
//     `<dígitos>@lid`, telefone só com dígitos e DDI, pelo menos um dos dois). Nunca JID nem nome;
//   - `entregue_em` / `lida_em`: epoch em segundos ou `null`, com pelo menos um preenchido.
// Resposta 200 `{ msg, gravados, ignorados }`: um item ruim conta em `ignorados` e não derruba o lote.
// Um item inválido não derruba o lote: o cliente descarta os inválidos e envia os válidos (só rejeita
// quando não sobra nenhum). Com o back antigo a rota não existe (404): quem chama suspende o envio.
const { chamarRotaInterna, ErroRotaInterna } = require("./internoHttpClient");
const { mensagemWaIdValido } = require("../whatsapp/filtroEntrada");

const ROTA = "/interno/mensagem-recibos";
/** Limite técnico de itens por chamada (o back recusa mais que isso com 400). */
const MAX_RECIBOS_POR_CHAMADA = 200;
const PADRAO_LID = /^\d{1,25}@lid$/;
const PADRAO_TELEFONE = /^\d{8,15}$/;

/** @typedef {{ lid: string | null, telefone: string | null }} DestinatarioRecibo */
/** @typedef {{ mensagem_wa_id: string, destinatario: DestinatarioRecibo | null, entregue_em: number | null, lida_em: number | null }} ReciboPorDestinatario */
/** @typedef {import("./mensagemInternoClient").ContextoInstancia} ContextoInstancia */

/** @param {string} mensagem */
const requisicaoInvalida = (mensagem) => new ErroRotaInterna(mensagem, { rota: ROTA, tipo: "requisicao_invalida" });

/**
 * @param {unknown} valor
 * @returns {boolean}
 */
const epochValido = (valor) => valor === null || (typeof valor === "number" && Number.isSafeInteger(valor) && valor > 0);

/**
 * @param {unknown} destinatario
 * @returns {boolean}
 */
function destinatarioValido(destinatario) {
  if (destinatario === null) return true;
  if (!destinatario || typeof destinatario !== "object") return false;
  const { lid, telefone } = /** @type {{ lid?: unknown, telefone?: unknown }} */ (destinatario);
  const lidOk = typeof lid === "string" && PADRAO_LID.test(lid);
  const telefoneOk = typeof telefone === "string" && PADRAO_TELEFONE.test(telefone);
  if (lid != null && !lidOk) return false;
  if (telefone != null && !telefoneOk) return false;
  return lidOk || telefoneOk;
}

/**
 * @param {unknown} item
 * @returns {boolean}
 */
function itemValido(item) {
  if (!item || typeof item !== "object") return false;
  const { mensagem_wa_id, destinatario, entregue_em, lida_em } = /** @type {Record<string, unknown>} */ (item);
  return (
    mensagemWaIdValido(mensagem_wa_id) &&
    destinatarioValido(destinatario ?? null) &&
    epochValido(entregue_em ?? null) &&
    epochValido(lida_em ?? null) &&
    (entregue_em != null || lida_em != null)
  );
}

/**
 * Registra no back os recibos de entrega e leitura de uma equipe (um lote de até 200). Itens inválidos são
 * descartados antes do envio. Rejeita com `ErroRotaInterna` (requisição inválida, configuração, rede, prazo ou HTTP não-2xx).
 * @param {ReciboPorDestinatario[]} recibos
 * @param {ContextoInstancia} contexto
 * @param {{ timeoutMs?: number }} [opcoes] prazo próprio da chamada
 * @returns {Promise<{ msg?: string, gravados?: number, ignorados?: number } | null>}
 */
async function registrarRecibos(recibos, { hash_empresa, cod_equipe }, opcoes = {}) {
  if (!Array.isArray(recibos) || recibos.length === 0 || recibos.length > MAX_RECIBOS_POR_CHAMADA) {
    throw requisicaoInvalida(`Chamada a "${ROTA}" com a quantidade de recibos fora de 1 a ${MAX_RECIBOS_POR_CHAMADA}.`);
  }
  const validos = recibos.filter(itemValido);
  if (validos.length === 0) throw requisicaoInvalida(`Chamada a "${ROTA}" sem nenhum recibo válido.`);
  const corpo = {
    hash_empresa,
    cod_equipe: Number(cod_equipe),
    recibos: validos.map(({ mensagem_wa_id, destinatario, entregue_em, lida_em }) => ({
      mensagem_wa_id,
      destinatario: destinatario ? { lid: destinatario.lid ?? null, telefone: destinatario.telefone ?? null } : null,
      entregue_em: entregue_em ?? null,
      lida_em: lida_em ?? null,
    })),
  };
  return chamarRotaInterna(ROTA, corpo, opcoes);
}

module.exports = { registrarRecibos, itemValido, MAX_RECIBOS_POR_CHAMADA, ROTA };
