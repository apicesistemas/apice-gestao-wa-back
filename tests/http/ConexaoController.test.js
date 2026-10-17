// @ts-check
// Rotas de conexão por equipe com o manager real, o adapter real e o socket Baileys mockado via
// require.cache. Sessões em diretório temporário; o reportarStatus é injetado (sem HTTP ao back).
const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const express = require("express");
const baileysFalso = require("../helpers/baileysFalso");

baileysFalso.instalarBaileysFalso();
const { registrarControllers } = require("../../src/http");
const { criarConexaoController } = require("../../src/http/ConexaoController");
const { criarInstanciaManager } = require("../../src/whatsapp/instanciaManager");

const TOKEN = "token-back-para-wa";
const ASSINATURA_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "wa-back-conexao-"));
const tokenOriginal = process.env.WA_BACK_ADMIN_TOKEN;

const manager = criarInstanciaManager({
  diretorioSessoes: path.join(raiz, "sessoes"),
  caminhoRegistro: path.join(raiz, "cache", "equipes-wa.json"),
  reportarStatus: async () => {},
});

/** @type {http.Server} */
let servidor;
let baseUrl = "";

before(async () => {
  process.env.WA_BACK_ADMIN_TOKEN = TOKEN;
  const app = express();
  app.use(express.json());
  registrarControllers(app, [criarConexaoController(manager)]);
  servidor = http.createServer(app);
  await new Promise((resolve) => servidor.listen(0, () => resolve(undefined)));
  const endereco = servidor.address();
  assert.ok(endereco && typeof endereco === "object");
  baseUrl = `http://127.0.0.1:${endereco.port}`;
});

after(async () => {
  await manager.encerrarTodas();
  await new Promise((resolve) => servidor.close(() => resolve(undefined)));
  fs.rmSync(raiz, { recursive: true, force: true });
  if (tokenOriginal === undefined) delete process.env.WA_BACK_ADMIN_TOKEN;
  else process.env.WA_BACK_ADMIN_TOKEN = tokenOriginal;
});

beforeEach(() => baileysFalso.limparHistorico());

/**
 * @param {Response} resposta
 * @returns {Promise<any>}
 */
const lerJson = (resposta) => resposta.json();

/**
 * @param {string} cod
 * @param {unknown} corpo
 * @param {string | null} [token]
 */
function postConectar(cod, corpo, token = TOKEN) {
  /** @type {Record<string, string>} */
  const headers = { "Content-Type": "application/json" };
  if (token) headers["X-Internal-Token"] = token;
  return fetch(`${baseUrl}/equipe/${cod}/conectar`, { method: "POST", headers, body: JSON.stringify(corpo) });
}

/**
 * @param {string} cod
 * @param {string | null} [token]
 */
function getQr(cod, token = TOKEN) {
  return fetch(`${baseUrl}/equipe/${cod}/qr`, { headers: token ? { "X-Internal-Token": token } : {} });
}

test("sem o token de serviço as rotas respondem 401", async () => {
  assert.equal((await postConectar("1", { hash_empresa: "hash-a" }, null)).status, 401);
  assert.equal((await getQr("1", null)).status, 401);
  assert.equal((await getQr("1", "token-errado")).status, 401);
  assert.equal(baileysFalso.sockets.length, 0);
});

test("POST /equipe/:cod_equipe/conectar inicia a instância e o GET /qr devolve o PNG depois do qr", async () => {
  const resposta = await postConectar("41", { hash_empresa: "hash-a" });
  assert.equal(resposta.status, 200);
  const corpo = await lerJson(resposta);
  assert.equal(typeof corpo.msg, "string");
  assert.equal(corpo.cod_equipe, 41);
  assert.ok("status_conexao" in corpo);
  assert.equal(baileysFalso.sockets.length, 1);

  // Ainda sem QR: 404.
  const semQr = await getQr("41");
  assert.equal(semQr.status, 404);
  assert.equal(typeof (await lerJson(semQr)).msg, "string");

  await baileysFalso.ultimoSocket().emitir("connection.update", { qr: "2@qr-equipe-41" });

  const comQr = await getQr("41");
  assert.equal(comQr.status, 200);
  assert.equal(comQr.headers.get("content-type"), "image/png");
  const png = Buffer.from(await comQr.arrayBuffer());
  assert.deepEqual(png.subarray(0, 8), ASSINATURA_PNG);

  // Conectou: o QR some e a rota volta a responder 404.
  await baileysFalso.ultimoSocket().emitir("connection.update", { connection: "open" });
  assert.equal((await getQr("41")).status, 404);
});

