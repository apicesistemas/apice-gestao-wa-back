// @ts-check
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { validarVariaveisDeAmbiente, criarEncerrador } = require("../src/index");

test("validarVariaveisDeAmbiente lista as variáveis obrigatórias ausentes", () => {
  assert.deepEqual(validarVariaveisDeAmbiente({}), [
    "CRM_BACK_URL",
    "CRM_BACK_SERVICE_TOKEN",
    "WA_BACK_ADMIN_TOKEN",
  ]);
  assert.deepEqual(
    validarVariaveisDeAmbiente({
      CRM_BACK_URL: "http://127.0.0.1:3500",
      CRM_BACK_SERVICE_TOKEN: "a",
      WA_BACK_ADMIN_TOKEN: "b",
    }),
    []
  );
});

test("importar src/index.js não valida env nem sobe servidor (só o boot real faz isso)", () => {
  // Se o require acima tivesse validado o env sem as variáveis, o processo já teria saído.
  assert.equal(process.exitCode ?? 0, 0);
});

test("o encerrador fecha o HTTP e sai com 0, uma única vez mesmo com dois sinais", async () => {
  /** @type {number[]} */
  const saidas = [];
  let fechamentos = 0;
  const httpServer = /** @type {any} */ ({
    /** @param {() => void} cb */
    close(cb) {
      fechamentos += 1;
      setImmediate(cb);
    },
  });

  const encerrar = criarEncerrador(httpServer, { sair: (codigo) => saidas.push(codigo), tetoMs: 1000 });
  encerrar("SIGTERM");
  encerrar("SIGINT");
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(fechamentos, 1);
  assert.deepEqual(saidas, [0]);
});

test("se o encerramento travar, o teto força a saída com 1", async () => {
  /** @type {number[]} */
  const saidas = [];
  const httpServer = /** @type {any} */ ({ close() {} }); // nunca chama o callback

  const encerrar = criarEncerrador(httpServer, { sair: (codigo) => saidas.push(codigo), tetoMs: 20 });
  encerrar("SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, 60));

  assert.deepEqual(saidas, [1]);
});
