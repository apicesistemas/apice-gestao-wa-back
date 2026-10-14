// @ts-check
// Cliente da rota interna do status de entrega das mensagens enviadas pela equipe
// (`POST /interno/mensagem-status`) no apice-gestao-back (rota da Task 6.1).
//
// Contrato (JSON):
// - `hash_empresa`, `cod_equipe` (número): tenant e equipe da instância que recebeu o recibo;
// - `mensagem_wa_id`: id da mensagem no WhatsApp (`key.id`);
// - `status`: `ENVIADA` (✓), `ENTREGUE` (✓✓) ou `LIDA` (✓✓ azul).
// Um id que o back não conhece responde 200 sem efeito: o wa-back não tem como saber de antemão.
const { chamarRotaInterna, ErroRotaInterna } = require("./internoHttpClient");
const { mensagemWaIdValido } = require("../whatsapp/filtroEntrada");

const ROTA = "/interno/mensagem-status";
const STATUS = new Set(["ENVIADA", "ENTREGUE", "LIDA"]);

/** @typedef {"ENVIADA" | "ENTREGUE" | "LIDA"} StatusMensagem */
/** @typedef {import("./mensagemInternoClient").ContextoInstancia} ContextoInstancia */

/** @param {string} mensagem */
const requisicaoInvalida = (mensagem) => new ErroRotaInterna(mensagem, { rota: ROTA, tipo: "requisicao_invalida" });

/**
 * Registra no back o status de uma mensagem enviada pela equipe.
 * Rejeita com `ErroRotaInterna` (requisição inválida, configuração, rede, prazo ou HTTP não-2xx).
 * @param {string} mensagem_wa_id
 * @param {StatusMensagem} status
 * @param {ContextoInstancia} contexto
 * @returns {Promise<any>}
 */
async function registrarStatusMensagem(mensagem_wa_id, status, { hash_empresa, cod_equipe }) {
  if (!mensagemWaIdValido(mensagem_wa_id)) throw requisicaoInvalida(`Chamada a "${ROTA}" sem mensagem_wa_id válido.`);
  if (!STATUS.has(status)) throw requisicaoInvalida(`Chamada a "${ROTA}" com status inválido.`);
  return chamarRotaInterna(ROTA, { hash_empresa, cod_equipe: Number(cod_equipe), mensagem_wa_id, status });
}

module.exports = { registrarStatusMensagem };
