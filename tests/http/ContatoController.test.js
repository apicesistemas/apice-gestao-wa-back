// @ts-check
// POST /equipe/:cod_equipe/contato/consultar (Fase 44, Task 44.1, contrato D1). Manager, adapter e resolvedor de LID
// reais, com o socket Baileys falso (tests/helpers/baileysFalso.js). Nenhum número real, nenhuma conexão real. A rota
// não envia nada: nenhum sendMessage e nenhuma chamada ao back em nenhum caminho.
const { test, before, after, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const express = require("express");
const baileysFalso = require("../helpers/baileysFalso");

baileysFalso.instalarBaileysFalso();
const { registrarControllers, CONTROLLERS } = require("../../src/http");
const ContatoController = require("../../src/http/ContatoController");
const { criarContatoController, ALLOWLIST_CONSULTA } = ContatoController;
const BaileysAdapter = require("../../src/whatsapp/BaileysAdapter");
const { criarInstanciaManager } = require("../../src/whatsapp/instanciaManager");
const { criarDesligamento } = require("../../src/utils/desligamento");
const { EU, TELEFONE_EQUIPE } = require("../helpers/mensagensWa");

const { criarGrupoFalso } = baileysFalso;
const TOKEN = "token-back-para-wa";
const tokenOriginal = process.env.WA_BACK_ADMIN_TOKEN;
const LID_A = "10000000000031@lid";
const FONE_PEDIDO = "551188887777"; // sem o 9º dígito
const JID_REAL = "5511988887777@s.whatsapp.net"; // o WhatsApp devolve com o 9
const FONE_REAL = "5511988887777";
const FONE_B = "5511900000011";
const JID_B = `${FONE_B}@s.whatsapp.net`;
const NUMEROS = { [FONE_PEDIDO]: { jid: JID_REAL, lid: LID_A }, [FONE_B]: JID_B };

const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "wa-back-contato-tel-"));

/** @type {ReturnType<typeof criarInstanciaManager>} */
let manager;
let desligamento = criarDesligamento();
let contador = 0;
/** @type {http.Server} */
let servidor;
let baseUrl = "";
/** @type {string[]} */
let linhas = [];
const originais = { log: console.log, error: console.error };
const fetchOriginal = globalThis.fetch;
let reportes = 0;
let reportesBase = 0;
let registros = 0;
/** @type {string[]} */
let fetchsDeSaida = [];
/** @type {any[]} */
let gruposDoTeste = [];
let msPrazoConsulta = 80;

before(async () => {
  process.env.WA_BACK_ADMIN_TOKEN = TOKEN;
  const app = express();
  /** @param {any} req @param {any} res @param {any} next */
  const delegar = (req, res, next) => {
    const sub = express();
    sub.use(express.json());
    registrarControllers(sub, [criarContatoController(manager, { desligamento, msPrazoConsulta })]);
    sub(req, res, next);
  };
  app.use(delegar);
  servidor = http.createServer(app);
  await new Promise((resolve) => servidor.listen(0, () => resolve(undefined)));
  const endereco = servidor.address();
  assert.ok(endereco && typeof endereco === "object");
  baseUrl = `http://127.0.0.1:${endereco.port}`;
  globalThis.fetch = /** @type {any} */ (
    (/** @type {any} */ url, /** @type {any} */ init) => {
      if (!String(url).startsWith(baseUrl)) {
        fetchsDeSaida.push(String(url));
        return Promise.reject(new Error("fetch de saída bloqueado no teste"));
      }
      return fetchOriginal(url, init);
    }
  );
});

