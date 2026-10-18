// @ts-check
// Tratador de erros do registrarControllers: JSON malformado, resposta já iniciada e rota inexistente.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const { registrarControllers } = require("../../src/http");

/** @param {Array<(server: import("express").Express) => void>} controllers */
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
    fechar: () => {
      servidor.closeAllConnections();
      return new Promise((resolve) => servidor.close(() => resolve(undefined)));
    },
  };
}

/** Silencia o console.error do tratador e devolve o que foi logado. */
function capturarErros() {
  const original = console.error;
  /** @type {unknown[][]} */
  const linhas = [];
  console.error = (...args) => void linhas.push(args);
  return { linhas, restaurar: () => void (console.error = original) };
}

/** @param {import("express").Express} server */
const EcoController = (server) => {
  server.post("/eco", (req, res) => res.status(200).json(req.body));
};

test("JSON malformado no corpo responde 400 em pt-BR, sem 500 e sem logar como erro interno", async () => {
  const { baseUrl, fechar } = await subir([EcoController]);
  const log = capturarErros();
  try {
    const resposta = await fetch(`${baseUrl}/eco`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{ não é json" });
    assert.equal(resposta.status, 400);
    assert.deepEqual(await resposta.json(), { msg: "Corpo da requisição inválido." });
    assert.equal(log.linhas.length, 0);
  } finally {
    log.restaurar();
    await fechar();
  }
});

test("rota inexistente responde 404 em pt-BR", async () => {
  const { baseUrl, fechar } = await subir([EcoController]);
  try {
    const resposta = await fetch(`${baseUrl}/nao-existe`);
    assert.equal(resposta.status, 404);
    assert.deepEqual(await resposta.json(), { msg: "Rota não encontrada." });
  } finally {
    await fechar();
  }
});

test("erro depois de a resposta já ter começado não troca o status por 500: a conexão é encerrada", async () => {
  /** @param {import("express").Express} server */
  const ParcialController = (server) => {
    server.get("/parcial", async (_req, res) => {
      res.status(200).write("começo");
      throw new Error("falha no meio da resposta");
    });
  };
  const { baseUrl, fechar } = await subir([ParcialController]);
  const log = capturarErros();
  try {
    const resposta = await fetch(`${baseUrl}/parcial`);
    assert.equal(resposta.status, 200);
    await assert.rejects(resposta.text());
    // Sem o `headersSent → next(erro)`, o tratador logaria e tentaria responder 500 por cima.
    assert.ok(
      log.linhas.every((l) => !String(l[0]).startsWith("[HTTP] Erro não tratado:")),
      "o tratador não pode tratar como erro interno uma resposta já iniciada"
    );
  } finally {
    log.restaurar();
    await fechar();
  }
});

test("um erro que não é Error (string lançada) também vira 500 genérico e é logado sem vazar na resposta", async () => {
  /** @param {import("express").Express} server */
  const TextoController = (server) => {
    server.get("/texto", async () => {
      throw "segredo-em-texto";
    });
  };
  const { baseUrl, fechar } = await subir([TextoController]);
  const log = capturarErros();
  try {
    const resposta = await fetch(`${baseUrl}/texto`);
    assert.equal(resposta.status, 500);
    const corpo = await resposta.text();
    assert.deepEqual(JSON.parse(corpo), { msg: "Erro interno do servidor." });
    assert.ok(!corpo.includes("segredo"));
    assert.equal(log.linhas.length, 1);
    assert.equal(log.linhas[0][1], "segredo-em-texto");
  } finally {
    log.restaurar();
    await fechar();
  }
});
