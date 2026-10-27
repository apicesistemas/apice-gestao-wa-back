// @ts-check
// deploy.sh (Task 15.3) rodado de verdade com bash, numa pasta temporária, com `git`, `yarn`, `pm2`,
// `curl` e `sleep` trocados por stubs que só registram a chamada. Nenhum deploy, pull ou pm2 real
// acontece. No Windows precisa do bash do Git (o do WSL não enxerga os caminhos do Windows); sem
// bash, os testes que executam o script são pulados com aviso.
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const SCRIPT = path.join(__dirname, "..", "deploy.sh");
const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "wa-back-deploy-"));
after(() => fs.rmSync(raiz, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));

/** @returns {string | null} bash utilizável (no Windows, só o do Git/MSYS) */
function localizarBash() {
  const candidatos =
    process.platform === "win32"
      ? [process.env.BASH_TESTE, "C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Program Files (x86)\\Git\\bin\\bash.exe", "bash"]
      : [process.env.BASH_TESTE, "bash"];
  for (const candidato of candidatos) {
    if (!candidato) continue;
    const r = spawnSync(candidato, ["-c", 'echo "$OSTYPE"'], { encoding: "utf8", timeout: 10000 });
    if (r.status !== 0) continue;
    if (process.platform === "win32" && !/msys|cygwin/i.test(r.stdout)) continue;
    return candidato;
  }
  return null;
}

const BASH = localizarBash();
const AVISO_SEM_BASH = "bash não encontrado (no Windows instale o Git for Windows ou defina BASH_TESTE)";
if (!BASH) console.warn(`[deploy.test] ${AVISO_SEM_BASH}: os testes que executam o deploy.sh foram pulados.`);

/** Stubs: cada um registra `nome argumentos` e sai com o código pedido pelo teste. */
const STUBS = {
  git: `case "\${1:-}" in
  pull) exit "\${STUB_GIT_PULL_SAIDA:-0}" ;;
  ls-files) exit "\${STUB_GIT_LSFILES_SAIDA:-1}" ;;
esac
exit 0`,
  yarn: `if [ "\${1:-}" = "install" ]; then exit "\${STUB_YARN_INSTALL_SAIDA:-0}"; fi
exit 0`,
  // `describe` só acha o app se o nome chegar INTEIRO como um único argumento (nome com espaço e
  // acento); sem aspas no script, o PM2 real receberia pedaços e não acharia o app.
  // STUB_PM2_DESCRIBE_SAIDA força o código (ex.: 1 = app inexistente).
  pm2: `if [ "\${1:-}" = "describe" ]; then
  if [ -n "\${STUB_PM2_DESCRIBE_SAIDA:-}" ]; then exit "\${STUB_PM2_DESCRIBE_SAIDA}"; fi
  if [ "$#" -eq 2 ] && [ "\${2:-}" = "Ápice Gestão - WA Back" ]; then exit 0; fi
  exit 1
fi
exit 0`,
  curl: `exit "\${STUB_CURL_SAIDA:-0}"`,
  sleep: `exit 0`,
};

let contador = 0;

/**
 * Copia o deploy.sh para uma pasta nova (com package.json falso), cria os stubs e roda o script.
 * @param {Record<string, string>} [env] códigos de saída dos stubs e parâmetros do deploy
 * @param {{ comYarnLock?: boolean }} [opcoes]
 */
