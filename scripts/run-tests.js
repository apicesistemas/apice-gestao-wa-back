// Roda tests/**/*.test.js sem depender de glob "**" expandido pelo shell —
// no Windows o glob nunca é expandido pelo shell por trás do yarn, então
// listamos os arquivos explicitamente (padrão do comandax).
const { readdirSync } = require("node:fs");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const testsDir = path.join(process.cwd(), "tests");

const files = readdirSync(testsDir, { recursive: true })
  .filter((file) => file.endsWith(".test.js"))
  .map((file) => path.join("tests", file));

if (files.length === 0) {
  console.error("Nenhum arquivo *.test.js encontrado em tests/");
  process.exit(1);
}

const result = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });

process.exit(result.status ?? 1);
