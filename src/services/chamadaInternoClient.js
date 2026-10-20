// @ts-check
// Cliente das rotas internas das chamadas de voz e vídeo no apice-gestao-back (Fase 34):
// - `POST /interno/chamada` (C1, Task 34.2): o registro final de UMA chamada. Uma nova tentativa só
//   para 503, rede ou prazo; 404, 400 e 500 não se repetem (a próxima não mudaria nada);
// - `POST /interno/chamada-alerta` (C2, Task 34.6): "tocando" e "parou". Prazo técnico curto próprio e
//   nenhuma nova tentativa: um alerta atrasado não serve.
// `hash_empresa` e `cod_equipe` vêm da instância. Rejeita com `ErroRotaInterna`; quem chama só loga.
const { chamarRotaInterna } = require("./internoHttpClient");

const ROTA_REGISTRO = "/interno/chamada";
const ROTA_ALERTA = "/interno/chamada-alerta";
/** Prazo técnico do alerta (um alerta que demora mais já não serve). */
const MS_PRAZO_ALERTA = 3000;
/** Espera técnica antes da única nova tentativa do registro. */
const MS_ESPERA_NOVA_TENTATIVA = 1000;

/** @typedef {import("./mensagemInternoClient").ContextoInstancia} ContextoInstancia */
/** @typedef {{ jid: string | null, lid: string | null, telefone: string | null }} IdentidadeChamada */
/**
 * Corpo do C1 sem `hash_empresa` e `cod_equipe` (vêm do contexto).
 * @typedef {{
 *   chamada_wa_id: string,
 *   origem: "CLIENTE" | "APARELHO",
 *   tipo_chat: "GRUPO" | "PRIVADO",
 *   chat_jid: string,
 *   remetente: IdentidadeChamada & { nome: null },
 *   contato: IdentidadeChamada | null,
 *   video: boolean | null,
 *   resultado: string,
 *   timestamp_wa: number,
 *   nome_chat?: string,
 * }} RegistroChamadaCorpo
 */
/**
 * Corpo do C2 sem `hash_empresa` e `cod_equipe`. No PAROU só `chamada_wa_id` e `situacao` seguem.
 * @typedef {{
 *   chamada_wa_id: string,
 *   situacao: "TOCANDO" | "PAROU",
 *   tipo_chat?: "GRUPO" | "PRIVADO",
 *   chat_jid?: string,
 *   remetente?: IdentidadeChamada & { nome: null },
 *   contato?: IdentidadeChamada | null,
 *   video?: boolean | null,
 * }} AlertaChamadaCorpo
 */

/**
 * @param {unknown} erro
 * @returns {boolean} 503, falha de rede ou prazo
 */
function valeNovaTentativa(erro) {
  const { tipo, status } = /** @type {{ tipo?: unknown, status?: unknown }} */ (erro && typeof erro === "object" ? erro : {});
  return tipo === "rede" || tipo === "timeout" || (tipo === "http" && status === 503);
}

/**
 * Registra uma chamada no back (C1).
 * @param {RegistroChamadaCorpo} chamada
 * @param {ContextoInstancia} contexto
 * @param {{ msEspera?: number }} [opcoes] `msEspera`: espera antes da nova tentativa (testes passam 0)
 * @returns {Promise<any>}
 */
async function registrarChamada(chamada, { hash_empresa, cod_equipe }, { msEspera = MS_ESPERA_NOVA_TENTATIVA } = {}) {
  const corpo = { ...chamada, hash_empresa, cod_equipe: Number(cod_equipe) };
  try {
    return await chamarRotaInterna(ROTA_REGISTRO, corpo);
  } catch (erro) {
    if (!valeNovaTentativa(erro)) throw erro;
    await new Promise((resolve) => setTimeout(resolve, msEspera));
    return chamarRotaInterna(ROTA_REGISTRO, corpo);
  }
}

/**
 * Avisa o back que uma ligação está tocando ou parou (C2). Sem nova tentativa.
 * @param {AlertaChamadaCorpo} alerta
 * @param {ContextoInstancia} contexto
 * @param {{ timeoutMs?: number }} [opcoes]
 * @returns {Promise<any>}
 */
function alertarChamada(alerta, { hash_empresa, cod_equipe }, { timeoutMs = MS_PRAZO_ALERTA } = {}) {
  /** @type {Record<string, unknown>} */
  const corpo = { chamada_wa_id: alerta.chamada_wa_id, situacao: alerta.situacao };
  if (alerta.situacao === "TOCANDO") {
    corpo.tipo_chat = alerta.tipo_chat;
    corpo.chat_jid = alerta.chat_jid;
    corpo.remetente = alerta.remetente;
    corpo.contato = alerta.contato ?? null;
    corpo.video = alerta.video ?? null;
  }
  return chamarRotaInterna(ROTA_ALERTA, { ...corpo, hash_empresa, cod_equipe: Number(cod_equipe) }, { timeoutMs });
}

module.exports = { registrarChamada, alertarChamada, MS_PRAZO_ALERTA, MS_ESPERA_NOVA_TENTATIVA };
