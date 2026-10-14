// @ts-check
// Cliente da rota interna de status da conexão WhatsApp de cada equipe no apice-gestao-back.
const { chamarRotaInterna } = require("./internoHttpClient");

/** @typedef {import("../whatsapp/BaileysAdapter").StatusConexao} StatusConexao */

/**
 * @typedef {{
 *   hash_empresa: string,
 *   status_conexao: StatusConexao,
 *   ultimo_erro_conexao: string | null,
 * }} StatusParaReportar
 */

/**
 * Reporta ao back o status da conexão de uma equipe (`POST /interno/wa/status`). O `hash_empresa`
 * vem junto do status porque a instância é por equipe, e toda escrita no back é escopada pelo tenant.
 * Rejeita com `ErroRotaInterna` (quem chama registra a falha; o processo nunca cai por isso).
 * @param {string | number} codEquipe
 * @param {StatusParaReportar} status
 * @returns {Promise<any>}
 */
function reportarStatus(codEquipe, status) {
  return chamarRotaInterna("/interno/wa/status", {
    hash_empresa: status.hash_empresa,
    cod_equipe: Number(codEquipe),
    status_conexao: status.status_conexao,
    ultimo_erro_conexao: status.ultimo_erro_conexao ?? null,
  });
}

module.exports = { reportarStatus };