function rodarDeploy(env = {}, { comYarnLock = false } = {}) {
  assert.ok(BASH);
  contador += 1;
  const pasta = path.join(raiz, `caso-${contador}`);
  const projeto = path.join(pasta, "projeto");
  const bin = path.join(pasta, "bin");
  fs.mkdirSync(projeto, { recursive: true });
  fs.mkdirSync(bin, { recursive: true });
  fs.copyFileSync(SCRIPT, path.join(projeto, "deploy.sh"));
  fs.writeFileSync(path.join(projeto, "package.json"), JSON.stringify({ version: "0.0.0-teste" }));
  fs.writeFileSync(path.join(projeto, "ecosystem.config.cjs"), "module.exports = { apps: [] };\n");
  if (comYarnLock) fs.writeFileSync(path.join(projeto, "yarn.lock"), "# lockfile falso\n");

  const registro = path.join(pasta, "chamadas.log").replace(/\\/g, "/");
  fs.writeFileSync(registro, "");
  for (const [nome, corpo] of Object.entries(STUBS)) {
    const arquivo = path.join(bin, nome);
    const registrar = nome === "sleep" ? "" : `printf '%s\\n' "${nome} $*" >> "$STUB_REGISTRO"\n`;
    fs.writeFileSync(arquivo, `#!/usr/bin/env bash\n${registrar}${corpo}\n`);
    fs.chmodSync(arquivo, 0o755);
  }

  // Os stubs entram no PATH dentro do bash (o bash do Git reordena o PATH herdado do Windows).
  const comando =
    'if command -v cygpath >/dev/null 2>&1; then STUBS="$(cygpath -u "$STUBS")"; ALVO="$(cygpath -u "$ALVO")"; fi; ' +
    'export PATH="$STUBS:$PATH"; exec bash "$ALVO"';
  const r = spawnSync(BASH, ["-c", comando], {
    encoding: "utf8",
    timeout: 60000,
    cwd: pasta, // o script precisa entrar sozinho na própria pasta
    env: {
      ...process.env,
      STUBS: bin,
      ALVO: path.join(projeto, "deploy.sh"),
      STUB_REGISTRO: registro,
      DEPLOY_TENTATIVAS_PING: "3",
      DEPLOY_INTERVALO_PING: "0",
      ...env,
    },
  });
  const chamadas = fs.readFileSync(registro, "utf8").split("\n").filter(Boolean);
  return { codigo: r.status, saida: `${r.stdout}${r.stderr}`, chamadas, erro: r.error };
}

/** @param {{ skip: (msg?: string) => void }} t */
function exigirBash(t) {
  if (!BASH) {
    t.skip(AVISO_SEM_BASH);
    return false;
  }
  return true;
}

test("deploy.sh não roda yarn test e aborta antes do reload se o yarn install falhar (nunca chama o pm2)", (t) => {
  if (!exigirBash(t)) return;
  const { codigo, saida, chamadas, erro } = rodarDeploy({ STUB_YARN_INSTALL_SAIDA: "1" });
  assert.equal(erro, undefined);
  assert.notEqual(codigo, 0);
  assert.ok(chamadas.includes("git pull --ff-only"), chamadas.join(" | "));
  assert.ok(!chamadas.includes("yarn test"), chamadas.join(" | "));
  assert.deepEqual(
    chamadas.filter((c) => c.startsWith("pm2") || c.startsWith("curl")),
    [],
    "o pm2 (ou o ping) foi chamado com o install falhando"
  );
  assert.match(saida, /abortado/);
});

test("deploy.sh roda pull e install (sem testes) e depois o pm2 reload com --update-env", (t) => {
  if (!exigirBash(t)) return;
  const { codigo, saida, chamadas } = rodarDeploy();
  assert.equal(codigo, 0, saida);
  const indice = (/** @type {string} */ prefixo) => chamadas.findIndex((c) => c.startsWith(prefixo));
  assert.ok(indice("git pull --ff-only") >= 0);
  assert.ok(indice("git pull") < indice("yarn install"));
  assert.ok(indice("yarn test") < 0, "o deploy não roda testes");
  assert.ok(indice("yarn install") < indice("pm2 reload"));
  assert.ok(chamadas.includes("pm2 reload ecosystem.config.cjs --update-env"), chamadas.join(" | "));
  assert.ok(indice("pm2 reload") < indice("curl"));
  assert.ok(chamadas.some((c) => c.startsWith("curl") && c.includes("http://127.0.0.1:3501/ping")), chamadas.join(" | "));
  assert.ok(indice("curl") < indice("pm2 save"));
  assert.ok(!chamadas.some((c) => /^pm2 (delete|kill|stop)/.test(c)));
  assert.match(saida, /0\.0\.0-teste/);
});

test("deploy.sh aborta sem instalar nem recarregar se o git pull falhar", (t) => {
  if (!exigirBash(t)) return;
  const { codigo, chamadas } = rodarDeploy({ STUB_GIT_PULL_SAIDA: "1" });
  assert.notEqual(codigo, 0);
  assert.deepEqual(
    chamadas.filter((c) => !c.startsWith("git")),
    [],
    "algo além do git rodou depois do pull com falha"
  );
});

