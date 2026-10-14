// @ts-check
const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { chamarRotaInterna, ErroRotaInterna } = require("../../src/services/internoHttpClient");

const VARS = ["CRM_BACK_URL", "CRM_BACK_SERVICE_TOKEN", "CRM_BACK_TIMEOUT_MS"];
/** @type {Record<string, string | undefined>} */
let envOriginal = {};
/** @type {typeof fetch} */
const fetchOriginal = globalThis.fetch;

/**
 * @typedef {{ url: string, init: RequestInit }} ChamadaFetch
 */

/**
 * Troca o fetch global por um falso que registra a chamada e devolve o que `responder` decidir.
 * @param {(url: string, init: RequestInit) => Promise<Response>} responder
 * @returns {ChamadaFetch[]}
 */
function mockarFetch(responder) {
  /** @type {ChamadaFetch[]} */
  const chamadas = [];
  globalThis.fetch = /** @type {typeof fetch} */ (
    async (url, init) => {
      const chamada = { url: String(url), init: init || {} };
      chamadas.push(chamada);
      return responder(chamada.url, chamada.init);
    }
  );
  return chamadas;
}

beforeEach(() => {
  envOriginal = Object.fromEntries(VARS.map((nome) => [nome, process.env[nome]]));
  process.env.CRM_BACK_URL = "http://back.local:3500/";
  process.env.CRM_BACK_SERVICE_TOKEN = "token-wa-para-back";
  delete process.env.CRM_BACK_TIMEOUT_MS;
});

afterEach(() => {
  globalThis.fetch = fetchOriginal;
  for (const nome of VARS) {
    if (envOriginal[nome] === undefined) delete process.env[nome];
    else process.env[nome] = envOriginal[nome];
  }
});

test("chamarRotaInterna envia o header de token e o hash_empresa no corpo", async () => {
  const chamadas = mockarFetch(async () => Response.json({ msg: "Registrado." }, { status: 200 }));

  const retorno = await chamarRotaInterna("/interno/mensagem", { hash_empresa: "abc123", texto: "oi" });

  assert.deepEqual(retorno, { msg: "Registrado." });
  assert.equal(chamadas.length, 1);
  const [{ url, init }] = chamadas;
  assert.equal(url, "http://back.local:3500/interno/mensagem");
  assert.equal(init.method, "POST");
  const headers = new Headers(init.headers);
  assert.equal(headers.get("X-Internal-Token"), "token-wa-para-back");
  assert.equal(headers.get("Content-Type"), "application/json");
  assert.deepEqual(JSON.parse(String(init.body)), { hash_empresa: "abc123", texto: "oi" });
});

test("chamarRotaInterna recusa corpo sem hash_empresa, sem chamar o back", async () => {
  const chamadas = mockarFetch(async () => Response.json({}, { status: 200 }));

  await assert.rejects(
    // @ts-expect-error hash_empresa ausente de propósito
    chamarRotaInterna("/interno/mensagem", { texto: "oi" }),
    (erro) => erro instanceof ErroRotaInterna && erro.tipo === "requisicao_invalida"
  );
  assert.equal(chamadas.length, 0);
});

test("um 5xx do back vira ErroRotaInterna tratado, sem derrubar o processo", async () => {
  mockarFetch(async () => new Response("falha no banco", { status: 503, statusText: "Service Unavailable" }));

  await assert.rejects(chamarRotaInterna("/interno/mensagem", { hash_empresa: "abc123" }), (erro) => {
    assert.ok(erro instanceof ErroRotaInterna);
    assert.equal(erro.tipo, "http");
    assert.equal(erro.status, 503);
    assert.equal(erro.rota, "/interno/mensagem");
    assert.match(erro.message, /503/);
    return true;
  });
  assert.equal(process.exitCode ?? 0, 0);
});

test("um timeout do back vira ErroRotaInterna do tipo 'timeout'", async () => {
  process.env.CRM_BACK_TIMEOUT_MS = "30";
  // O fetch falso só termina quando o sinal de timeout aborta a chamada, como o fetch real.
  // O timer de AbortSignal.timeout é unref; o socket do fetch real mantém o event loop vivo,
  // aqui um timer de guarda faz esse papel (e falha o teste se o abort nunca vier).
  mockarFetch(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        const sinal = init.signal;
        assert.ok(sinal, "a chamada precisa levar um AbortSignal de timeout");
        const guarda = setTimeout(() => reject(new Error("o sinal de timeout não abortou a chamada")), 2000);
        sinal.addEventListener("abort", () => {
          clearTimeout(guarda);
          reject(sinal.reason);
        });
      })
  );

  await assert.rejects(
    chamarRotaInterna("/interno/mensagem", { hash_empresa: "abc123" }),
    (erro) => erro instanceof ErroRotaInterna && erro.tipo === "timeout" && erro.status === null
  );
});

test("uma falha de rede vira ErroRotaInterna do tipo 'rede'", async () => {
  mockarFetch(async () => {
    throw new TypeError("fetch failed");
  });

  await assert.rejects(
    chamarRotaInterna("/interno/mensagem", { hash_empresa: "abc123" }),
    (erro) => erro instanceof ErroRotaInterna && erro.tipo === "rede"
  );
});

test("uma resposta 2xx sem corpo devolve null", async () => {
  mockarFetch(async () => new Response(null, { status: 204 }));

  const retorno = await chamarRotaInterna("/interno/recibo", { hash_empresa: "abc123" });
  assert.equal(retorno, null);
});

test("sem CRM_BACK_URL configurada, lança ErroRotaInterna de configuração", async () => {
  delete process.env.CRM_BACK_URL;
  mockarFetch(async () => Response.json({}, { status: 200 }));

  await assert.rejects(
    chamarRotaInterna("/interno/mensagem", { hash_empresa: "abc123" }),
    (erro) => erro instanceof ErroRotaInterna && erro.tipo === "configuracao"
  );
});
