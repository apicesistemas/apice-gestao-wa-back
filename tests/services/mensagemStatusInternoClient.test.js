// @ts-check
// Clientes das rotas internas de status da mensagem (`POST /interno/mensagem-status`) e de presença
// (`POST /interno/presenca`). O `fetch` é falso.
const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { registrarStatusMensagem } = require("../../src/services/mensagemStatusInternoClient");
const { registrarPresenca } = require("../../src/services/presencaInternoClient");

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

/** @param {() => Response} [responder] */
function capturarFetch(responder = () => Response.json({ msg: "ok" })) {
  /** @type {{ url: string, init: any }[]} */
  const chamadas = [];
  globalThis.fetch = /** @type {typeof fetch} */ (
    async (url, init) => {
      chamadas.push({ url: String(url), init });
      return responder();
    }
  );
  return chamadas;
}

const CONTEXTO = { hash_empresa: "hash-a", cod_equipe: "7" };
const invalida = (/** @type {unknown} */ erro) => /** @type {any} */ (erro).tipo === "requisicao_invalida";

test("mensagem-status vai com o tenant, a equipe (número), o id e o status, com o token de serviço", async () => {
  const chamadas = capturarFetch();
  await registrarStatusMensagem("3EB0LIDA", "LIDA", CONTEXTO);
  assert.equal(chamadas[0].url, "http://back.local:3500/interno/mensagem-status");
  assert.equal(new Headers(chamadas[0].init.headers).get("X-Internal-Token"), "token-wa-para-back");
  assert.deepEqual(JSON.parse(chamadas[0].init.body), { hash_empresa: "hash-a", cod_equipe: 7, mensagem_wa_id: "3EB0LIDA", status: "LIDA" });
});

test("mensagem-status com status ou id inválido rejeita sem chamar o back", async () => {
  const chamadas = capturarFetch();
  await assert.rejects(registrarStatusMensagem("3EB0A", /** @type {any} */ ("PENDENTE"), CONTEXTO), invalida);
  await assert.rejects(registrarStatusMensagem("", "LIDA", CONTEXTO), invalida);
  await assert.rejects(registrarStatusMensagem("3EB0A", "LIDA", { ...CONTEXTO, hash_empresa: "" }), invalida);
  assert.equal(chamadas.length, 0);
});

test("o back responde 200 sem efeito para um id desconhecido: resolve sem erro", async () => {
  capturarFetch(() => Response.json({ msg: "Mensagem não encontrada.", atualizada: false }));
  assert.deepEqual(await registrarStatusMensagem("3EB0NAOEXISTE", "ENTREGUE", CONTEXTO), { msg: "Mensagem não encontrada.", atualizada: false });
});

test("presenca vai com chat_jid, participante_jid (ou null) e estado", async () => {
  const chamadas = capturarFetch();
  await registrarPresenca({ chat_jid: "5511900000001@s.whatsapp.net", participante_jid: null, estado: "DIGITANDO" }, CONTEXTO);
  await registrarPresenca({ chat_jid: "120363000000000001@g.us", participante_jid: "5511900000002@s.whatsapp.net", estado: "GRAVANDO" }, CONTEXTO);
  assert.equal(chamadas[0].url, "http://back.local:3500/interno/presenca");
  assert.deepEqual(JSON.parse(chamadas[0].init.body), {
    hash_empresa: "hash-a",
    cod_equipe: 7,
    chat_jid: "5511900000001@s.whatsapp.net",
    participante_jid: null,
    estado: "DIGITANDO",
  });
  assert.equal(JSON.parse(chamadas[1].init.body).participante_jid, "5511900000002@s.whatsapp.net");
});

test("presenca com estado ou chat inválido rejeita sem chamar o back; a rota inexistente (404) vira ErroRotaInterna", async () => {
  const chamadas = capturarFetch(() => new Response("{}", { status: 404 }));
  await assert.rejects(registrarPresenca({ chat_jid: "x@s.whatsapp.net", participante_jid: null, estado: /** @type {any} */ ("ONLINE") }, CONTEXTO), invalida);
  await assert.rejects(registrarPresenca({ chat_jid: "", participante_jid: null, estado: "PARADO" }, CONTEXTO), invalida);
  assert.equal(chamadas.length, 0);
  await assert.rejects(registrarPresenca({ chat_jid: "x@s.whatsapp.net", participante_jid: null, estado: "PARADO" }, CONTEXTO), (erro) => {
    const e = /** @type {any} */ (erro);
    return e.name === "ErroRotaInterna" && e.status === 404 && e.rota === "/interno/presenca";
  });
});