after(async () => {
  globalThis.fetch = fetchOriginal;
  await new Promise((resolve) => servidor.close(() => resolve(undefined)));
  fs.rmSync(raiz, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  if (tokenOriginal === undefined) delete process.env.WA_BACK_ADMIN_TOKEN;
  else process.env.WA_BACK_ADMIN_TOKEN = tokenOriginal;
});

beforeEach(() => {
  baileysFalso.limparHistorico();
  desligamento = criarDesligamento();
  msPrazoConsulta = 80;
  contador += 1;
  linhas = [];
  reportes = 0;
  reportesBase = 0;
  registros = 0;
  fetchsDeSaida = [];
  gruposDoTeste = [];
  const gravar = (/** @type {any[]} */ ...args) => void linhas.push(args.map(String).join(" "));
  console.log = gravar;
  console.error = gravar;
  manager = criarInstanciaManager({
    diretorioSessoes: path.join(raiz, `sessoes-${contador}`),
    caminhoRegistro: path.join(raiz, `cache-${contador}`, "equipes-wa.json"),
    reportarStatus: async () => {
      reportes += 1;
    },
    criarAdapter: (opcoes) =>
      BaileysAdapter.criarAdapter({
        ...opcoes,
        registrarMensagem: async () => {
          registros += 1;
        },
      }),
  });
});

afterEach(() => {
  console.log = originais.log;
  console.error = originais.error;
  for (const grupo of gruposDoTeste) {
    assert.deepEqual(grupo.chamadas.envios, [], "nenhum sendMessage");
    assert.deepEqual(grupo.chamadas.add, [], "nenhuma alteração de grupo");
    assert.deepEqual(grupo.chamadas.criacoes, [], "nenhuma criação de grupo");
  }
  assert.equal(registros, 0, "nenhuma mensagem registrada no back");
  assert.equal(reportes, reportesBase, "nenhum status reportado ao back além da conexão");
  assert.deepEqual(fetchsDeSaida, [], "nenhuma chamada a /interno/* nem a outro endereço");
});

/**
 * @param {string} cod
 * @param {Parameters<typeof criarGrupoFalso>[0]} [config]
 */
async function conectarEquipe(cod, config = {}) {
  const grupo = criarGrupoFalso({ numeros: NUMEROS, ...config });
  await manager.conectar(cod, "hash-a");
  const socket = /** @type {any} */ (baileysFalso.ultimoSocket());
  fs.writeFileSync(path.join(raiz, `sessoes-${contador}`, cod, "creds.json"), "{}");
  Object.assign(socket, { user: { id: EU.jid, lid: EU.lid } }, grupo.metodos);
  await socket.emitir("connection.update", { connection: "open" });
  await baileysFalso.drenar();
  gruposDoTeste.push(grupo);
  reportesBase = reportes;
  return { grupo, socket };
}

/**
 * @param {unknown} corpo
 * @param {{ token?: string | null, cod?: string }} [opcoes]
 */
function post(corpo, { token = TOKEN, cod = "7" } = {}) {
  return fetch(`${baseUrl}/equipe/${cod}/contato/consultar`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { "X-Internal-Token": token } : {}) },
    body: JSON.stringify(corpo),
  });
}

const VALIDO = { hash_empresa: "hash-a", telefone: FONE_PEDIDO };

test("200: UM onWhatsApp, jid_privado é o DEVOLVIDO (com o 9º dígito), nunca o pedido, com o LID da consulta", async () => {
  const { grupo } = await conectarEquipe("7");
  const resposta = await post(VALIDO);
  assert.equal(resposta.status, 200);
  assert.deepEqual(await resposta.json(), { jid_privado: JID_REAL, lid: LID_A, telefone: FONE_REAL });
  assert.deepEqual(grupo.chamadas.onWhatsApp, [[`${FONE_PEDIDO}@s.whatsapp.net`]]);
});

test("200 sem LID na consulta: lid null; o jid devolvido sem o 9 também é o devolvido", async () => {
  const { grupo } = await conectarEquipe("7", { numeros: { "5511988887777": { jid: "551188887777@s.whatsapp.net" } } });
  const resposta = await post({ ...VALIDO, telefone: "5511988887777" });
  assert.equal(resposta.status, 200);
  assert.deepEqual(await resposta.json(), { jid_privado: "551188887777@s.whatsapp.net", lid: null, telefone: "551188887777" });
  assert.equal(grupo.chamadas.onWhatsApp.length, 1);
});

test("o par LID <-> telefone é aprendido: a consulta seguinte, sem LID, usa o do resolvedor", async () => {
  const { grupo } = await conectarEquipe("7", { numeros: { [FONE_PEDIDO]: { jid: JID_REAL, lid: LID_A }, [FONE_B]: JID_B } });
  const primeira = await post(VALIDO);
  assert.equal(((/** @type {any} */ (await primeira.json()))).lid, LID_A);
  // O Baileys passa a devolver o mesmo número sem o LID: o resolvedor ainda tem o par.
  const adapter = /** @type {any} */ (manager.obter("7"));
  const socket = adapter.socketConectado();
  socket.onWhatsApp = async () => [{ jid: JID_REAL, exists: true }];
  const segunda = await post(VALIDO);
  assert.equal(segunda.status, 200);
  assert.deepEqual(await segunda.json(), { jid_privado: JID_REAL, lid: LID_A, telefone: FONE_REAL });
  assert.equal(adapter.socketConectado(), socket);
  assert.ok(grupo.chamadas.onWhatsApp.length >= 1);
});

