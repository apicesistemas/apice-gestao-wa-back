// @ts-check
const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const exigirTokenServico = require("../../src/http/exigirTokenServico");

const TOKEN = "token-de-servico-de-teste";

/** @type {http.Server} */
let servidor;
/** @type {string} */
let baseUrl;
/** @type {string | undefined} */
let tokenOriginal;

beforeEach(async () => {
  tokenOriginal = process.env.WA_BACK_ADMIN_TOKEN;
  process.env.WA_BACK_ADMIN_TOKEN = TOKEN;

  const app = express();
  app.get("/interno/protegida", exigirTokenServico, (_req, res) => {
    res.status(200).json({ msg: "ok" });
  });
  servidor = http.createServer(app);
  await new Promise((resolve) => servidor.listen(0, () => resolve(undefined)));
  const endereco = servidor.address();
  assert.ok(endereco && typeof endereco === "object");
  baseUrl = `http://127.0.0.1:${endereco.port}`;
});

afterEach(async () => {
  if (tokenOriginal === undefined) delete process.env.WA_BACK_ADMIN_TOKEN;
  else process.env.WA_BACK_ADMIN_TOKEN = tokenOriginal;
  await new Promise((resolve) => servidor.close(() => resolve(undefined)));
});

test("uma chamada com token válido a uma rota protegida passa", async () => {
  const resposta = await fetch(`${baseUrl}/interno/protegida`, {
    headers: { "X-Internal-Token": TOKEN },
  });
  assert.equal(resposta.status, 200);
  assert.deepEqual(await resposta.json(), { msg: "ok" });
});

test("uma chamada sem token responde 401 com mensagem em pt-BR", async () => {
  const resposta = await fetch(`${baseUrl}/interno/protegida`);
  assert.equal(resposta.status, 401);
  assert.deepEqual(await resposta.json(), { msg: "Acesso negado. Token de serviço inválido." });
});

test("uma chamada com token errado responde 401", async () => {
  const resposta = await fetch(`${baseUrl}/interno/protegida`, {
    headers: { "X-Internal-Token": "token-errado" },
  });
  assert.equal(resposta.status, 401);
});

test("token na query string não é aceito (só o header vale)", async () => {
  const resposta = await fetch(`${baseUrl}/interno/protegida?token=${TOKEN}`);
  assert.equal(resposta.status, 401);
});

test("sem token configurado no ambiente, nenhuma chamada passa (nem com header vazio)", async () => {
  delete process.env.WA_BACK_ADMIN_TOKEN;
  const resposta = await fetch(`${baseUrl}/interno/protegida`, {
    headers: { "X-Internal-Token": "" },
  });
  assert.equal(resposta.status, 401);
});