test("GET /equipe/:cod_equipe/qr de equipe sem instância responde 404", async () => {
  const resposta = await getQr("4242");
  assert.equal(resposta.status, 404);
  assert.match((await lerJson(resposta)).msg, /QR Code/);
});

test("cod_equipe inválido responde 400 sem abrir socket", async () => {
  for (const cod of ["abc", "0", "-1", "1.5"]) {
    const resposta = await postConectar(cod, { hash_empresa: "hash-a" });
    assert.equal(resposta.status, 400, `cod_equipe ${cod}`);
    assert.equal((await getQr(cod)).status, 400);
  }
  assert.equal(baileysFalso.sockets.length, 0);
});

test("POST /conectar sem hash_empresa responde 400", async () => {
  const resposta = await postConectar("43", {});
  assert.equal(resposta.status, 400);
  assert.match((await lerJson(resposta)).msg, /hash_empresa/);
  assert.equal(baileysFalso.sockets.length, 0);
});

test("POST /conectar de equipe já ligada a outra empresa responde 409", async () => {
  assert.equal((await postConectar("44", { hash_empresa: "hash-a" })).status, 200);
  const resposta = await postConectar("44", { hash_empresa: "hash-b" });
  assert.equal(resposta.status, 409);
  assert.equal(typeof (await lerJson(resposta)).msg, "string");
});

/**
 * @param {string} cod
 * @param {unknown} corpo
 * @param {string | null} [token]
 */
function postDesconectar(cod, corpo, token = TOKEN) {
  /** @type {Record<string, string>} */
  const headers = { "Content-Type": "application/json" };
  if (token) headers["X-Internal-Token"] = token;
  return fetch(`${baseUrl}/equipe/${cod}/desconectar`, { method: "POST", headers, body: JSON.stringify(corpo) });
}

/** Deixa a equipe pareada e CONECTADA (creds.json, user.id e open). */
async function conectarPareada(/** @type {string} */ cod, hash = "hash-a") {
  assert.equal((await postConectar(cod, { hash_empresa: hash })).status, 200);
  fs.writeFileSync(path.join(raiz, "sessoes", cod, "creds.json"), "{}");
  const socket = baileysFalso.ultimoSocket();
  /** @type {any} */ (socket).user = { id: "5500000000002:1@s.whatsapp.net" };
  await socket.emitir("connection.update", { connection: "open" });
  return socket;
}

test("POST /equipe/:cod_equipe/desconectar faz o logout e responde o contrato D", async () => {
  const socket = await conectarPareada("51");

  const resposta = await postDesconectar("51", { hash_empresa: "hash-a" });

  assert.equal(resposta.status, 200);
  assert.deepEqual(await lerJson(resposta), {
    msg: "WhatsApp da equipe desconectado.",
    cod_equipe: 51,
    status_conexao: "DESCONECTADO",
    ultimo_erro_conexao: null,
    havia_sessao: true,
    remocao_aparelho: "CONFIRMADA",
  });
  assert.equal(socket.chamadasLogout, 1);
  assert.equal(fs.existsSync(path.join(raiz, "sessoes", "51")), false);

  // Idempotente: já desconectada.
  const outra = await lerJson(await postDesconectar("51", { hash_empresa: "hash-a" }));
  assert.equal(outra.havia_sessao, false);
  assert.equal(outra.status_conexao, "DESCONECTADO");
});

