// @ts-check
const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { reportarStatus } = require("../../src/services/conexaoInternoClient");

const VARS = ["CRM_BACK_URL", "CRM_BACK_SERVICE_TOKEN"];
/** @type {Record<string, string | undefined>} */
let envOriginal = {};
const fetchOriginal = globalThis.fetch;

beforeEach(() => {
  envOriginal = Object.fromEntries(VARS.map((nome) => [nome, process.env[nome]]));
  process.env.CRM_BACK_URL = "http://back.local:3500";
  process.env.CRM_BACK_SERVICE_TOKEN = "token-wa-para-back";
});

afterEach(() => {
  globalThis.fetch = fetchOriginal;
  for (const nome of VARS) {
    if (envOriginal[nome] === undefined) delete process.env[nome];
    else process.env[nome] = envOriginal[nome];
  }
});

test("reportarStatus envia o status da equipe ao back em /interno/wa/status com hash_empresa", async () => {
  /** @type {{ url: string, init: RequestInit }[]} */
  const chamadas = [];
  globalThis.fetch = /** @type {typeof fetch} */ (
    async (url, init) => {
      chamadas.push({ url: String(url), init: init || {} });
      return Response.json({ msg: "Status atualizado." });
    }
  );

  await reportarStatus("7", { hash_empresa: "hash-a", status_conexao: "QR_PENDENTE", ultimo_erro_conexao: null });

  assert.equal(chamadas.length, 1);
  assert.equal(chamadas[0].url, "http://back.local:3500/interno/wa/status");
  assert.equal(new Headers(chamadas[0].init.headers).get("X-Internal-Token"), "token-wa-para-back");
  assert.deepEqual(JSON.parse(String(chamadas[0].init.body)), {
    hash_empresa: "hash-a",
    cod_equipe: 7,
    status_conexao: "QR_PENDENTE",
    ultimo_erro_conexao: null,
  });
});

test("reportarStatus sem hash_empresa rejeita sem chamar o back", async () => {
  let chamou = false;
  globalThis.fetch = /** @type {typeof fetch} */ (
    async () => {
      chamou = true;
      return Response.json({});
    }
  );
  await assert.rejects(
    reportarStatus(7, { hash_empresa: "", status_conexao: "CONECTADO", ultimo_erro_conexao: null }),
    (erro) => /** @type {any} */ (erro).name === "ErroRotaInterna"
  );
  assert.equal(chamou, false);
});
