// @ts-check
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { iniciarServidor } = require("../../src/index");

/** @type {import("node:http").Server} */
let servidor;
/** @type {string} */
let baseUrl;

before(async () => {
  servidor = await iniciarServidor(0);
  const endereco = servidor.address();
  assert.ok(endereco && typeof endereco === "object");
  baseUrl = `http://127.0.0.1:${endereco.port}`;
});

after(async () => {
  await new Promise((resolve) => servidor.close(() => resolve(undefined)));
});

test("GET /ping responde 200 'ok' sem exigir token", async () => {
  const resposta = await fetch(`${baseUrl}/ping`);
  assert.equal(resposta.status, 200);
  assert.equal(await resposta.text(), "ok");
});

test("GET /health continua respondendo { status: 'ok' }", async () => {
  const resposta = await fetch(`${baseUrl}/health`);
  assert.equal(resposta.status, 200);
  assert.deepEqual(await resposta.json(), { status: "ok" });
});

test("rota inexistente responde 404 com mensagem em pt-BR", async () => {
  const resposta = await fetch(`${baseUrl}/rota-que-nao-existe`);
  assert.equal(resposta.status, 404);
  assert.deepEqual(await resposta.json(), { msg: "Rota não encontrada." });
});
