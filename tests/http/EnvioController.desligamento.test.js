// @ts-check
// Task 14.3 no HTTP: durante o desligamento gracioso, `POST /equipe/:cod/enviar`, `/reagir` e
// `/conectar` respondem 503 com `{ msg }` (nunca aceitam e descartam em silêncio); um envio que já
// estava em andamento termina normalmente e o desligamento espera por ele. Um `sendMessage` que passa
// do prazo responde 504 "Envio não confirmado.". Manager, adapter e socket são falsos.
const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const baileysFalso = require("../helpers/baileysFalso");

baileysFalso.instalarBaileysFalso();
const { registrarControllers } = require("../../src/http");
const { criarEnvioController } = require("../../src/http/EnvioController");
const { criarConexaoController } = require("../../src/http/ConexaoController");
const { criarDesligamento, MSG_REINICIANDO } = require("../../src/utils/desligamento");
const { JID_CLIENTE, EU } = require("../helpers/mensagensWa");

const TOKEN = "token-back-para-wa";
const tokenOriginal = process.env.WA_BACK_ADMIN_TOKEN;

/** @type {{ modo: "ok" | "travar" | "manual" }} */
const estado = { modo: "ok" };
/** @type {{ jid: string, conteudo: any }[]} */
const envios = [];
/** @type {(() => void) | null} */
let concluirEnvioManual = null;
let conexoes = 0;
let desconexoes = 0;

const socket = {
  user: { id: EU.jid, lid: EU.lid },
  /** @param {string} jid @param {any} conteudo @param {any} opcoes */
  sendMessage(jid, conteudo, opcoes) {
    envios.push({ jid, conteudo });
    const resposta = { key: { remoteJid: jid, fromMe: true, id: opcoes.messageId }, message: {}, messageTimestamp: 1760400500 };
    if (estado.modo === "travar") return new Promise(() => {});
    if (estado.modo === "manual") return new Promise((resolve) => (concluirEnvioManual = () => resolve(resposta)));
    return Promise.resolve(resposta);
  },
};
const adapter = {
  codEquipe: "7",
  hashEmpresa: "hash-a",
  obterStatusConexao: () => ({ status_conexao: "CONECTADO", ultimo_erro_conexao: null }),
  socketConectado: () => socket,
  marcarEnviadaPeloCrm: () => {},
};
const manager = {
  /** @param {string | number} cod */
  obter: (cod) => (String(cod) === "7" ? /** @type {any} */ (adapter) : null),
  listarRegistradas: () => [],
  desconectar: async () => {
    desconexoes += 1;
    return { havia_sessao: true, remocao_aparelho: "CONFIRMADA" };
  },
  conectar: async () => {
    conexoes += 1;
    return adapter;
  },
};

/** @type {ReturnType<typeof criarDesligamento>} */
let desligamento = criarDesligamento();
/** @type {http.Server} */
let servidor;
let baseUrl = "";

before(async () => {
  process.env.WA_BACK_ADMIN_TOKEN = TOKEN;
  const app = express();
  app.use(express.json());
  // O controller consulta o desligamento a cada requisição (o teste troca a instância).
  const proxy = {
    estaEncerrando: () => desligamento.estaEncerrando(),
    /** @type {import("express").RequestHandler} */
    recusarDuranteEncerramento: (req, res, next) => desligamento.recusarDuranteEncerramento(req, res, next),
  };
  registrarControllers(app, [
    criarEnvioController(/** @type {any} */ (manager), { desligamento: /** @type {any} */ (proxy), prazoEnvioMs: 50, prazoEdicaoMs: 50, prazoExclusaoMs: 50 }),
    criarConexaoController(/** @type {any} */ (manager), { desligamento: /** @type {any} */ (proxy) }),
  ]);
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
  envios.length = 0;
  concluirEnvioManual = null;
  conexoes = 0;
  desconexoes = 0;
});

/** @param {string} texto */
function postEnviarTexto(texto) {
  const form = new FormData();
  form.append("hash_empresa", "hash-a");
  form.append("chat_jid", JID_CLIENTE);
  form.append("tipo", "TEXTO");
  form.append("texto", texto);
  return fetch(`${baseUrl}/equipe/7/enviar`, { method: "POST", headers: { "X-Internal-Token": TOKEN }, body: form });
}

/**
 * @param {string} caminho
 * @param {unknown} corpo
 */