test("POST /desconectar: sem token 401, código inválido 400, sem hash_empresa 400, outra empresa 409 sem desconectar", async () => {
  assert.equal((await postDesconectar("52", { hash_empresa: "hash-a" }, null)).status, 401);
  assert.equal((await postDesconectar("52", { hash_empresa: "hash-a" }, "token-errado")).status, 401);
  for (const cod of ["abc", "0", "-1", "1.5"]) {
    const r = await postDesconectar(cod, { hash_empresa: "hash-a" });
    assert.equal(r.status, 400, cod);
    assert.deepEqual(await lerJson(r), { msg: "Código da equipe inválido." });
  }
  for (const corpo of [{}, { hash_empresa: "" }, { hash_empresa: 5 }]) {
    const r = await postDesconectar("52", corpo);
    assert.equal(r.status, 400);
    assert.deepEqual(await lerJson(r), { msg: "Informe o hash_empresa da equipe." });
  }

  const socket = await conectarPareada("53");
  const r = await postDesconectar("53", { hash_empresa: "hash-b" });
  assert.equal(r.status, 409);
  assert.deepEqual(await lerJson(r), { msg: "Esta equipe já está conectada por outra empresa." });
  assert.equal(socket.chamadasLogout, 0);
  assert.equal(fs.existsSync(path.join(raiz, "sessoes", "53", "creds.json")), true);
});

test("POST /desconectar: falha inesperada do manager responde 500 sem vazar o erro", async () => {
  const app = express();
  app.use(express.json());
  const falho = { ...manager, desconectar: async () => { throw new Error("falha com 5500000000003"); } };
  registrarControllers(app, [criarConexaoController(/** @type {any} */ (falho))]);
  const srv = http.createServer(app);
  await new Promise((resolve) => srv.listen(0, () => resolve(undefined)));
  /** @type {string[]} */
  const logs = [];
  const erroOriginal = console.error;
  console.error = (...a) => void logs.push(a.map(String).join(" "));
  try {
    const porta = /** @type {import("node:net").AddressInfo} */ (srv.address()).port;
    const r = await fetch(`http://127.0.0.1:${porta}/equipe/54/desconectar`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Internal-Token": TOKEN },
      body: JSON.stringify({ hash_empresa: "hash-a" }),
    });
    assert.equal(r.status, 500);
    assert.deepEqual(await lerJson(r), { msg: "Erro ao desconectar o WhatsApp da equipe." });
    assert.ok(logs.length > 0);
    assert.ok(!logs.join(" ").includes("5500000000003"), "o log leva só o nome do erro");
  } finally {
    console.error = erroOriginal;
    await new Promise((resolve) => srv.close(() => resolve(undefined)));
  }
});

/**
 * @param {string} cod
 * @param {unknown} corpo
 * @param {string | null} [token]
 */
function postRemover(cod, corpo, token = TOKEN) {
  /** @type {Record<string, string>} */
  const headers = { "Content-Type": "application/json" };
  if (token) headers["X-Internal-Token"] = token;
  return fetch(`${baseUrl}/equipe/${cod}/remover`, { method: "POST", headers, body: JSON.stringify(corpo) });
}

/**
 * Sobe um app só com o controller sobre o manager dado (e o desligamento dado).
 * @param {any} managerAlternativo
 * @param {any} [desligamento]
 */
async function subirApp(managerAlternativo, desligamento) {
  const app = express();
  app.use(express.json());
  registrarControllers(app, [criarConexaoController(managerAlternativo, desligamento ? { desligamento } : undefined)]);
  const srv = http.createServer(app);
  await new Promise((resolve) => srv.listen(0, () => resolve(undefined)));
  const porta = /** @type {import("node:net").AddressInfo} */ (srv.address()).port;
  return { srv, url: `http://127.0.0.1:${porta}` };
}

