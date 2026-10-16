// @ts-check
// POST /equipe/:cod_equipe/grupo/participantes (Task 17.1): participantes do groupMetadata sem o número
// da equipe, token, tenant, conexão, desligamento e prazo. Manager, adapter e socket são falsos; o cache
// de grupo é o real (consulta única). O console é capturado: nada de JID, LID ou telefone nele.
const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const baileysFalso = require("../helpers/baileysFalso");

baileysFalso.instalarBaileysFalso();
const { registrarControllers } = require("../../src/http");
const { criarGrupoController } = require("../../src/http/GrupoController");
const { criarCacheNomeGrupo } = require("../../src/whatsapp/nomeGrupo");
const { criarDesligamento, MSG_REINICIANDO } = require("../../src/utils/desligamento");
const { JID_GRUPO, EU, TELEFONE_EQUIPE } = require("../helpers/mensagensWa");

const TOKEN = "token-back-para-wa";
const tokenOriginal = process.env.WA_BACK_ADMIN_TOKEN;
const LID_A = "10000000000001@lid";
const FONE_A = "5511900000003";

/** @type {{ modo: "ok" | "travar" | "fora" }} */
const estado = { modo: "ok" };
let consultas = 0;
let conectado = true;
const nomes = criarCacheNomeGrupo({ msPrazo: 40 });

const socket = {
  user: { id: EU.jid, lid: EU.lid },
  /** @param {string} jid */
  groupMetadata(jid) {
    consultas += 1;
    if (estado.modo === "travar") return new Promise(() => {});
    if (estado.modo === "fora") return Promise.reject(Object.assign(new Error("forbidden"), { output: { statusCode: 403 } }));
    return Promise.resolve({
      id: jid,
      subject: "Suporte Loja Centro",
      participants: [
        { id: LID_A, lid: LID_A, jid: `${FONE_A}@s.whatsapp.net`, admin: "admin" },
        { id: "100000000000099@lid", lid: "100000000000099@lid", jid: `${TELEFONE_EQUIPE}@s.whatsapp.net`, admin: "superadmin" },
        { id: "100000000000004@lid", admin: null },
      ],
    });
  },
};
const adapter = {
  codEquipe: "7",
  hashEmpresa: "hash-a",
  socketConectado: () => (conectado ? socket : null),
  marcarEnviadaPeloCrm: () => {},
  obterParticipantesGrupo: (/** @type {string} */ chatJid) => nomes.obterParticipantes(socket, chatJid),
};
const manager = {
  /** @param {string | number} cod */
  obter: (cod) => (String(cod) === "7" ? /** @type {any} */ (adapter) : null),
  listarRegistradas: () => [{ cod_equipe: "8", hash_empresa: "hash-b" }],
};

let desligamento = criarDesligamento();
/** @type {http.Server} */
let servidor;
let baseUrl = "";

before(async () => {
  process.env.WA_BACK_ADMIN_TOKEN = TOKEN;
  const app = express();
  app.use(express.json());
  const proxy = { recusarDuranteEncerramento: (/** @type {any} */ req, /** @type {any} */ res, /** @type {any} */ next) => desligamento.recusarDuranteEncerramento(req, res, next) };
  registrarControllers(app, [criarGrupoController(/** @type {any} */ (manager), { desligamento: /** @type {any} */ (proxy) })]);
  servidor = http.createServer(app);
  await new Promise((resolve) => servidor.listen(0, () => resolve(undefined)));
  const endereco = servidor.address();
  assert.ok(endereco && typeof endereco === "object");
  baseUrl = `http://127.0.0.1:${endereco.port}`;
});

after(async () => {
  await new Promise((resolve) => servidor.close(() => resolve(undefined)));
  if (tokenOriginal === undefined) delete process.env.WA_BACK_ADMIN_TOKEN;
  else process.env.WA_BACK_ADMIN_TOKEN = tokenOriginal;
});

beforeEach(() => {
  desligamento = criarDesligamento();
  estado.modo = "ok";
  consultas = 0;
  conectado = true;
  nomes.limpar();
});

/**
 * @param {unknown} corpo
 * @param {{ token?: string | null, cod?: string }} [opcoes]
 */
function post(corpo, { token = TOKEN, cod = "7" } = {}) {
  return fetch(`${baseUrl}/equipe/${cod}/grupo/participantes`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { "X-Internal-Token": token } : {}) },
    body: JSON.stringify(corpo),
  });
}

const VALIDO = { hash_empresa: "hash-a", chat_jid: JID_GRUPO };

test("200 devolve os participantes do groupMetadata, sem o número da equipe e sem nome", async () => {
  const resposta = await post(VALIDO);
  assert.equal(resposta.status, 200);
  assert.deepEqual(await resposta.json(), {
    participantes: [
      { jid: LID_A, lid: LID_A, telefone: FONE_A, admin: true },
      { jid: "100000000000004@lid", lid: "100000000000004@lid", telefone: null, admin: false },
    ],
  });
});