function postJson(caminho, corpo) {
  return fetch(`${baseUrl}${caminho}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Internal-Token": TOKEN },
    body: JSON.stringify(corpo),
  });
}

test("um envio recebido durante o desligamento responde 503 com msg, sem chamar o sendMessage", async () => {
  desligamento.marcarEncerrando();
  const resposta = await postEnviarTexto("Oi");
  assert.equal(resposta.status, 503);
  assert.deepEqual(await resposta.json(), { msg: "Serviço de WhatsApp reiniciando. Tente novamente em instantes." });
  assert.equal(MSG_REINICIANDO, "Serviço de WhatsApp reiniciando. Tente novamente em instantes.");
  assert.ok(Number(resposta.headers.get("retry-after")) > 0, "Retry-After para o back saber que é temporário");
  assert.equal(envios.length, 0);
});

test("uma reação e um conectar durante o desligamento também respondem 503 (nada é aceito e descartado)", async () => {
  desligamento.marcarEncerrando();
  const reacao = await postJson("/equipe/7/reagir", { hash_empresa: "hash-a", chat_jid: JID_CLIENTE, key: { remoteJid: JID_CLIENTE, fromMe: false, id: "3EB0A1" }, emoji: "👍" });
  assert.equal(reacao.status, 503);
  assert.deepEqual(await reacao.json(), { msg: MSG_REINICIANDO });
  const conectar = await postJson("/equipe/7/conectar", { hash_empresa: "hash-a" });
  assert.equal(conectar.status, 503);
  assert.equal(conexoes, 0);
  assert.equal(envios.length, 0);
});

test("sem o token de serviço continua 401 mesmo durante o desligamento", async () => {
  desligamento.marcarEncerrando();
  const resposta = await fetch(`${baseUrl}/equipe/7/enviar`, { method: "POST", body: new FormData() });
  assert.equal(resposta.status, 401);
});

test("um envio já em andamento termina com 200 e o desligamento espera por ele", async () => {
  estado.modo = "manual";
  const emAndamento = postEnviarTexto("Oi");
  while (!concluirEnvioManual) await new Promise((resolve) => setTimeout(resolve, 5));

  desligamento.marcarEncerrando();
  let esperou = false;
  const espera = desligamento.aguardarEmAndamento().then(() => (esperou = true));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(esperou, false, "o envio em andamento ainda não respondeu");

  /** @type {() => void} */ (concluirEnvioManual)();
  const resposta = await emAndamento;
  assert.equal(resposta.status, 200);
  assert.equal(/** @type {any} */ (await resposta.json()).status, "ENVIADA");
  await espera;
  assert.equal(esperou, true);
});

test("sendMessage que passa do prazo responde 504 { msg: \"Envio não confirmado.\" }", async () => {
  estado.modo = "travar";
  const resposta = await postEnviarTexto("Oi");
  assert.equal(resposta.status, 504);
  assert.deepEqual(await resposta.json(), { msg: "Envio não confirmado." });
});

test("fora do desligamento o envio segue normal (200)", async () => {
  const resposta = await postEnviarTexto("Oi");
  assert.equal(resposta.status, 200);
  assert.equal(desligamento.estaEncerrando(), false);
});

test("desconectar durante o desligamento responde 503 com Retry-After, sem tocar no manager", async () => {
  desligamento.marcarEncerrando();
  const resposta = await postJson("/equipe/7/desconectar", { hash_empresa: "hash-a" });
  assert.equal(resposta.status, 503);
  assert.deepEqual(await resposta.json(), { msg: MSG_REINICIANDO });
  assert.ok(Number(resposta.headers.get("retry-after")) > 0);
  assert.equal(desconexoes, 0);
});

test("Fase 40: editar durante o desligamento responde 503 com Retry-After, sem chamar o sendMessage", async () => {
  desligamento.marcarEncerrando();
  const key = { remoteJid: JID_CLIENTE, fromMe: true, id: "3EB0ORIG1" };
  const resposta = await postJson("/equipe/7/editar", { hash_empresa: "hash-a", chat_jid: JID_CLIENTE, key, texto: "novo" });
  assert.equal(resposta.status, 503);
  assert.deepEqual(await resposta.json(), { msg: MSG_REINICIANDO });
  assert.ok(Number(resposta.headers.get("retry-after")) > 0);
  assert.equal(envios.length, 0);
});

test("Fase 40: sendMessage da edição que passa do prazo responde 504 { msg: \"Envio não confirmado.\" }", async () => {
  estado.modo = "travar";
  const key = { remoteJid: JID_CLIENTE, fromMe: true, id: "3EB0ORIG1" };
  const resposta = await postJson("/equipe/7/editar", { hash_empresa: "hash-a", chat_jid: JID_CLIENTE, key, texto: "novo" });
  assert.equal(resposta.status, 504);
  assert.deepEqual(await resposta.json(), { msg: "Envio não confirmado." });
});

test("Fase 41: apagar durante o desligamento responde 503 com Retry-After, sem chamar o sendMessage", async () => {
  desligamento.marcarEncerrando();
  const key = { remoteJid: JID_CLIENTE, fromMe: true, id: "3EB0ORIG1" };
  const resposta = await postJson("/equipe/7/apagar", { hash_empresa: "hash-a", chat_jid: JID_CLIENTE, key });
  assert.equal(resposta.status, 503);
  assert.deepEqual(await resposta.json(), { msg: MSG_REINICIANDO });
  assert.ok(Number(resposta.headers.get("retry-after")) > 0);
  assert.equal(envios.length, 0);
});

test("Fase 41: sendMessage da exclusão que passa do prazo responde 504 { msg: \"Envio não confirmado.\" }", async () => {
  estado.modo = "travar";
  const key = { remoteJid: JID_CLIENTE, fromMe: true, id: "3EB0ORIG1" };
  const resposta = await postJson("/equipe/7/apagar", { hash_empresa: "hash-a", chat_jid: JID_CLIENTE, key });
  assert.equal(resposta.status, 504);
  assert.deepEqual(await resposta.json(), { msg: "Envio não confirmado." });
});