test("deploy.sh sobe com pm2 start na primeira vez (app ainda não existe no PM2)", (t) => {
  if (!exigirBash(t)) return;
  const { codigo, saida, chamadas } = rodarDeploy({ STUB_PM2_DESCRIBE_SAIDA: "1" });
  assert.equal(codigo, 0, saida);
  assert.ok(chamadas.includes("pm2 start ecosystem.config.cjs"), chamadas.join(" | "));
  assert.ok(!chamadas.some((c) => c.startsWith("pm2 reload")));
});

test("deploy.sh sai ≠ 0 e não salva o PM2 se o /ping não responder depois do reload", (t) => {
  if (!exigirBash(t)) return;
  const { codigo, saida, chamadas } = rodarDeploy({ STUB_CURL_SAIDA: "7" });
  assert.notEqual(codigo, 0);
  assert.ok(chamadas.some((c) => c.startsWith("pm2 reload")));
  assert.equal(chamadas.filter((c) => c.startsWith("curl")).length, 3, "número de tentativas do ping");
  assert.ok(!chamadas.includes("pm2 save"));
  assert.ok(saida.includes('pm2 logs "Ápice Gestão - WA Back" --lines 100'), saida);
});

test("deploy.sh detecta o app pelo nome com espaço e acento: cai no pm2 reload, nunca no pm2 start", (t) => {
  if (!exigirBash(t)) return;
  const { codigo, saida, chamadas } = rodarDeploy();
  assert.equal(codigo, 0, saida);
  assert.ok(chamadas.includes("pm2 describe Ápice Gestão - WA Back"), chamadas.join(" | "));
  assert.ok(chamadas.some((c) => c.startsWith("pm2 reload")), chamadas.join(" | "));
  assert.ok(!chamadas.some((c) => c.startsWith("pm2 start")), "subiu uma segunda instância na mesma sessão do Baileys");
});

test("deploy.sh: o nome do app e todo uso de $APP no código ficam entre aspas", () => {
  const conteudo = fs.readFileSync(SCRIPT, "utf8");
  assert.match(conteudo, /^APP="Ápice Gestão - WA Back"$/m);
  const codigo = conteudo
    .split("\n")
    .filter((linha) => !linha.trimStart().startsWith("#"))
    .join("\n");
  for (const uso of codigo.matchAll(/\$\{?APP\}?/g)) {
    const antes = codigo.slice(0, uso.index);
    const aspasAntes = (antes.split("\n").pop() ?? "").replace(/\\"/g, "").split('"').length - 1;
    assert.equal(aspasAntes % 2, 1, `$APP fora de aspas: ${antes.split("\n").pop()}`);
  }
});

test("deploy.sh usa --frozen-lockfile quando o yarn.lock é versionado", (t) => {
  if (!exigirBash(t)) return;
  const { codigo, saida, chamadas } = rodarDeploy({ STUB_GIT_LSFILES_SAIDA: "0" }, { comYarnLock: true });
  assert.equal(codigo, 0, saida);
  assert.ok(chamadas.some((c) => c.startsWith("yarn install") && c.includes("--frozen-lockfile")), chamadas.join(" | "));
});

test("deploy.sh: LF, set -euo pipefail, sem ler o .env, sem apagar sessoes-baileys e sem set -x", () => {
  const conteudo = fs.readFileSync(SCRIPT, "utf8");
  assert.ok(!conteudo.includes("\r"), "deploy.sh com CRLF não roda no Linux");
  assert.ok(conteudo.startsWith("#!/usr/bin/env bash\n"));
  assert.match(conteudo, /^set -E?euo pipefail$/m);
  const codigo = conteudo
    .split("\n")
    .filter((linha) => !linha.trimStart().startsWith("#"))
    .join("\n");
  assert.ok(!/\.env\b/.test(codigo), "o deploy não pode ler o .env (segredos)");
  assert.ok(!/sessoes-baileys/.test(codigo), "o deploy não mexe em sessoes-baileys/");
  assert.ok(!/set -x|set -o xtrace/.test(codigo));
  assert.ok(!/pm2 (delete|kill)/.test(codigo));
});