test("chamadas simultâneas ao mesmo grupo fazem uma única consulta (e a seguinte usa o cache)", async () => {
  const respostas = await Promise.all([post(VALIDO), post(VALIDO), post(VALIDO)]);
  assert.deepEqual(respostas.map((r) => r.status), [200, 200, 200]);
  await post(VALIDO);
  assert.equal(consultas, 1);
});

test("sem token 401; token errado 401", async () => {
  assert.equal((await post(VALIDO, { token: null })).status, 401);
  assert.equal((await post(VALIDO, { token: "errado" })).status, 401);
  assert.equal(consultas, 0);
});

test("hash de outra empresa 404 (equipe do processo ou só registrada), sem consultar o WhatsApp", async () => {
  const outra = await post({ ...VALIDO, hash_empresa: "hash-b" });
  assert.equal(outra.status, 404);
  assert.deepEqual(await outra.json(), { msg: "Equipe não encontrada." });
  const registradaDeOutro = await post({ ...VALIDO, hash_empresa: "hash-a" }, { cod: "8" });
  assert.equal(registradaDeOutro.status, 404);
  assert.deepEqual(await registradaDeOutro.json(), { msg: "Equipe não encontrada." });
  assert.equal(consultas, 0);
});

test("400: hash_empresa ausente, grupo inválido (privado, vazio, outro formato) e código de equipe inválido", async () => {
  const semHash = await post({ chat_jid: JID_GRUPO });
  assert.equal(semHash.status, 400);
  assert.deepEqual(await semHash.json(), { msg: "Informe o hash_empresa da equipe." });
  for (const chat_jid of ["5511900000001@s.whatsapp.net", "", 5, undefined, "abc@g.us"]) {
    const r = await post({ hash_empresa: "hash-a", chat_jid });
    assert.equal(r.status, 400);
    assert.deepEqual(await r.json(), { msg: "Grupo inválido." });
  }
  assert.equal((await post(VALIDO, { cod: "abc" })).status, 400);
  assert.equal(consultas, 0);
});

test("409 com o WhatsApp da equipe desconectado", async () => {
  conectado = false;
  const resposta = await post(VALIDO);
  assert.equal(resposta.status, 409);
  assert.deepEqual(await resposta.json(), { msg: "O WhatsApp da equipe não está conectado." });
});

test("503 com Retry-After durante o desligamento, sem consultar o WhatsApp", async () => {
  desligamento.marcarEncerrando();
  const resposta = await post(VALIDO);
  assert.equal(resposta.status, 503);
  assert.deepEqual(await resposta.json(), { msg: MSG_REINICIANDO });
  assert.ok(Number(resposta.headers.get("retry-after")) > 0);
  assert.equal(consultas, 0);
});

test("504 quando o groupMetadata passa do prazo", async () => {
  estado.modo = "travar";
  const resposta = await post(VALIDO);
  assert.equal(resposta.status, 504);
  assert.deepEqual(await resposta.json(), { msg: "A consulta dos participantes não respondeu." });
});

test("404 'Grupo não encontrado.' quando o número da equipe não está no grupo", async () => {
  estado.modo = "fora";
  const resposta = await post(VALIDO);
  assert.equal(resposta.status, 404);
  assert.deepEqual(await resposta.json(), { msg: "Grupo não encontrado." });
});

test("o console da rota (sucesso e falhas) não leva JID, LID nem telefone", async () => {
  /** @type {string[]} */
  const linhas = [];
  const originais = { log: console.log, error: console.error };
  const gravar = (/** @type {any[]} */ ...args) => void linhas.push(args.map(String).join(" "));
  console.log = gravar;
  console.error = gravar;
  try {
    await post(VALIDO);
    nomes.limpar();
    estado.modo = "travar";
    await post(VALIDO);
    nomes.limpar();
    estado.modo = "fora";
    await post(VALIDO);
    await post({ ...VALIDO, hash_empresa: "hash-b" });
  } finally {
    console.log = originais.log;
    console.error = originais.error;
  }
  assert.ok(linhas.length > 0, "a falha é registrada (só código)");
  assert.doesNotMatch(linhas.join("\n"), /\d{10,}|@lid|@s\.whatsapp\.net|@g\.us/);
});

test("o número da equipe sai da lista mesmo quando o sock.user só tem id (sem lid)", async () => {
  const original = socket.user;
  socket.user = /** @type {any} */ ({ id: `${TELEFONE_EQUIPE}:7@s.whatsapp.net` });
  try {
    const resposta = await post(VALIDO);
    assert.equal(resposta.status, 200);
    const { participantes } = /** @type {any} */ (await resposta.json());
    assert.deepEqual(participantes.map((/** @type {any} */ p) => p.jid), [LID_A, "100000000000004@lid"]);
  } finally {
    socket.user = original;
  }
});

test("chat_jid inválido com a equipe desconectada responde 400 Grupo inválido., não 409", async () => {
  conectado = false;
  const resposta = await post({ hash_empresa: "hash-a", chat_jid: "5511900000001@s.whatsapp.net" });
  assert.equal(resposta.status, 400);
  assert.deepEqual(await resposta.json(), { msg: "Grupo inválido." });
});
