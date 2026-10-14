// @ts-check
// Cliente da rota interna do "digitando..." do cliente (`POST /interno/presenca`) no
// apice-gestao-back. A rota é criada no back na Task 7.1; até lá a chamada falha com
// `ErroRotaInterna` e quem chama (presenca.js) só registra no log.
//
// Contrato (JSON):
// - `hash_empresa`, `cod_equipe` (número): tenant e equipe da instância;
// - `chat_jid`: a conversa (privada ou `@g.us`);
// - `participante_jid`: quem está digitando no grupo; `null` na conversa privada;
// - `estado`: `DIGITANDO`, `GRAVANDO` (áudio) ou `PARADO`.
const { chamarRotaInterna, ErroRotaInterna } = require("./internoHttpClient");

const ROTA = "/interno/presenca";
const ESTADOS = new Set(["DIGITANDO", "GRAVANDO", "PARADO"]);

/** @typedef {"DIGITANDO" | "GRAVANDO" | "PARADO"} EstadoPresenca */
/** @typedef {{ chat_jid: string, participante_jid: string | null, estado: EstadoPresenca }} DadosPresenca */
/** @typedef {import("./mensagemInternoClient").ContextoInstancia} ContextoInstancia */

/** @param {string} mensagem */
const requisicaoInvalida = (mensagem) => new ErroRotaInterna(mensagem, { rota: ROTA, tipo: "requisicao_invalida" });

/**
 * Registra no back a mudança de presença de um contato numa conversa.
 * Rejeita com `ErroRotaInterna` (requisição inválida, configuração, rede, prazo ou HTTP não-2xx).
 * @param {DadosPresenca} dados
 * @param {ContextoInstancia} contexto
 * @returns {Promise<any>}
 */
async function registrarPresenca({ chat_jid, participante_jid, estado }, { hash_empresa, cod_equipe }) {
  if (typeof chat_jid !== "string" || !chat_jid.includes("@")) throw requisicaoInvalida(`Chamada a "${ROTA}" sem chat_jid.`);
  if (!ESTADOS.has(estado)) throw requisicaoInvalida(`Chamada a "${ROTA}" com estado inválido.`);
  return chamarRotaInterna(ROTA, {
    hash_empresa,
    cod_equipe: Number(cod_equipe),
    chat_jid,
    participante_jid: typeof participante_jid === "string" && participante_jid ? participante_jid : null,
    estado,
  });
}

module.exports = { registrarPresenca };
