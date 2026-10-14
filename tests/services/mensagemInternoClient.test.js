// @ts-check
const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { registrarMensagem } = require("../../src/services/mensagemInternoClient");
const { normalizarMensagem } = require("../../src/whatsapp/filtroEntrada");
const { mensagemWa } = require("../helpers/mensagensWa");

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

test("registrarMensagem envia a MensagemRecebida ao back em /interno/mensagem-recebida com hash_empresa e cod_equipe", async () => {
  /** @type {{ url: string, init: RequestInit }[]} */
  const chamadas = [];
  globalThis.fetch = /** @type {typeof fetch} */ (
    async (url, init) => {
      chamadas.push({ url: String(url), init: init || {} });
      return Response.json({ msg: "Mensagem registrada." });
    }
  );
  const mensagem = normalizarMensagem(mensagemWa({ conversation: "oi" }));
  assert.ok(mensagem);

  await registrarMensagem(mensagem, { hash_empresa: "hash-a", cod_equipe: "7" });

  assert.equal(chamadas.length, 1);
  assert.equal(chamadas[0].url, "http://back.local:3500/interno/mensagem-recebida");
  assert.equal(new Headers(chamadas[0].init.headers).get("X-Internal-Token"), "token-wa-para-back");
  assert.deepEqual(JSON.parse(String(chamadas[0].init.body)), {
    hash_empresa: "hash-a",
    cod_equipe: 7,
    midia_pendente: false,
    midia_motivo_pendencia: null,
    ...JSON.parse(JSON.stringify(mensagem)),
  });
});

test("registrarMensagem envia midia_pendente e o motivo quando o download ou a validação da mídia falharam", async () => {
  /** @type {RequestInit[]} */
  const corpos = [];
  globalThis.fetch = /** @type {typeof fetch} */ (
    async (_url, init) => {
      corpos.push(init || {});
      return Response.json({ msg: "Mensagem registrada." });
    }
  );
  const mensagem = normalizarMensagem(mensagemWa({ imageMessage: { mimetype: "image/jpeg", url: "https://mmg.whatsapp.net/x" } }));
  assert.ok(mensagem);

  await registrarMensagem(mensagem, { hash_empresa: "hash-a", cod_equipe: 7 }, { midia_pendente: true, midia_motivo_pendencia: "DOWNLOAD_FALHOU" });

  const corpo = JSON.parse(String(corpos[0].body));
  assert.equal(corpo.midia_pendente, true);
  assert.equal(corpo.midia_motivo_pendencia, "DOWNLOAD_FALHOU");
  assert.equal(corpo.hash_empresa, "hash-a");
});

test("registrarMensagem sem hash_empresa rejeita sem chamar o back", async () => {
  let chamou = false;
  globalThis.fetch = /** @type {typeof fetch} */ (
    async () => {
      chamou = true;
      return Response.json({});
    }
  );
  const mensagem = normalizarMensagem(mensagemWa({ conversation: "oi" }));
  assert.ok(mensagem);
  await assert.rejects(registrarMensagem(mensagem, { hash_empresa: "", cod_equipe: 7 }), (erro) => /** @type {any} */ (erro).name === "ErroRotaInterna");
  assert.equal(chamou, false);
});