test("ausente no onWhatsApp → 409 SEM_WHATSAPP", async () => {
  await conectarEquipe("7", { numeros: {} });
  const resposta = await post(VALIDO);
  assert.equal(resposta.status, 409);
  assert.deepEqual(await resposta.json(), { msg: "Este número não tem WhatsApp.", codigo: "SEM_WHATSAPP" });
});

test("número da própria equipe → 400 PROPRIO_NUMERO, pelo pedido e pela variante do 9º dígito devolvida", async () => {
  // Pedido igual ao da equipe: nem consulta.
  const { grupo } = await conectarEquipe("7");
  const direto = await post({ ...VALIDO, telefone: TELEFONE_EQUIPE });
  assert.equal(direto.status, 400);
  assert.deepEqual(await direto.json(), { msg: "Não é possível iniciar conversa com o número da própria equipe.", codigo: "PROPRIO_NUMERO" });
  assert.deepEqual(grupo.chamadas.onWhatsApp, []);

  // Pedido diferente, mas o jid devolvido é o da equipe (variante do 9º dígito).
  baileysFalso.limparHistorico();
  const pedido = "551133334444"; // o WhatsApp o resolve para o jid da equipe
  const { grupo: g2 } = await conectarEquipe("8", { numeros: { [pedido]: { jid: `${TELEFONE_EQUIPE}@s.whatsapp.net` } } });
  const devolvida = await post({ ...VALIDO, telefone: pedido }, { cod: "8" });
  assert.equal(devolvida.status, 400);
  assert.equal(((/** @type {any} */ (await devolvida.json()))).codigo, "PROPRIO_NUMERO");
  assert.equal(g2.chamadas.onWhatsApp.length, 1);
});

test("LID devolvido igual ao da equipe → 400 PROPRIO_NUMERO", async () => {
  await conectarEquipe("7", { numeros: { [FONE_PEDIDO]: { jid: JID_REAL, lid: EU.lid } } });
  const resposta = await post(VALIDO);
  assert.equal(resposta.status, 400);
  assert.equal(((/** @type {any} */ (await resposta.json()))).codigo, "PROPRIO_NUMERO");
});

test("prazo da consulta esgotado → 504; falha → 502, sem o texto original nem o número no log", async () => {
  await conectarEquipe("7", { aoChamar: (e) => (e === "onWhatsApp" ? new Promise(() => {}) : undefined) });
  const lenta = await post(VALIDO);
  assert.equal(lenta.status, 504);
  assert.deepEqual(await lenta.json(), { msg: "A consulta do número não respondeu." });
  baileysFalso.limparHistorico();
  await conectarEquipe("8", { numeros: { [FONE_PEDIDO]: new Error(`falha ${FONE_PEDIDO}`) } });
  const falha = await post(VALIDO, { cod: "8" });
  assert.equal(falha.status, 502);
  assert.deepEqual(await falha.json(), { msg: "Não foi possível consultar o número." });
  assert.doesNotMatch(linhas.join("\n"), new RegExp(FONE_PEDIDO));
});

test("allowlist: transcricao, nota_interna, explicacao, sugestao_ia ou chave desconhecida → 400, sem chamar onWhatsApp", async () => {
  const { grupo } = await conectarEquipe("7");
  for (const extra of [{ transcricao: "x" }, { nota_interna: "x" }, { explicacao: "x" }, { sugestao_ia: "x" }, { texto: "x" }]) {
    const resposta = await post({ ...VALIDO, ...extra });
    assert.equal(resposta.status, 400, JSON.stringify(Object.keys(extra)));
    assert.match(String((/** @type {any} */ (await resposta.json())).msg), /não permitido/i);
  }
  assert.deepEqual(grupo.chamadas.onWhatsApp, []);
  assert.deepEqual([...ALLOWLIST_CONSULTA].sort(), ["hash_empresa", "telefone"]);
});

test("400: telefone fora de /^55\\d{10,11}$/, corpo que não é objeto e código da equipe inválido", async () => {
  const { grupo } = await conectarEquipe("7");
  const casos = [
    { ...VALIDO, telefone: "44998581434" },
    { ...VALIDO, telefone: "+5544998581434" },
    { ...VALIDO, telefone: "55449985814" + "345" },
    { ...VALIDO, telefone: "554499858" },
    { ...VALIDO, telefone: `${FONE_PEDIDO}@s.whatsapp.net` },
    { ...VALIDO, telefone: 5511988887777 },
    { hash_empresa: "hash-a" },
    [],
  ];
  for (const corpo of casos) {
    const r = await post(corpo);
    assert.equal(r.status, 400, JSON.stringify(corpo));
  }
  const invalido = await post({ ...VALIDO, telefone: "123" });
  assert.deepEqual(await invalido.json(), { msg: "Telefone inválido: confira o DDD e o número." });
  assert.equal((await post(VALIDO, { cod: "abc" })).status, 400);
  assert.deepEqual(grupo.chamadas.onWhatsApp, []);
});

