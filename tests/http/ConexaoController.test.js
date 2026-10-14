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
