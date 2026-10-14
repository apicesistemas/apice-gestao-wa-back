// @ts-check
// Envio do binário da mídia ao back em `POST /interno/midia` (multipart/form-data, recebido com
// multer memoryStorage). O `fetch` é trocado por um falso; o corpo é relido como FormData.
const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { enviarMidia } = require("../../src/services/midiaInternoClient");
const arquivos = require("../helpers/arquivosMidia");

const VARS = ["CRM_BACK_URL", "CRM_BACK_SERVICE_TOKEN"];
/** @type {Record<string, string | undefined>} */
let envOriginal = {};
const fetchOriginal = globalThis.fetch;

beforeEach(() => {
  envOriginal = Object.fromEntries(VARS.map((nome) => [nome, process.env[nome]]));
  process.env.CRM_BACK_URL = "http://back.local:3500/";
  process.env.CRM_BACK_SERVICE_TOKEN = "token-wa-para-back";
});

afterEach(() => {
  globalThis.fetch = fetchOriginal;
  for (const nome of VARS) {
    if (envOriginal[nome] === undefined) delete process.env[nome];
    else process.env[nome] = envOriginal[nome];
  }
});

/**
 * @param {(url: string, init: RequestInit) => Response | Promise<Response>} [responder]
 */
function capturarFetch(responder = () => Response.json({ msg: "Mídia registrada." })) {
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

const METADADOS = {
  hash_empresa: "hash-a",
  cod_equipe: "7",
  mimetype: "application/pdf",
  tamanho_bytes: 0,
  nome_arquivo: "relatório de março.pdf",
  duracao_segundos: null,
};

test("enviarMidia manda o binário e os metadados em multipart para /interno/midia com o token de serviço", async () => {
  const chamadas = capturarFetch();
  const buffer = arquivos.pdf();

  const resposta = await enviarMidia("3EB0ABC", buffer, { ...METADADOS, tamanho_bytes: buffer.length });

  assert.deepEqual(resposta, { msg: "Mídia registrada." });
  assert.equal(chamadas.length, 1);
  const { url, init } = chamadas[0];
  assert.equal(url, "http://back.local:3500/interno/midia");
  assert.equal(init.method, "POST");
  const headers = new Headers(init.headers);
  assert.equal(headers.get("X-Internal-Token"), "token-wa-para-back");
  // o boundary do multipart é gerado pelo fetch: nenhum Content-Type fixo
  assert.equal(headers.get("Content-Type"), null);
  assert.ok(init.signal, "a chamada tem prazo");

  const form = /** @type {FormData} */ (init.body);
  assert.ok(form instanceof FormData);
  assert.equal(form.get("hash_empresa"), "hash-a");
  assert.equal(form.get("cod_equipe"), "7");
  assert.equal(form.get("mensagem_wa_id"), "3EB0ABC");
  assert.equal(form.get("mimetype"), "application/pdf");
  assert.equal(form.get("tamanho_bytes"), String(buffer.length));
  assert.equal(form.get("nome_arquivo"), "relatório de março.pdf");
  assert.equal(form.get("duracao_segundos"), null);
  const arquivo = /** @type {File} */ (form.get("midia"));
  assert.ok(arquivo instanceof Blob);
  assert.equal(arquivo.type, "application/pdf");
  assert.equal(arquivo.name, "midia");
  assert.deepEqual(Buffer.from(await arquivo.arrayBuffer()), buffer);
  // campos de texto antes do arquivo: o multer só preenche req.body com o que chegou antes do arquivo
  assert.deepEqual([...form.keys()].at(-1), "midia");
});

test("enviarMidia manda a duração quando existe e omite o nome do arquivo quando não há", async () => {
  const chamadas = capturarFetch();
  const buffer = arquivos.oggOpus(3);
  await enviarMidia("3EB0OGG", buffer, { ...METADADOS, mimetype: "audio/ogg", tamanho_bytes: buffer.length, nome_arquivo: null, duracao_segundos: 3 });
  const form = /** @type {FormData} */ (chamadas[0].init.body);
  assert.equal(form.get("duracao_segundos"), "3");
  assert.equal(form.get("nome_arquivo"), null);
});

test("enviarMidia sem hash_empresa rejeita sem chamar o back", async () => {
  const chamadas = capturarFetch();
  await assert.rejects(enviarMidia("3EB0ABC", arquivos.pdf(), { ...METADADOS, hash_empresa: "" }), (erro) => /** @type {any} */ (erro).name === "ErroRotaInterna");
  assert.equal(chamadas.length, 0);
});

test("enviarMidia sem buffer ou sem mensagem_wa_id rejeita sem chamar o back", async () => {
  const chamadas = capturarFetch();
  await assert.rejects(enviarMidia("", arquivos.pdf(), METADADOS), (erro) => /** @type {any} */ (erro).tipo === "requisicao_invalida");
  await assert.rejects(enviarMidia("3EB0ABC", Buffer.alloc(0), METADADOS), (erro) => /** @type {any} */ (erro).tipo === "requisicao_invalida");
  assert.equal(chamadas.length, 0);
});

test("um HTTP não-2xx do back (ex.: 413) vira ErroRotaInterna com o status", async () => {
  capturarFetch(() => new Response(JSON.stringify({ msg: "Arquivo acima do tamanho máximo." }), { status: 413 }));
  await assert.rejects(enviarMidia("3EB0ABC", arquivos.pdf(), METADADOS), (erro) => {
    const e = /** @type {any} */ (erro);
    return e.name === "ErroRotaInterna" && e.tipo === "http" && e.status === 413 && e.rota === "/interno/midia";
  });
});

test("uma falha de rede vira ErroRotaInterna do tipo 'rede'", async () => {
  capturarFetch(() => {
    throw new TypeError("fetch failed");
  });
  await assert.rejects(enviarMidia("3EB0ABC", arquivos.pdf(), METADADOS), (erro) => /** @type {any} */ (erro).tipo === "rede");
});
