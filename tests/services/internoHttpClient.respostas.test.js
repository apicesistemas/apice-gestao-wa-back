// @ts-check
// Ramos de erro e de borda do cliente das rotas internas: leitura do corpo, JSON inválido, prazo,
// detalhe truncado e multipart.
const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { chamarRotaInterna, chamarRotaInternaMultipart, ErroRotaInterna } = require("../../src/services/internoHttpClient");

const VARS = ["CRM_BACK_URL", "CRM_BACK_SERVICE_TOKEN", "CRM_BACK_TIMEOUT_MS"];
/** @type {Record<string, string | undefined>} */
let envOriginal = {};
const fetchOriginal = globalThis.fetch;
const timeoutOriginal = AbortSignal.timeout;

/**
 * @param {(url: string, init: RequestInit) => Promise<any>} responder
 * @returns {{ url: string, init: RequestInit }[]}
 */
function mockarFetch(responder) {
  /** @type {{ url: string, init: RequestInit }[]} */
  const chamadas = [];
  globalThis.fetch = /** @type {typeof fetch} */ (
    async (url, init) => {
      chamadas.push({ url: String(url), init: init || {} });
      return responder(String(url), init || {});
    }
  );
  return chamadas;
}

beforeEach(() => {
  envOriginal = Object.fromEntries(VARS.map((nome) => [nome, process.env[nome]]));
  process.env.CRM_BACK_URL = "http://back.local:3500";
  process.env.CRM_BACK_SERVICE_TOKEN = "token-wa-para-back";
  delete process.env.CRM_BACK_TIMEOUT_MS;
});

afterEach(() => {
  globalThis.fetch = fetchOriginal;
  AbortSignal.timeout = timeoutOriginal;
  for (const nome of VARS) {
    if (envOriginal[nome] === undefined) delete process.env[nome];
    else process.env[nome] = envOriginal[nome];
  }
});

test("2xx com corpo que não é JSON vira ErroRotaInterna http com o status e a causa do parse", async () => {
  mockarFetch(async () => new Response("<html>proxy</html>", { status: 200 }));
  await assert.rejects(chamarRotaInterna("/interno/x", { hash_empresa: "h" }), (erro) => {
    assert.ok(erro instanceof ErroRotaInterna);
    assert.equal(erro.tipo, "http");
    assert.equal(erro.status, 200);
    assert.match(erro.message, /não é JSON/);
    assert.ok(erro.cause instanceof SyntaxError);
    return true;
  });
});

test("falha ao ler o corpo da resposta 2xx: erro de rede, ou timeout se o motivo foi o prazo", async () => {
  /** @param {Error} causa */
  const respostaQueFalhaAoLer = (causa) => ({
    ok: true,
    status: 200,
    text: async () => {
      throw causa;
    },
  });
  mockarFetch(async () => respostaQueFalhaAoLer(new Error("conexão caiu")));
  await assert.rejects(
    chamarRotaInterna("/interno/x", { hash_empresa: "h" }),
    (erro) => erro instanceof ErroRotaInterna && erro.tipo === "rede" && /Falha ao ler a resposta/.test(erro.message)
  );

  const prazo = new Error("prazo");
  prazo.name = "TimeoutError";
  mockarFetch(async () => respostaQueFalhaAoLer(prazo));
  await assert.rejects(
    chamarRotaInterna("/interno/x", { hash_empresa: "h" }),
    (erro) => erro instanceof ErroRotaInterna && erro.tipo === "timeout" && erro.cause === prazo
  );
});

test("AbortError (cancelamento do sinal) também é tratado como timeout", async () => {
  mockarFetch(async () => {
    const abortado = new Error("abortado");
    abortado.name = "AbortError";
    throw abortado;
  });
  await assert.rejects(chamarRotaInterna("/interno/x", { hash_empresa: "h" }), (erro) => erro instanceof ErroRotaInterna && erro.tipo === "timeout");
});

test("falha de rede com valor que não é Error usa o texto no motivo", async () => {
  mockarFetch(async () => {
    throw "ECONNREFUSED";
  });
  await assert.rejects(
    chamarRotaInterna("/interno/x", { hash_empresa: "h" }),
    (erro) => erro instanceof ErroRotaInterna && erro.tipo === "rede" && /ECONNREFUSED/.test(erro.message)
  );
});

