// @ts-check
const { test } = require("node:test");
const assert = require("node:assert/strict");
const net = require("node:net");
const os = require("node:os");
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

test("iniciarServidor(0) escuta só em 127.0.0.1 e /health e /ping respondem por ele", async () => {
  const servidor = await iniciarServidor(0);
  try {
    const endereco = servidor.address();
    assert.ok(endereco && typeof endereco === "object");
    assert.equal(endereco.address, "127.0.0.1");
    assert.equal((await fetch(`http://127.0.0.1:${endereco.port}/health`)).status, 200);
    const ping = await fetch(`http://127.0.0.1:${endereco.port}/ping`);
    assert.ok([200, 503].includes(ping.status));
  } finally {
    await new Promise((resolve) => servidor.close(resolve));
  }
});

test("iniciarServidor aceita o host informado", async () => {
  const servidor = await iniciarServidor(0, "127.0.0.1");
  try {
    const endereco = servidor.address();
    assert.ok(endereco && typeof endereco === "object");
    assert.equal(endereco.address, "127.0.0.1");
  } finally {
    await new Promise((resolve) => servidor.close(resolve));
  }
});

test("pelo IPv4 não loopback da máquina a conexão é recusada", async (t) => {
  const externo = Object.values(os.networkInterfaces())
    .flat()
    .find((i) => i && i.family === "IPv4" && !i.internal);
  if (!externo) {
    t.skip("a máquina não tem outra interface IPv4");
    return;
  }
  const servidor = await iniciarServidor(0);
  try {
    const endereco = servidor.address();
    assert.ok(endereco && typeof endereco === "object");
    const codigo = await new Promise((resolve) => {
      const socket = net.connect({ host: externo.address, port: endereco.port });
      socket.setTimeout(3000, () => {
        socket.destroy();
        resolve("TIMEOUT");
      });
      socket.once("connect", () => {
        socket.destroy();
        resolve("CONECTOU");
      });
      socket.once("error", (erro) => resolve(/** @type {NodeJS.ErrnoException} */ (erro).code));
    });
    assert.equal(codigo, "ECONNREFUSED");
  } finally {
    await new Promise((resolve) => servidor.close(resolve));
  }
});
