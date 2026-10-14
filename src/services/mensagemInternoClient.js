// @ts-check
// Cliente da rota interna de registro das mensagens recebidas (`POST /interno/mensagem-recebida`)
// no apice-gestao-back. A rota é criada no back na Task 6.1; até lá a chamada falha com
// `ErroRotaInterna` e quem chama (o BaileysAdapter) só registra a falha no log.
const { chamarRotaInterna } = require("./internoHttpClient");

/** @typedef {import("../whatsapp/filtroEntrada").MensagemRecebida} MensagemRecebida */
/** @typedef {{ hash_empresa: string, cod_equipe: string | number }} ContextoInstancia */

/**
 * Envia ao back a MensagemRecebida normalizada, com o tenant e a equipe da instância que recebeu.
 * `hash_empresa` e `cod_equipe` vêm da instância e não podem ser sobrescritos pela mensagem.
 * Rejeita com `ErroRotaInterna` (configuração, rede, prazo ou HTTP não-2xx).
 * @param {MensagemRecebida} mensagem
 * @param {ContextoInstancia} contexto
 * @returns {Promise<any>}
 */
function registrarMensagem(mensagem, { hash_empresa, cod_equipe }) {
  return chamarRotaInterna("/interno/mensagem-recebida", {
    ...mensagem,
    hash_empresa,
    cod_equipe: Number(cod_equipe),
  });
}

module.exports = { registrarMensagem };
