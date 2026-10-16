// @ts-check
// ecosystem.config.cjs final do PM2 (Task 15.3): instância única em fork, porta 3501 coerente com o
// .env.example e kill_timeout maior que o teto do desligamento gracioso do src/index.js.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const raiz = path.join(__dirname, "..");
const ecosystem = require(path.join(raiz, "ecosystem.config.cjs"));
const { MS_TETO_ENCERRAMENTO } = require("../src/index");

const [app, ...outros] = ecosystem.apps;

test("o ecosystem tem um único app, Ápice Gestão - WA Back, em fork com instância única", () => {
  assert.equal(outros.length, 0);
  assert.equal(app.name, "Ápice Gestão - WA Back");
  assert.equal(app.script, "./src/index.js");
  assert.equal(app.instances, 1);
  assert.equal(app.exec_mode, "fork");
  assert.equal(app.cwd, raiz);
});

test("kill_timeout é maior que o teto do desligamento gracioso, com folga", () => {
  assert.equal(typeof MS_TETO_ENCERRAMENTO, "number");
  assert.ok(app.kill_timeout > MS_TETO_ENCERRAMENTO, `kill_timeout ${app.kill_timeout} <= teto ${MS_TETO_ENCERRAMENTO}`);
  assert.ok(app.kill_timeout - MS_TETO_ENCERRAMENTO >= 1000, "folga menor que 1 s entre o teto e o kill do PM2");
});

test("a porta do PM2 é 3501, a mesma do .env.example", () => {
  const exemplo = fs.readFileSync(path.join(raiz, ".env.example"), "utf8");
  const porta = /^SERVER_PORT=(\d+)\s*$/m.exec(exemplo)?.[1];
  assert.equal(porta, "3501");
  assert.equal(app.env.SERVER_PORT, porta);
});

test("sem watch, com autorestart limitado, listen_timeout e fuso de São Paulo", () => {
  assert.equal(app.watch, false);
  assert.equal(app.autorestart, true);
  assert.ok(Number.isInteger(app.max_restarts) && app.max_restarts > 0 && app.max_restarts <= 20);
  assert.ok(Number.isInteger(app.restart_delay) && app.restart_delay >= 1000);
  assert.ok(Number.isInteger(app.min_uptime) && app.min_uptime > 0);
  assert.ok(Number.isInteger(app.listen_timeout) && app.listen_timeout > 0);
  assert.equal(app.env.TZ, "America/Sao_Paulo");
  assert.equal(app.env.NODE_ENV, "production");
  assert.equal(app.node_args, "--env-file=.env");
});
