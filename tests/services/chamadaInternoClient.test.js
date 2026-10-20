// @ts-check
const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { registrarChamada, alertarChamada, MS_PRAZO_ALERTA } = require("../../src/services/chamadaInternoClient");

const VARS = ["CRM_BACK_URL", "CRM_BACK_SERVICE_TOKEN", "CRM_BACK_TIMEOUT_MS"];
/** @type {Record<string, string | undefined>} */
let envOriginal = {};
const fetchOriginal = globalThis.fetch;

beforeEach(() => {
  envOriginal = Object.fromEntries(VARS.map((nome) => [nome, process.env[nome]]));
  process.env.CRM_BACK_URL = "http://back.local:3500";
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

const identidade = { jid: "100000000000001@lid", lid: "100000000000001@lid", telefone: null };
/** @type {import("../../src/services/chamadaInternoClient").RegistroChamadaCorpo} */
const registro = {
  chamada_wa_id: "CALL1",
  origem: "CLIENTE",
  tipo_chat: "PRIVADO",
  chat_jid: "100000000000001@lid",
  remetente: { ...identidade, nome: null },
  contato: identidade,
  video: true,
  resultado: "PERDIDA",
  timestamp_wa: 1760000000,
};

/** @param {(Response | Error)[]} respostas */
function fetchSequencia(respostas) {
  /** @type {{ url: string, init: RequestInit }[]} */
  const chamadas = [];
  globalThis.fetch = /** @type {typeof fetch} */ (
    async (url, init) => {
      chamadas.push({ url: String(url), init: init || {} });
      const r = respostas[Math.min(chamadas.length - 1, respostas.length - 1)];
      if (r instanceof Error) throw r;
      return r;
    }
  );
  return chamadas;
}

test("registrarChamada: POST em /interno/chamada com token, hash_empresa e cod_equipe numérico", async () => {
  const chamadas = fetchSequencia([Response.json({ msg: "Chamada registrada.", cod_conversa: 3 }, { status: 201 })]);
  const resposta = await registrarChamada(registro, { hash_empresa: "hash-a", cod_equipe: "7" });
  assert.deepEqual(resposta, { msg: "Chamada registrada.", cod_conversa: 3 });
  assert.equal(chamadas.length, 1);
  assert.equal(chamadas[0].url, "http://back.local:3500/interno/chamada");
  assert.equal(new Headers(chamadas[0].init.headers).get("X-Internal-Token"), "token-wa-para-back");
  assert.deepEqual(JSON.parse(String(chamadas[0].init.body)), { ...registro, hash_empresa: "hash-a", cod_equipe: 7 });
});

test("registrarChamada: 503, rede e prazo têm UMA nova tentativa; o sucesso da segunda vale", async () => {
  for (const falha of [
    Response.json({ msg: "x" }, { status: 503 }),
    new TypeError("fetch failed"),
    Object.assign(new Error("t"), { name: "TimeoutError" }),
  ]) {
    const chamadas = fetchSequencia([falha, Response.json({ msg: "Chamada registrada." }, { status: 201 })]);
    const resposta = await registrarChamada(registro, { hash_empresa: "h", cod_equipe: 1 }, { msEspera: 0 });
    assert.equal(resposta.msg, "Chamada registrada.");
    assert.equal(chamadas.length, 2);
  }
});

test("registrarChamada: duas falhas seguidas rejeitam após 2 chamadas; 404, 400 e 500 não repetem", async () => {
  let chamadas = fetchSequencia([Response.json({ msg: "x" }, { status: 503 })]);
  await assert.rejects(registrarChamada(registro, { hash_empresa: "h", cod_equipe: 1 }, { msEspera: 0 }), { status: 503 });
  assert.equal(chamadas.length, 2);
  for (const status of [404, 400, 500]) {
    chamadas = fetchSequencia([Response.json({ msg: "x" }, { status })]);
    await assert.rejects(registrarChamada(registro, { hash_empresa: "h", cod_equipe: 1 }, { msEspera: 0 }), { status });
    assert.equal(chamadas.length, 1, `HTTP ${status} não repete`);
  }
});

test("alertarChamada TOCANDO: corpo com identificadores, sem nome, e prazo próprio de 3 s", async () => {
  const chamadas = fetchSequencia([Response.json({ msg: "Alerta de chamada emitido.", cod_conversa: 3 })]);
  await alertarChamada(
    { chamada_wa_id: "CALL1", situacao: "TOCANDO", tipo_chat: "PRIVADO", chat_jid: identidade.jid, remetente: { ...identidade, nome: null }, contato: identidade, video: false },
    { hash_empresa: "hash-a", cod_equipe: "7" },
  );
  assert.equal(chamadas[0].url, "http://back.local:3500/interno/chamada-alerta");
  assert.deepEqual(JSON.parse(String(chamadas[0].init.body)), {
    chamada_wa_id: "CALL1",
    situacao: "TOCANDO",
    tipo_chat: "PRIVADO",
    chat_jid: identidade.jid,
    remetente: { ...identidade, nome: null },
    contato: identidade,
    video: false,
    hash_empresa: "hash-a",
    cod_equipe: 7,
  });
  assert.equal(MS_PRAZO_ALERTA, 3000);
});

test("alertarChamada PAROU: só id e situação; sem nova tentativa em nenhuma falha", async () => {
  let chamadas = fetchSequencia([Response.json({ msg: "ok" })]);
  await alertarChamada({ chamada_wa_id: "CALL1", situacao: "PAROU", chat_jid: "x@lid", video: true }, { hash_empresa: "h", cod_equipe: 2 });
  assert.deepEqual(JSON.parse(String(chamadas[0].init.body)), { chamada_wa_id: "CALL1", situacao: "PAROU", hash_empresa: "h", cod_equipe: 2 });
  for (const falha of [Response.json({ msg: "x" }, { status: 503 }), new TypeError("fetch failed")]) {
    chamadas = fetchSequencia([falha]);
    await assert.rejects(alertarChamada({ chamada_wa_id: "CALL1", situacao: "PAROU" }, { hash_empresa: "h", cod_equipe: 2 }));
    assert.equal(chamadas.length, 1);
  }
});

test("alertarChamada: o prazo próprio de 3 s vale mesmo com CRM_BACK_TIMEOUT_MS maior", async () => {
  process.env.CRM_BACK_TIMEOUT_MS = "60000";
  /** @type {AbortSignal | null | undefined} */
  let sinal;
  globalThis.fetch = /** @type {typeof fetch} */ (
    async (_url, init) => {
      sinal = init?.signal;
      return Response.json({ msg: "ok" });
    }
  );
  await alertarChamada({ chamada_wa_id: "CALL1", situacao: "PAROU" }, { hash_empresa: "h", cod_equipe: 2 }, { timeoutMs: 20 });
  assert.ok(sinal);
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(/** @type {AbortSignal} */ (sinal).aborted, true, "20 ms próprios, não os 60 s do ambiente");
});
