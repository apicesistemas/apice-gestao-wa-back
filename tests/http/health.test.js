// @ts-check
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { iniciarServidor } = require("../../src/index");

test("smoke: o servidor sobe e GET /health responde 200", async () => {
  const servidor = await iniciarServidor(0);
  try {
    const endereco = servidor.address();
    assert.ok(endereco && typeof endereco === "object");
    const resposta = await fetch(`http://127.0.0.1:${endereco.port}/health`);
    assert.equal(resposta.status, 200);
    assert.deepEqual(await resposta.json(), { status: "ok" });
  } finally {
    await new Promise((resolve) => servidor.close(resolve));
  }
});
