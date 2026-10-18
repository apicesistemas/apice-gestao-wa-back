// @ts-check
// Trava das operações de grupo (Fase 28, Task 28.1): uma por equipe, abortável, separada do comTrava.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { criarTravaGrupo, padrao } = require("../../src/whatsapp/travaGrupo");

test("a segunda entrada da mesma equipe é recusada; outra equipe não é afetada", () => {
  const trava = criarTravaGrupo();
  const a = trava.entrar("1");
  assert.ok(a instanceof AbortSignal);
  assert.equal(trava.entrar("1"), null);
  assert.equal(trava.entrar(1), null, "número e texto são a mesma equipe");
  assert.ok(trava.entrar("2"));
  assert.equal(trava.ocupada("1"), true);
  assert.equal(trava.ocupada("3"), false);
});

test("sair libera a equipe (inclusive depois de exceção, no finally)", async () => {
  const trava = criarTravaGrupo();
  const sinal = trava.entrar("1");
  assert.ok(sinal);
  await assert.rejects(async () => {
    try {
      throw new Error("falha qualquer");
    } finally {
      trava.sair("1", sinal);
    }
  });
  assert.equal(trava.ocupada("1"), false);
  assert.ok(trava.entrar("1"));
  trava.sair("1");
  trava.sair("1"); // idempotente
  assert.equal(trava.ocupada("1"), false);
});

test("abortar interrompe o sinal e libera a trava na hora; o sair tardio da operação velha não derruba a nova", () => {
  const trava = criarTravaGrupo();
  const velha = /** @type {AbortSignal} */ (trava.entrar("1"));
  assert.equal(velha.aborted, false);
  assert.equal(trava.abortar("1"), true);
  assert.equal(velha.aborted, true);
  assert.equal(trava.ocupada("1"), false);
  const nova = /** @type {AbortSignal} */ (trava.entrar("1"));
  trava.sair("1", velha);
  assert.equal(trava.ocupada("1"), true, "a trava é da operação nova");
  assert.equal(nova.aborted, false);
  assert.equal(trava.abortar("9"), false, "sem operação, nada a abortar");
});

test("abortarTodas interrompe todas as equipes (desligamento)", () => {
  const trava = criarTravaGrupo();
  const a = /** @type {AbortSignal} */ (trava.entrar("1"));
  const b = /** @type {AbortSignal} */ (trava.entrar("2"));
  trava.abortarTodas();
  assert.equal(a.aborted && b.aborted, true);
  assert.equal(trava.ocupada("1") || trava.ocupada("2"), false);
});

test("o módulo expõe a trava do processo", () => {
  assert.equal(typeof padrao.entrar, "function");
});
