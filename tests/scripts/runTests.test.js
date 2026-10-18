// @ts-check
// scripts/run-tests.js: flags de cobertura e código de saída abaixo/acima do limite, num projeto
// temporário (nada do projeto real é medido). Só o código de saída é conferido, nunca o texto do Node.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { montarArgumentos, listarArquivosDeTeste, LIMITES_COBERTURA } = require("../../scripts/run-tests");

const SCRIPT = path.resolve(__dirname, "../../scripts/run-tests.js");

test("sem --cobertura, a suíte roda só com --test e os arquivos", () => {
  assert.deepEqual(montarArgumentos(["tests/a.test.js"], false), ["--test", "tests/a.test.js"]);
});

test("com --cobertura, entram as flags 95/88/90 e o include src/** antes dos arquivos", () => {
  assert.deepEqual(LIMITES_COBERTURA, { linhas: 95, desvios: 88, funcoes: 90 });
  assert.deepEqual(montarArgumentos(["tests/a.test.js"], true), [
    "--test",
    "--experimental-test-coverage",
    "--test-coverage-include=src/**",
    "--test-coverage-lines=95",
    "--test-coverage-branches=88",
    "--test-coverage-functions=90",
    "tests/a.test.js",
  ]);
});

test("listarArquivosDeTeste acha só *.test.js, em subpastas, relativos à raiz", () => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "wa-runtests-lista-"));
  try {
    fs.mkdirSync(path.join(raiz, "tests", "sub"), { recursive: true });
    fs.writeFileSync(path.join(raiz, "tests", "a.test.js"), "");
    fs.writeFileSync(path.join(raiz, "tests", "sub", "b.test.js"), "");
    fs.writeFileSync(path.join(raiz, "tests", "ajuda.js"), "");
    assert.deepEqual(listarArquivosDeTeste(raiz).sort(), [path.join("tests", "a.test.js"), path.join("tests", "sub", "b.test.js")]);
  } finally {
    fs.rmSync(raiz, { recursive: true, force: true });
  }
});

/**
 * Cria um projeto mínimo (src/alvo.js + um teste) e roda o run-tests.js dele com --cobertura.
 * @param {string} codigoAlvo
 * @param {string} codigoTeste
 */
function rodarProjeto(codigoAlvo, codigoTeste) {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "wa-runtests-"));
  try {
    fs.mkdirSync(path.join(raiz, "src"));
    fs.mkdirSync(path.join(raiz, "tests"));
    fs.writeFileSync(path.join(raiz, "src", "alvo.js"), codigoAlvo);
    fs.writeFileSync(path.join(raiz, "tests", "alvo.test.js"), codigoTeste);
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT; // senão o filho se acha dentro de um runner e não mede nada
    delete env.NODE_V8_COVERAGE;
    return spawnSync(process.execPath, [SCRIPT, "--cobertura"], { cwd: raiz, env, encoding: "utf8", timeout: 60_000 });
  } finally {
    fs.rmSync(raiz, { recursive: true, force: true });
  }
}

const TESTE = `const { test } = require("node:test");
const assert = require("node:assert/strict");
const { somar } = require("../src/alvo");
test("soma", () => assert.equal(somar(1, 2), 3));
`;

test("projeto com cobertura abaixo do limite sai com código ≠ 0", () => {
  const nuncaChamadas = Array.from({ length: 9 }, (_, i) => `function f${i}() {\n  return ${i};\n}`).join("\n");
  const r = rodarProjeto(`function somar(a, b) {\n  return a + b;\n}\n${nuncaChamadas}\nmodule.exports = { somar };\n`, TESTE);
  assert.equal(r.error, undefined);
  assert.notEqual(r.status, 0);
});

test("projeto totalmente coberto sai com código 0", () => {
  const r = rodarProjeto("function somar(a, b) {\n  return a + b;\n}\nmodule.exports = { somar };\n", TESTE);
  assert.equal(r.error, undefined);
  assert.equal(r.status, 0);
});
