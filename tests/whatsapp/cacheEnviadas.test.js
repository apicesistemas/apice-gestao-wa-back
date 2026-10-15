// @ts-check
// Cache das mensagens enviadas pelo CRM para o `getMessage` do Baileys (pedido de reenvio /
// "Aguardando mensagem"). Só em memória, com TTL e teto, e só para o destino do envio. Sem a
// mensagem devolve `undefined`, NUNCA `{ conversation: "" }` (a bolha vazia substituiria a original).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { criarCacheEnviadas } = require("../../src/whatsapp/cacheEnviadas");
const { JID_CLIENTE, LID_CLIENTE, JID_GRUPO, JID_PARTICIPANTE } = require("../helpers/mensagensWa");

const MENSAGEM = { conversation: "Seu acesso foi liberado." };

test("sem a mensagem no cache, devolve undefined (nunca uma mensagem vazia)", async () => {
  const cache = criarCacheEnviadas();
  const resultado = await cache.obter({ remoteJid: JID_CLIENTE, id: "DESCONHECIDO" });
  assert.equal(resultado, undefined);
  assert.equal(await cache.obter(undefined), undefined);
  assert.equal(await cache.obter({ remoteJid: JID_CLIENTE }), undefined);
});

test("devolve o message guardado para o destino do envio (inclusive com sufixo de aparelho no JID)", async () => {
  const cache = criarCacheEnviadas();
  cache.guardar("ID1", MENSAGEM, [JID_CLIENTE, LID_CLIENTE]);
  assert.deepEqual(await cache.obter({ remoteJid: JID_CLIENTE, id: "ID1" }), MENSAGEM);
  assert.deepEqual(await cache.obter({ remoteJid: JID_CLIENTE.replace("@", ":3@"), id: "ID1" }), MENSAGEM);
  assert.deepEqual(await cache.obter({ remoteJid: LID_CLIENTE, id: "ID1" }), MENSAGEM);
});

test("pedido de reenvio de outro destino não recebe a mensagem", async () => {
  const cache = criarCacheEnviadas();
  cache.guardar("ID1", MENSAGEM, [JID_CLIENTE]);
  assert.equal(await cache.obter({ remoteJid: "5511900000777@s.whatsapp.net", id: "ID1" }), undefined);
  // A entrada continua para o destino certo.
  assert.deepEqual(await cache.obter({ remoteJid: JID_CLIENTE, id: "ID1" }), MENSAGEM);
});

test("no grupo, o pedido vem com o JID do grupo (e o participante)", async () => {
  const cache = criarCacheEnviadas();
  cache.guardar("ID1", MENSAGEM, [JID_GRUPO]);
  assert.deepEqual(await cache.obter({ remoteJid: JID_GRUPO, participant: JID_PARTICIPANTE, id: "ID1" }), MENSAGEM);
});

test("a mensagem expira no TTL e o cache tem teto (a mais antiga sai primeiro)", async () => {
  let agora = 1000;
  const cache = criarCacheEnviadas({ ttlMs: 100, max: 2, agora: () => agora });
  cache.guardar("A", MENSAGEM, [JID_CLIENTE]);
  cache.guardar("B", MENSAGEM, [JID_CLIENTE]);
  cache.guardar("C", MENSAGEM, [JID_CLIENTE]);
  assert.equal(await cache.obter({ remoteJid: JID_CLIENTE, id: "A" }), undefined);
  assert.deepEqual(await cache.obter({ remoteJid: JID_CLIENTE, id: "C" }), MENSAGEM);
  agora += 101;
  assert.equal(await cache.obter({ remoteJid: JID_CLIENTE, id: "C" }), undefined);
});

test("guardar sem id, sem message ou sem destino válido não guarda nada; limpar esvazia", async () => {
  const cache = criarCacheEnviadas();
  cache.guardar("", MENSAGEM, [JID_CLIENTE]);
  cache.guardar("ID1", null, [JID_CLIENTE]);
  cache.guardar("ID2", MENSAGEM, ["invalido"]);
  assert.equal(cache.tamanho(), 0);
  cache.guardar("ID3", MENSAGEM, [JID_CLIENTE]);
  cache.limpar();
  assert.equal(await cache.obter({ remoteJid: JID_CLIENTE, id: "ID3" }), undefined);
});
