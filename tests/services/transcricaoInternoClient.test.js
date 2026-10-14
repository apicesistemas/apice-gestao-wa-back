// @ts-check
// Registro do resultado da transcrição no back (`POST /interno/transcricao`). O `fetch` é falso.
const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { registrarTranscricao } = require("../../src/services/transcricaoInternoClient");

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

/** @param {(url: string) => Response} [responder] */
function capturarFetch(responder = () => Response.json({ msg: "Transcrição registrada." })) {
  /** @type {{ url: string, init: any }[]} */
  const chamadas = [];
  globalThis.fetch = /** @type {typeof fetch} */ (
    async (url, init) => {
      chamadas.push({ url: String(url), init });
      return responder(String(url));
    }
  );
  return chamadas;
}

const CONTEXTO = { hash_empresa: "hash-a", cod_equipe: "7" };

test("CONCLUIDA vai com o texto, o tenant, a equipe e o token de serviço", async () => {
  const chamadas = capturarFetch();
  const r = await registrarTranscricao("3EB0AUDIO", { status: "CONCLUIDA", texto: "bom dia" }, CONTEXTO);
  assert.deepEqual(r, { msg: "Transcrição registrada." });
  assert.equal(chamadas.length, 1);
  assert.equal(chamadas[0].url, "http://back.local:3500/interno/transcricao");
  assert.equal(new Headers(chamadas[0].init.headers).get("X-Internal-Token"), "token-wa-para-back");
  assert.deepEqual(JSON.parse(chamadas[0].init.body), {
    hash_empresa: "hash-a",
    cod_equipe: 7,
    mensagem_wa_id: "3EB0AUDIO",
    status: "CONCLUIDA",
    texto: "bom dia",
  });
});

test("PENDENTE e FALHOU vão com texto null, mesmo que um texto seja passado", async () => {
  const chamadas = capturarFetch();
  await registrarTranscricao("3EB0A", { status: "PENDENTE" }, CONTEXTO);
  await registrarTranscricao("3EB0B", { status: "FALHOU", texto: "ignorado" }, CONTEXTO);
  assert.deepEqual(JSON.parse(chamadas[0].init.body), { hash_empresa: "hash-a", cod_equipe: 7, mensagem_wa_id: "3EB0A", status: "PENDENTE", texto: null });
  assert.deepEqual(JSON.parse(chamadas[1].init.body), { hash_empresa: "hash-a", cod_equipe: 7, mensagem_wa_id: "3EB0B", status: "FALHOU", texto: null });
});

test("status inválido, CONCLUIDA sem texto ou sem mensagem_wa_id rejeitam sem chamar o back", async () => {
  const chamadas = capturarFetch();
  const invalida = (/** @type {unknown} */ erro) => /** @type {any} */ (erro).tipo === "requisicao_invalida";
  await assert.rejects(registrarTranscricao("3EB0A", /** @type {any} */ ({ status: "OUTRO" }), CONTEXTO), invalida);
  await assert.rejects(registrarTranscricao("3EB0A", { status: "CONCLUIDA", texto: "  " }, CONTEXTO), invalida);
  await assert.rejects(registrarTranscricao("", { status: "PENDENTE" }, CONTEXTO), invalida);
  await assert.rejects(registrarTranscricao("3EB0A", { status: "PENDENTE" }, { ...CONTEXTO, hash_empresa: "" }), invalida);
  assert.equal(chamadas.length, 0);
});

test("a rota ainda inexistente no back (404) vira ErroRotaInterna", async () => {
  capturarFetch(() => new Response(JSON.stringify({ msg: "Rota não encontrada." }), { status: 404 }));
  await assert.rejects(registrarTranscricao("3EB0A", { status: "PENDENTE" }, CONTEXTO), (erro) => {
    const e = /** @type {any} */ (erro);
    return e.name === "ErroRotaInterna" && e.status === 404 && e.rota === "/interno/transcricao";
  });
});