test("erro HTTP guarda no máximo 500 caracteres do corpo; corpo ilegível deixa o detalhe vazio", async () => {
  mockarFetch(async () => new Response("a".repeat(2000), { status: 500 }));
  await assert.rejects(chamarRotaInterna("/interno/x", { hash_empresa: "h" }), (erro) => {
    assert.ok(erro instanceof ErroRotaInterna);
    assert.equal(erro.detalhe.length, 500);
    return true;
  });

  mockarFetch(async () => ({
    ok: false,
    status: 502,
    text: async () => {
      throw new Error("corpo cortado");
    },
  }));
  await assert.rejects(chamarRotaInterna("/interno/x", { hash_empresa: "h" }), (erro) => {
    assert.ok(erro instanceof ErroRotaInterna);
    assert.equal(erro.status, 502);
    assert.equal(erro.detalhe, "");
    return true;
  });
});

test("o prazo vem de CRM_BACK_TIMEOUT_MS quando válido; valor inválido, zero ou negativo cai em 10 s", async () => {
  /** @type {number[]} */
  const prazos = [];
  AbortSignal.timeout = (ms) => {
    prazos.push(ms);
    return timeoutOriginal.call(AbortSignal, 60000);
  };
  mockarFetch(async () => new Response(null, { status: 204 }));
  for (const valor of ["2500", "abc", "0", "-5"]) {
    process.env.CRM_BACK_TIMEOUT_MS = valor;
    await chamarRotaInterna("/interno/x", { hash_empresa: "h" });
  }
  assert.deepEqual(prazos, [2500, 10000, 10000, 10000]);
});

test("hash_empresa vazio, só com espaços ou que não é texto é recusado sem chamar o back", async () => {
  const chamadas = mockarFetch(async () => new Response(null, { status: 204 }));
  for (const hash of ["", "   ", 123, null]) {
    await assert.rejects(
      // @ts-expect-error valores inválidos de propósito
      chamarRotaInterna("/interno/x", { hash_empresa: hash }),
      (erro) => erro instanceof ErroRotaInterna && erro.tipo === "requisicao_invalida"
    );
  }
  await assert.rejects(
    // @ts-expect-error corpo ausente de propósito
    chamarRotaInterna("/interno/x", undefined),
    (erro) => erro instanceof ErroRotaInterna && erro.tipo === "requisicao_invalida"
  );
  assert.equal(chamadas.length, 0);
});

test("multipart envia o token, deixa o Content-Type para o fetch (boundary) e devolve o JSON", async () => {
  const chamadas = mockarFetch(async () => Response.json({ msg: "Midia registrada." }));
  const formulario = new FormData();
  formulario.set("hash_empresa", "abc");
  formulario.set("arquivo", new Blob([Buffer.from("conteudo")]), "a.bin");

  const retorno = await chamarRotaInternaMultipart("/interno/midia", formulario);

  assert.deepEqual(retorno, { msg: "Midia registrada." });
  assert.equal(chamadas[0].url, "http://back.local:3500/interno/midia");
  const headers = new Headers(chamadas[0].init.headers);
  assert.equal(headers.get("X-Internal-Token"), "token-wa-para-back");
  assert.equal(headers.get("Content-Type"), null);
  assert.equal(chamadas[0].init.body, formulario);
});

test("multipart sem hash_empresa, ou com corpo que não é FormData, é recusado sem chamar o back", async () => {
  const chamadas = mockarFetch(async () => new Response(null, { status: 204 }));
  await assert.rejects(
    chamarRotaInternaMultipart("/interno/midia", new FormData()),
    (erro) => erro instanceof ErroRotaInterna && erro.tipo === "requisicao_invalida"
  );
  await assert.rejects(
    // @ts-expect-error objeto comum de propósito
    chamarRotaInternaMultipart("/interno/midia", { hash_empresa: "abc" }),
    (erro) => erro instanceof ErroRotaInterna && erro.tipo === "requisicao_invalida"
  );
  assert.equal(chamadas.length, 0);
});
