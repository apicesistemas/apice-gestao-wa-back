// @ts-check
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { criarRegistroAparelho } = require("../../src/whatsapp/registroAparelho");

/**
 * @param {string} id
 * @param {"CLIENTE" | "APARELHO"} origem
 */
const mensagem = (id, origem) => ({ mensagem_wa_id: id, origem });

test("mensagem do cliente sempre é registrada", () => {
  const registro = criarRegistroAparelho();
  registro.marcarEnviada("3EB0A");
  assert.equal(registro.deveRegistrar(mensagem("3EB0B", "CLIENTE")), true);
  // Mesmo id de uma enviada pelo CRM: o cliente não é eco (ids são do remetente).
  assert.equal(registro.deveRegistrar(mensagem("3EB0A", "CLIENTE")), true);
});

test("fromMe digitada no aparelho (não enviada pelo CRM) é registrada", () => {
  const registro = criarRegistroAparelho();
  assert.equal(registro.ehEcoDoCrm(mensagem("3EB0C", "APARELHO")), false);
  assert.equal(registro.deveRegistrar(mensagem("3EB0C", "APARELHO")), true);
});

test("o eco de um envio do CRM (id marcado em enviadas) é descartado, inclusive se chegar duas vezes", () => {
  const registro = criarRegistroAparelho();
  registro.marcarEnviada("3EB0D");
  assert.equal(registro.ehEcoDoCrm(mensagem("3EB0D", "APARELHO")), true);
  assert.equal(registro.deveRegistrar(mensagem("3EB0D", "APARELHO")), false);
  assert.equal(registro.deveRegistrar(mensagem("3EB0D", "APARELHO")), false);
});

test("o cache enviadas expira pelo prazo e respeita o tamanho máximo (FIFO)", () => {
  let agora = 1_000;
  const registro = criarRegistroAparelho({ ttlMs: 100, maxEnviadas: 2, agora: () => agora });
  registro.marcarEnviada("3EB0E");
  agora += 101;
  assert.equal(registro.ehEcoDoCrm(mensagem("3EB0E", "APARELHO")), false, "expirou");

  registro.marcarEnviada("3EB01");
  registro.marcarEnviada("3EB02");
  registro.marcarEnviada("3EB03");
  assert.equal(registro.ehEcoDoCrm(mensagem("3EB01", "APARELHO")), false, "o mais antigo saiu");
  assert.equal(registro.ehEcoDoCrm(mensagem("3EB03", "APARELHO")), true);
});

test("id inválido não entra no cache e limpar() esvazia", () => {
  const registro = criarRegistroAparelho();
  registro.marcarEnviada("");
  registro.marcarEnviada(/** @type {any} */ (null));
  assert.equal(registro.ehEcoDoCrm(mensagem("", "APARELHO")), false);
  registro.marcarEnviada("3EB0F");
  registro.limpar();
  assert.equal(registro.ehEcoDoCrm(mensagem("3EB0F", "APARELHO")), false);
});