test("401 sem token ou com token errado; 404 de outro tenant (mesmo corpo); 409 DESCONECTADA; 503 + Retry-After", async () => {
  const { grupo } = await conectarEquipe("7");
  assert.equal((await post(VALIDO, { token: null })).status, 401);
  assert.equal((await post(VALIDO, { token: "errado" })).status, 401);
  const outro = await post({ ...VALIDO, hash_empresa: "hash-b" });
  assert.equal(outro.status, 404);
  assert.deepEqual(await outro.json(), { msg: "Equipe não encontrada." });
  const desconectada = await post(VALIDO, { cod: "9" });
  assert.equal(desconectada.status, 409);
  assert.deepEqual(await desconectada.json(), { msg: "O WhatsApp da equipe não está conectado.", codigo: "DESCONECTADA" });
  desligamento.marcarEncerrando();
  const durante = await post(VALIDO);
  assert.equal(durante.status, 503);
  assert.ok(Number(durante.headers.get("retry-after")) > 0);
  assert.deepEqual(grupo.chamadas.onWhatsApp, []);
});

test("equipe que caiu entre a checagem e a consulta → 409 DESCONECTADA", async () => {
  await conectarEquipe("7");
  const adapter = /** @type {any} */ (manager.obter("7"));
  const original = adapter.resolverContatoTelefone;
  adapter.resolverContatoTelefone = async () => {
    const { ErroGrupo } = require("../../src/whatsapp/grupoGestao");
    throw new ErroGrupo("DESCONECTADA");
  };
  const r = await post(VALIDO);
  assert.equal(r.status, 409);
  assert.equal(((/** @type {any} */ (await r.json()))).codigo, "DESCONECTADA");
  adapter.resolverContatoTelefone = original;
});

test("500 sem vazar o erro e 502 quando o adapter não tem o método", async () => {
  await conectarEquipe("7");
  const adapter = /** @type {any} */ (manager.obter("7"));
  const original = adapter.resolverContatoTelefone;
  adapter.resolverContatoTelefone = async () => {
    throw new Error(`explodiu ${FONE_PEDIDO} ${LID_A}`);
  };
  const quebrou = await post(VALIDO);
  assert.equal(quebrou.status, 500);
  assert.deepEqual(await quebrou.json(), { msg: "Erro interno ao consultar o número." });
  adapter.resolverContatoTelefone = undefined;
  const semMetodo = await post(VALIDO);
  assert.equal(semMetodo.status, 502);
  adapter.resolverContatoTelefone = original;
  assert.doesNotMatch(linhas.join("\n"), new RegExp(`${FONE_PEDIDO}|${LID_A}|@lid|@s\\.whatsapp`));
});

test("nenhum log leva telefone, JID ou LID em nenhum caminho", async () => {
  await conectarEquipe("7", { numeros: { [FONE_PEDIDO]: new Error(`falha ${FONE_PEDIDO}`) } });
  await post(VALIDO);
  await post({ ...VALIDO, telefone: TELEFONE_EQUIPE });
  await post({ ...VALIDO, telefone: "1" });
  assert.doesNotMatch(linhas.join("\n"), /\d{10,}|@lid|@s\.whatsapp|@g\.us/);
});

test("o controller padrão está registrado em src/http/index.js", () => {
  assert.ok(CONTROLLERS.includes(ContatoController));
});

test("o controller padrão (sem manager injetado) usa o instanciaManager do processo", async () => {
  const app = express();
  app.use(express.json());
  ContatoController(app);
  const s = http.createServer(app);
  await new Promise((resolve) => s.listen(0, () => resolve(undefined)));
  try {
    const porta = /** @type {any} */ (s.address()).port;
    const r = await fetchOriginal(`http://127.0.0.1:${porta}/equipe/1/contato/consultar`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Internal-Token": TOKEN },
      body: JSON.stringify(VALIDO),
    });
    assert.equal(r.status, 409); // o manager do processo não tem instância: DESCONECTADA
  } finally {
    await new Promise((resolve) => s.close(() => resolve(undefined)));
  }
});
