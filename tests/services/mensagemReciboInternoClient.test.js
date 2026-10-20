// @ts-check
// Cliente da rota interna dos recibos por destinatário (`POST /interno/mensagem-recibos`, C1 da Fase 38).
// O `fetch` é falso: nenhuma chamada real ao back.
const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { registrarRecibos } = require("../../src/services/mensagemReciboInternoClient");

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
function capturarFetch(responder = () => Response.json({ msg: "Recibos registrados.", gravados: 1, ignorados: 0 })) {
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
const GRUPO = { mensagem_wa_id: "3EB0A", destinatario: { lid: "100000000000002@lid", telefone: "5511900000002" }, entregue_em: 1760400001, lida_em: null };
const PRIVADO = { mensagem_wa_id: "3EB0B", destinatario: null, entregue_em: null, lida_em: 1760400002 };

test("mensagem-recibos vai com o tenant, a equipe (número) e os recibos, com o token de serviço", async () => {
  const chamadas = capturarFetch();
  const resposta = await registrarRecibos([GRUPO, PRIVADO], CONTEXTO);
  assert.deepEqual(resposta, { msg: "Recibos registrados.", gravados: 1, ignorados: 0 });
  assert.equal(chamadas[0].url, "http://back.local:3500/interno/mensagem-recibos");
  assert.equal(chamadas[0].init.method, "POST");
  assert.equal(new Headers(chamadas[0].init.headers).get("X-Internal-Token"), "token-wa-para-back");
  assert.deepEqual(JSON.parse(chamadas[0].init.body), { hash_empresa: "hash-a", cod_equipe: 7, recibos: [GRUPO, PRIVADO] });
});

test("o destinatário só leva lid e telefone (campo a mais, como JID ou nome, não vai), e o par pode ter só um dos dois", async () => {
  const chamadas = capturarFetch();
  const comLixo = { ...GRUPO, destinatario: { lid: null, telefone: "5511900000002", jid: "5511900000002@s.whatsapp.net", nome: "Fulano" } };
  await registrarRecibos([/** @type {any} */ (comLixo), { ...GRUPO, destinatario: { lid: "100000000000002@lid", telefone: null } }], CONTEXTO);
  const corpo = JSON.parse(chamadas[0].init.body);
  assert.deepEqual(corpo.recibos[0].destinatario, { lid: null, telefone: "5511900000002" });
  assert.deepEqual(corpo.recibos[1].destinatario, { lid: "100000000000002@lid", telefone: null });
  assert.doesNotMatch(chamadas[0].init.body, /s\.whatsapp\.net|Fulano/);
});

test("quantidade fora de 1 a 200, item inválido ou tenant ausente rejeitam sem chamar o back", async () => {
  const chamadas = capturarFetch();
  await assert.rejects(registrarRecibos([], CONTEXTO), invalida);
  await assert.rejects(registrarRecibos(/** @type {any} */ (null), CONTEXTO), invalida);
  await assert.rejects(registrarRecibos(Array.from({ length: 201 }, () => GRUPO), CONTEXTO), invalida);
  const ruins = [
    { ...GRUPO, mensagem_wa_id: "" },
    { ...GRUPO, mensagem_wa_id: "id com espaço" },
    { ...GRUPO, entregue_em: null, lida_em: null },
    { ...GRUPO, entregue_em: 0 },
    { ...GRUPO, entregue_em: 1.5 },
    { ...GRUPO, lida_em: "1760400002" },
    { ...GRUPO, destinatario: { lid: null, telefone: null } },
    { ...GRUPO, destinatario: { lid: "5511900000002@s.whatsapp.net", telefone: null } },
    { ...GRUPO, destinatario: { lid: null, telefone: "+55 11 90000-0002" } },
    { ...GRUPO, destinatario: "5511900000002@s.whatsapp.net" },
    null,
  ];
  for (const ruim of ruins) await assert.rejects(registrarRecibos([/** @type {any} */ (ruim)], CONTEXTO), invalida);
  await assert.rejects(registrarRecibos([GRUPO], { ...CONTEXTO, hash_empresa: "" }), invalida);
  assert.equal(chamadas.length, 0);
});

test("404 do back antigo chega como ErroRotaInterna com o status (quem chama suspende)", async () => {
  capturarFetch(() => new Response("Cannot POST", { status: 404 }));
  await assert.rejects(registrarRecibos([GRUPO], CONTEXTO), (erro) => /** @type {any} */ (erro).status === 404 && /** @type {any} */ (erro).tipo === "http");
});

test("item inválido no meio de válidos não derruba o lote: vão só os válidos", async () => {
  const chamadas = capturarFetch();
  await registrarRecibos([GRUPO, /** @type {any} */ ({ ...GRUPO, mensagem_wa_id: "" }), PRIVADO, /** @type {any} */ (null)], CONTEXTO);
  assert.deepEqual(JSON.parse(chamadas[0].init.body).recibos, [GRUPO, PRIVADO]);
});
