// Roda tests/**/*.test.js sem depender de glob "**" expandido pelo shell —
// no Windows o glob nunca é expandido pelo shell por trás do yarn, então
// listamos os arquivos explicitamente (padrão do comandax).
const { readdirSync } = require("node:fs");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

// Limites mínimos de cobertura sobre o total de src/ (`yarn test:cobertura`, regra do CLAUDE.md).
const LIMITES_COBERTURA = { linhas: 95, desvios: 88, funcoes: 90 };

/**
 * Lista os *.test.js de `<raiz>/tests`, com caminho relativo à raiz.
 * @param {string} [raiz]
 * @returns {string[]}
 */
function listarArquivosDeTeste(raiz = process.cwd()) {
  return readdirSync(path.join(raiz, "tests"), { recursive: true })
    .map(String)
    .filter((file) => file.endsWith(".test.js"))
    .map((file) => path.join("tests", file));
}

/**
 * Argumentos do `node`: a mesma suíte, com a cobertura do Node (e os limites) quando `cobertura`.
 * @param {string[]} arquivos
 * @param {boolean} cobertura
 * @returns {string[]}
 */
function montarArgumentos(arquivos, cobertura) {
  const argsCobertura = cobertura
    ? [
        "--experimental-test-coverage",
        "--test-coverage-include=src/**",
        `--test-coverage-lines=${LIMITES_COBERTURA.linhas}`,
        `--test-coverage-branches=${LIMITES_COBERTURA.desvios}`,
        `--test-coverage-functions=${LIMITES_COBERTURA.funcoes}`,
      ]
    : [];
  return ["--test", ...argsCobertura, ...arquivos];
}

function executar() {
  const files = listarArquivosDeTeste();
  if (files.length === 0) {
    console.error("Nenhum arquivo *.test.js encontrado em tests/");
    process.exit(1);
  }
  // `--cobertura` (yarn test:cobertura): abaixo de qualquer limite, o Node sai com código ≠ 0.
  const result = spawnSync(process.execPath, montarArgumentos(files, process.argv.includes("--cobertura")), { stdio: "inherit" });
  process.exit(result.status ?? 1);
}

if (require.main === module) executar();

module.exports = { montarArgumentos, listarArquivosDeTeste, LIMITES_COBERTURA };