test("POST /equipe/:cod_equipe/remover faz o logout, descarta a instância e responde o contrato D1", async () => {
  const socket = await conectarPareada("61");

  const resposta = await postRemover("61", { hash_empresa: "hash-a" });

  assert.equal(resposta.status, 200);
  assert.deepEqual(await lerJson(resposta), {
    msg: "Equipe removida do WhatsApp.",
    cod_equipe: 61,
    status_conexao: "DESCONECTADO",
    ultimo_erro_conexao: null,
    havia_sessao: true,
    remocao_aparelho: "CONFIRMADA",
    instancia_descartada: true,
  });
  assert.equal(socket.chamadasLogout, 1);
  assert.equal(fs.existsSync(path.join(raiz, "sessoes", "61")), false);
  assert.equal(manager.obter(61), null);

  // Idempotente: nada mais da equipe.
  const outra = await lerJson(await postRemover("61", { hash_empresa: "hash-a" }));
  assert.equal(outra.havia_sessao, false);
  assert.equal(outra.instancia_descartada, false);
  assert.equal(outra.remocao_aparelho, "SEM_PAREAMENTO");
  assert.equal(outra.status_conexao, "DESCONECTADO");
});

test("POST /remover: sem token 401, código inválido 400, sem hash_empresa 400, outra empresa 409 sem tocar em nada", async () => {
  assert.equal((await postRemover("62", { hash_empresa: "hash-a" }, null)).status, 401);
  assert.equal((await postRemover("62", { hash_empresa: "hash-a" }, "token-errado")).status, 401);
  for (const cod of ["abc", "0", "-1", "1.5"]) {
    const r = await postRemover(cod, { hash_empresa: "hash-a" });
    assert.equal(r.status, 400, cod);
    assert.deepEqual(await lerJson(r), { msg: "Código da equipe inválido." });
  }
  for (const corpo of [{}, { hash_empresa: "" }, { hash_empresa: 5 }]) {
    const r = await postRemover("62", corpo);
    assert.equal(r.status, 400);
    assert.deepEqual(await lerJson(r), { msg: "Informe o hash_empresa da equipe." });
  }

  const socket = await conectarPareada("63");
  const r = await postRemover("63", { hash_empresa: "hash-b" });
  assert.equal(r.status, 409);
  assert.deepEqual(await lerJson(r), { msg: "Esta equipe já está conectada por outra empresa." });
  assert.equal(socket.chamadasLogout, 0);
  assert.equal(fs.existsSync(path.join(raiz, "sessoes", "63", "creds.json")), true);
  assert.ok(manager.obter(63), "a instância continua no Map");
});

test("POST /remover durante o encerramento responde 503 com Retry-After, sem tocar no manager", async () => {
  const { criarDesligamento, MSG_REINICIANDO } = require("../../src/utils/desligamento");
  const desligamento = criarDesligamento();
  desligamento.marcarEncerrando();
  let chamadas = 0;
  const { srv, url } = await subirApp({ ...manager, remover: async () => void (chamadas += 1) }, desligamento);
  try {
    const r = await fetch(`${url}/equipe/64/remover`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Internal-Token": TOKEN },
      body: JSON.stringify({ hash_empresa: "hash-a" }),
    });
    assert.equal(r.status, 503);
    assert.deepEqual(await lerJson(r), { msg: MSG_REINICIANDO });
    assert.ok(Number(r.headers.get("retry-after")) > 0);
    assert.equal(chamadas, 0);
  } finally {
    await new Promise((resolve) => srv.close(() => resolve(undefined)));
  }
});

test("POST /remover: falha inesperada do manager responde 500 sem vazar o erro", async () => {
  const { srv, url } = await subirApp({
    ...manager,
    remover: async () => {
      throw new Error("falha com 5500000000003");
    },
  });
  /** @type {string[]} */
  const logs = [];
  const erroOriginal = console.error;
  console.error = (...a) => void logs.push(a.map(String).join(" "));
  try {
    const r = await fetch(`${url}/equipe/65/remover`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Internal-Token": TOKEN },
      body: JSON.stringify({ hash_empresa: "hash-a" }),
    });
    assert.equal(r.status, 500);
    assert.deepEqual(await lerJson(r), { msg: "Erro ao remover a equipe do WhatsApp." });
    assert.ok(logs.length > 0);
    assert.ok(!logs.join(" ").includes("5500000000003"), "o log leva só o nome do erro");
  } finally {
    console.error = erroOriginal;
    await new Promise((resolve) => srv.close(() => resolve(undefined)));
  }
});
