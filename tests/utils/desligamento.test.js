// @ts-check
// Estado de desligamento do processo (Task 14.3): depois de `marcarEncerrando`, as rotas protegidas
// respondem 503 (com Retry-After), e `aguardarEmAndamento` espera as requisições que já tinham
// entrado terminarem de responder.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { criarDesligamento, MSG_REINICIANDO } = require("../../src/utils/desligamento");

/** Resposta falsa do Express: guarda status, headers e corpo, e emite `close` quando o teste quiser. */
function respostaFalsa() {
  const res = Object.assign(new EventEmitter(), {
    statusCode: 200,
    /** @type {Record<string, string>} */
    headers: {},
    /** @type {any} */
    corpo: undefined,
    /** @param {number} codigo */
    status(codigo) {
      res.statusCode = codigo;
      return res;
    },
    /** @param {string} nome @param {string} valor */
    set(nome, valor) {
      res.headers[nome.toLowerCase()] = valor;
      return res;
    },
    /** @param {any} corpo */
    json(corpo) {
      res.corpo = corpo;
      return res;
    },
  });
  return res;
}

test("fora do desligamento a requisição segue (next) e é rastreada até a resposta fechar", async () => {
  const d = criarDesligamento();
  const res = respostaFalsa();
  let seguiu = false;
  d.recusarDuranteEncerramento(/** @type {any} */ ({}), /** @type {any} */ (res), () => (seguiu = true));
  assert.equal(seguiu, true);
  assert.equal(d.emAndamento(), 1);
  res.emit("close");
  assert.equal(d.emAndamento(), 0);
});

test("durante o desligamento responde 503 com msg e Retry-After, sem chamar o next", () => {
  const d = criarDesligamento();
  d.marcarEncerrando();
  assert.equal(d.estaEncerrando(), true);
  const res = respostaFalsa();
  let seguiu = false;
  d.recusarDuranteEncerramento(/** @type {any} */ ({}), /** @type {any} */ (res), () => (seguiu = true));
  assert.equal(seguiu, false);
  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.corpo, { msg: MSG_REINICIANDO });
  assert.ok(Number(res.headers["retry-after"]) > 0);
  assert.equal(d.emAndamento(), 0);
});

test("aguardarEmAndamento resolve na hora sem requisições, e espera as que já tinham entrado", async () => {
  const d = criarDesligamento();
  await d.aguardarEmAndamento();

  const res = respostaFalsa();
  d.recusarDuranteEncerramento(/** @type {any} */ ({}), /** @type {any} */ (res), () => {});
  d.marcarEncerrando();
  let terminou = false;
  const espera = d.aguardarEmAndamento().then(() => (terminou = true));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(terminou, false);
  res.emit("close");
  res.emit("close"); // close repetido não conta duas vezes
  await espera;
  assert.equal(terminou, true);
  assert.equal(d.emAndamento(), 0);
});
