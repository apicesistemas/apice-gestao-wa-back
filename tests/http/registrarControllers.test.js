// @ts-check
const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const { registrarControllers } = require("../../src/http");

/**
 * Sobe um app com os controllers informados e devolve a URL base e o fechamento.
 * @param {Array<(server: import("express").Express) => void>} controllers
 */
async function subir(controllers) {
  const app = express();
  app.use(express.json());
  registrarControllers(app, controllers);
  const servidor = http.createServer(app);
  await new Promise((resolve) => servidor.listen(0, () => resolve(undefined)));
  const endereco = servidor.address();
  assert.ok(endereco && typeof endereco === "object");
  return {
    baseUrl: `http://127.0.0.1:${endereco.port}`,
    fechar: () => new Promise((resolve) => servidor.close(() => resolve(undefined))),
  };
}

test("registrarControllers registra um controller de exemplo", async () => {
  /** @param {import("express").Express} server */
  const ExemploController = (server) => {
    server.get("/exemplo", (_req, res) => res.status(200).json({ msg: "exemplo" }));
  };
  const { baseUrl, fechar } = await subir([ExemploController]);
  try {
    const resposta = await fetch(`${baseUrl}/exemplo`);
    assert.equal(resposta.status, 200);
    assert.deepEqual(await resposta.json(), { msg: "exemplo" });
  } finally {
    await fechar();
  }
});

test("erro numa rota responde 500 genérico, sem stack nem mensagem do erro", async () => {
  /** @param {import("express").Express} server */
  const QuebradoController = (server) => {
    server.get("/quebrado", async () => {
      throw new Error("detalhe interno sigiloso");
    });
  };
  const { baseUrl, fechar } = await subir([QuebradoController]);
  try {
    const resposta = await fetch(`${baseUrl}/quebrado`);
    assert.equal(resposta.status, 500);
    const texto = await resposta.text();
    assert.deepEqual(JSON.parse(texto), { msg: "Erro interno do servidor." });
    assert.ok(!texto.includes("sigiloso"));
  } finally {
    await fechar();
  }
});
