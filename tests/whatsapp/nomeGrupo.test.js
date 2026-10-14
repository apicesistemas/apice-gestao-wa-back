// @ts-check
// Nome (subject) do grupo para o `nome_chat` do registro: `groupMetadata` com cache, prazo curto
// e nunca rejeita. O socket é um objeto falso.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { criarCacheNomeGrupo } = require("../../src/whatsapp/nomeGrupo");
const { JID_GRUPO } = require("../helpers/mensagensWa");

test("busca o subject uma vez e devolve do cache nas mensagens seguintes (chamadas simultâneas compartilham a busca)", async () => {
  const cache = criarCacheNomeGrupo();
  let chamadas = 0;
  const socket = {
    groupMetadata: async (/** @type {string} */ jid) => {
      chamadas += 1;
      return { id: jid, subject: "  Suporte Loja Centro  " };
    },
  };
  const [a, b] = await Promise.all([cache.obterNome(socket, JID_GRUPO), cache.obterNome(socket, JID_GRUPO)]);
  assert.equal(a, "Suporte Loja Centro");
  assert.equal(b, "Suporte Loja Centro");
  assert.equal(await cache.obterNome(socket, JID_GRUPO), "Suporte Loja Centro");
  assert.equal(chamadas, 1);
});

test("o cache expira pelo TTL", async () => {
  let agora = 1000;
  const cache = criarCacheNomeGrupo({ msTtl: 100, agora: () => agora });
  let n = 0;
  const socket = { groupMetadata: async () => ({ subject: `Grupo ${++n}` }) };
  assert.equal(await cache.obterNome(socket, JID_GRUPO), "Grupo 1");
  agora += 50;
  assert.equal(await cache.obterNome(socket, JID_GRUPO), "Grupo 1");
  agora += 100;
  assert.equal(await cache.obterNome(socket, JID_GRUPO), "Grupo 2");
});

test("falha, prazo esgotado ou subject vazio devolvem null sem rejeitar, e a falha não é repetida a cada mensagem", async () => {
  const cache = criarCacheNomeGrupo({ msPrazo: 20 });
  let chamadas = 0;
  const falho = {
    groupMetadata: async () => {
      chamadas += 1;
      throw new Error("rate-overlimit");
    },
  };
  assert.equal(await cache.obterNome(falho, JID_GRUPO), null);
  assert.equal(await cache.obterNome(falho, JID_GRUPO), null);
  assert.equal(chamadas, 1);

  const inicio = Date.now();
  const lento = { groupMetadata: () => new Promise(() => {}) };
  assert.equal(await cache.obterNome(lento, "120363000000000077@g.us"), null);
  assert.ok(Date.now() - inicio < 1000, "o prazo curto limita a espera");

  const vazio = { groupMetadata: async () => ({ subject: "   " }) };
  assert.equal(await cache.obterNome(vazio, "120363000000000078@g.us"), null);
  assert.equal(await cache.obterNome(/** @type {any} */ ({}), "120363000000000079@g.us"), null);
  assert.equal(await cache.obterNome(vazio, "5511900000001@s.whatsapp.net"), null, "só grupos");
});

test("groups.update com subject novo atualiza o cache sem nova consulta", async () => {
  const cache = criarCacheNomeGrupo();
  let chamadas = 0;
  const socket = {
    groupMetadata: async () => {
      chamadas += 1;
      return { subject: "Nome antigo" };
    },
  };
  assert.equal(await cache.obterNome(socket, JID_GRUPO), "Nome antigo");
  cache.aprender([{ id: JID_GRUPO, subject: "Nome novo" }, { id: JID_GRUPO, announce: true }, /** @type {any} */ (null)]);
  assert.equal(await cache.obterNome(socket, JID_GRUPO), "Nome novo");
  assert.equal(chamadas, 1);
});
