// @ts-check
// POST /equipe/:cod_equipe/grupo/participante/contato (Fase 32, Task 32.1, contrato D1). Manager, adapter, nomeGrupo e
// resolvedor de LID reais, com o socket Baileys falso (tests/helpers/baileysFalso.js). Nenhum número real, nenhuma
// conexão real. A rota não envia nada: nenhum sendMessage e nenhuma chamada ao back em nenhum caminho.
const { test, before, after, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const express = require("express");
const baileysFalso = require("../helpers/baileysFalso");

baileysFalso.instalarBaileysFalso();
const { registrarControllers } = require("../../src/http");
const { criarGrupoController } = require("../../src/http/GrupoController");
const BaileysAdapter = require("../../src/whatsapp/BaileysAdapter");
const { criarInstanciaManager } = require("../../src/whatsapp/instanciaManager");
const { criarTravaGrupo } = require("../../src/whatsapp/travaGrupo");
const { criarDesligamento } = require("../../src/utils/desligamento");
const { EU, TELEFONE_EQUIPE } = require("../helpers/mensagensWa");

const { criarGrupoFalso } = baileysFalso;
const TOKEN = "token-back-para-wa";
const tokenOriginal = process.env.WA_BACK_ADMIN_TOKEN;
const GRUPO = "120363000000000001@g.us";
const LID_A = "10000000000031@lid";
const LID_B = "10000000000032@lid";
const LID_C = "10000000000033@lid";
const LID_FORA = "10000000000099@lid";
const FONE_A = "551188887777";
const JID_A_REAL = "5511988887777@s.whatsapp.net";
const FONE_B = "5511900000011";
const JID_B = `${FONE_B}@s.whatsapp.net`;
const EU_PARTICIPANTE = { id: "100000000000099@lid", lid: "100000000000099@lid", jid: `${TELEFONE_EQUIPE}@s.whatsapp.net`, admin: "superadmin" };
const PARTICIPANTES = [
  EU_PARTICIPANTE,
  { id: LID_A, lid: LID_A, jid: `${FONE_A}@s.whatsapp.net`, admin: null },
  { id: LID_B, lid: LID_B, admin: null },
  { id: LID_C, lid: LID_C, admin: null },
];
const NUMEROS = { [FONE_A]: { jid: JID_A_REAL, lid: "10000000000055@lid" }, [FONE_B]: JID_B };

const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "wa-back-contato-"));

/** @type {ReturnType<typeof criarInstanciaManager>} */
let manager;
let desligamento = criarDesligamento();
/** @type {ReturnType<typeof criarTravaGrupo>} */
let trava = criarTravaGrupo();
let contador = 0;
/** @type {http.Server} */
let servidor;
let baseUrl = "";
/** @type {string[]} */
let linhas = [];
const originais = { log: console.log, error: console.error };
const fetchOriginal = globalThis.fetch;
// Prova de "não envia nada e não chama o back": contadores dos stubs e espião de qualquer fetch que não seja
// para o servidor de teste (inclui http para o back). Conferidos no afterEach de TODOS os testes, de sucesso e de erro.
let reportes = 0;
let reportesBase = 0;
let registros = 0;
/** @type {string[]} */
let fetchsDeSaida = [];
/** @type {any[]} */
let gruposDoTeste = [];

before(async () => {
  process.env.WA_BACK_ADMIN_TOKEN = TOKEN;
  const app = express();
  /** @param {any} req @param {any} res @param {any} next */
  const delegar = (req, res, next) => {
    const sub = express();
    sub.use(express.json());
    registrarControllers(sub, [criarGrupoController(manager, { desligamento, travaGrupo: trava, msPrazoConsulta: 80 })]);
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
  fs.rmSync(raiz, { recursive: true, force: true });
  if (tokenOriginal === undefined) delete process.env.WA_BACK_ADMIN_TOKEN;
  else process.env.WA_BACK_ADMIN_TOKEN = tokenOriginal;
});

beforeEach(() => {
  baileysFalso.limparHistorico();
  desligamento = criarDesligamento();
  trava = criarTravaGrupo();
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
    travaGrupo: trava,
    criarAdapter: (opcoes) => BaileysAdapter.criarAdapter({ ...opcoes, registrarMensagem: async () => {
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
  const grupo = criarGrupoFalso({ participantes: PARTICIPANTES, numeros: NUMEROS, ...config });
  await manager.conectar(cod, "hash-a");
  const socket = /** @type {any} */ (baileysFalso.ultimoSocket());
  fs.writeFileSync(path.join(raiz, `sessoes-${contador}`, cod, "creds.json"), "{}");
  Object.assign(socket, { user: { id: EU.jid, lid: EU.lid } }, grupo.metodos);
  await socket.emitir("connection.update", { connection: "open" });
  await baileysFalso.drenar();
  gruposDoTeste.push(grupo);
  reportesBase = reportes; // o status da própria conexão é legítimo; o que vem depois, não
  return { grupo, socket };
}

/**
 * @param {unknown} corpo
 * @param {{ token?: string | null, cod?: string }} [opcoes]
 */
function post(corpo, { token = TOKEN, cod = "7" } = {}) {
  return fetch(`${baseUrl}/equipe/${cod}/grupo/participante/contato`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { "X-Internal-Token": token } : {}) },
    body: JSON.stringify(corpo),
  });
}

const VALIDO = { hash_empresa: "hash-a", chat_jid: GRUPO, participante_jid: LID_A };

/** @param {import("../helpers/baileysFalso").SocketFalso | any} grupo */
const semEfeitos = (grupo) => {
  assert.deepEqual(grupo.chamadas.envios, [], "nenhum sendMessage");
  assert.deepEqual(grupo.chamadas.add, []);
  assert.deepEqual(grupo.chamadas.criacoes, []);
};

test("200 com telefone: UM onWhatsApp e o jid_privado é o devolvido pela consulta (9º dígito), nunca o digitado, com o LID", async () => {
  const { grupo } = await conectarEquipe("7");
  const resposta = await post(VALIDO);
  assert.equal(resposta.status, 200);
  assert.deepEqual(await resposta.json(), { jid_privado: JID_A_REAL, lid: LID_A, telefone: "5511988887777" });
  assert.deepEqual(grupo.chamadas.onWhatsApp, [[`${FONE_A}@s.whatsapp.net`]]);
  semEfeitos(grupo);
});

test("o par aprendido na consulta serve à próxima: o mesmo LID sem telefone no grupo passa a usar o par", async () => {
  const { grupo, socket } = await conectarEquipe("7", { numeros: { ...NUMEROS, [FONE_B]: { jid: JID_B, lid: LID_B } } });
  await socket.emitir("contacts.upsert", [{ id: LID_B, jid: JID_B }]);
  const resposta = await post({ ...VALIDO, participante_jid: LID_B });
  assert.equal(resposta.status, 200);
  assert.deepEqual(await resposta.json(), { jid_privado: JID_B, lid: LID_B, telefone: FONE_B });
  assert.equal(grupo.chamadas.onWhatsApp.length, 1);
});

test("só-LID sem par → 200 { jid_privado: <lid>, telefone: null } sem onWhatsApp", async () => {
  const { grupo } = await conectarEquipe("7");
  const resposta = await post({ ...VALIDO, participante_jid: LID_C });
  assert.equal(resposta.status, 200);
  assert.deepEqual(await resposta.json(), { jid_privado: LID_C, lid: LID_C, telefone: null });
  assert.deepEqual(grupo.chamadas.onWhatsApp, []);
  semEfeitos(grupo);
});

test("o participante também é achado pelo jid de telefone", async () => {
  await conectarEquipe("7");
  const resposta = await post({ ...VALIDO, participante_jid: `${FONE_A}@s.whatsapp.net` });
  assert.equal(resposta.status, 200);
  assert.equal(((/** @type {any} */ (await resposta.json()))).lid, LID_A);
});

test("ausente no onWhatsApp → 409 SEM_WHATSAPP", async () => {
  await conectarEquipe("7", { numeros: {} });
  const resposta = await post(VALIDO);
  assert.equal(resposta.status, 409);
  assert.deepEqual(await resposta.json(), { msg: "Este número não tem WhatsApp.", codigo: "SEM_WHATSAPP" });
});

test("prazo da consulta do número esgotado → 504; falha dela → 502, sem o texto original", async () => {
  await conectarEquipe("7", { aoChamar: (e) => (e === "onWhatsApp" ? new Promise(() => {}) : undefined) });
  const lenta = await post(VALIDO);
  assert.equal(lenta.status, 504);
  assert.deepEqual(await lenta.json(), { msg: "A consulta do participante não respondeu." });
  baileysFalso.limparHistorico();
  await conectarEquipe("8", { numeros: { [FONE_A]: new Error(`falha ${FONE_A}`) } });
  const falha = await post(VALIDO, { cod: "8" });
  assert.equal(falha.status, 502);
  assert.deepEqual(await falha.json(), { msg: "Não foi possível consultar o participante." });
  assert.doesNotMatch(linhas.join("\n"), new RegExp(FONE_A));
});

test("fora do grupo → 409 FORA_DO_GRUPO; número da equipe → 400 PROPRIO_NUMERO; equipe fora do grupo → 404 'Grupo não encontrado.'", async () => {
  const { grupo } = await conectarEquipe("7");
  const fora = await post({ ...VALIDO, participante_jid: LID_FORA });
  assert.equal(fora.status, 409);
  assert.deepEqual(await fora.json(), { msg: "Participante não encontrado no grupo.", codigo: "FORA_DO_GRUPO" });
  for (const participante_jid of [EU_PARTICIPANTE.id, `${TELEFONE_EQUIPE}@s.whatsapp.net`]) {
    const proprio = await post({ ...VALIDO, participante_jid });
    assert.equal(proprio.status, 400);
    assert.deepEqual(await proprio.json(), { msg: "Não é possível iniciar conversa com o número da própria equipe.", codigo: "PROPRIO_NUMERO" });
  }
  assert.deepEqual(grupo.chamadas.onWhatsApp, []);

  baileysFalso.limparHistorico();
  await conectarEquipe("8", { participantes: PARTICIPANTES.slice(1) });
  const semEquipe = await post(VALIDO, { cod: "8" });
  assert.equal(semEquipe.status, 404);
  assert.deepEqual(await semEquipe.json(), { msg: "Grupo não encontrado." });
});

test("grupo que o WhatsApp não devolve (403) → 404; consulta do grupo travada → 504; falha → 502", async () => {
  const { socket } = await conectarEquipe("7");
  socket.groupMetadata = async () => {
    throw Object.assign(new Error("forbidden"), { output: { statusCode: 403 } });
  };
  const naoAchou = await post(VALIDO);
  assert.equal(naoAchou.status, 404);
  assert.deepEqual(await naoAchou.json(), { msg: "Grupo não encontrado." });

  const falha = await conectarEquipe("8");
  falha.socket.groupMetadata = async () => {
    throw new Error("falha");
  };
  const quebrou = await post(VALIDO, { cod: "8" });
  assert.equal(quebrou.status, 502);
  assert.deepEqual(await quebrou.json(), { msg: "Não foi possível consultar o participante." });
});

test("allowlist: transcricao, nota_interna, explicacao ou chave desconhecida → 400, sem tocar no Baileys", async () => {
  const { grupo } = await conectarEquipe("7");
  for (const extra of [{ transcricao: "x" }, { nota_interna: "x" }, { explicacao: "x" }, { texto: "x" }, { chat_jid_extra: "x" }]) {
    const resposta = await post({ ...VALIDO, ...extra });
    assert.equal(resposta.status, 400, JSON.stringify(Object.keys(extra)));
    assert.match(String((/** @type {any} */ (await resposta.json())).msg), /não permitido/i);
  }
  assert.equal(grupo.chamadas.metadata + grupo.chamadas.onWhatsApp.length, 0);
});

test("400: grupo ou participante inválido, hash ausente, corpo que não é objeto e código da equipe inválido", async () => {
  const { grupo } = await conectarEquipe("7");
  const casos = [
    { ...VALIDO, chat_jid: "abc" },
    { ...VALIDO, chat_jid: 7 },
    { ...VALIDO, participante_jid: "abc" },
    { ...VALIDO, participante_jid: `${FONE_A}@lid2` },
    { ...VALIDO, participante_jid: "123@s.whatsapp.net" },
    { ...VALIDO, participante_jid: `${FONE_A}:9@s.whatsapp.net` },
    { ...VALIDO, participante_jid: GRUPO },
    { chat_jid: GRUPO, participante_jid: LID_A },
    { ...VALIDO, hash_empresa: "" },
    [],
  ];
  for (const corpo of casos) assert.equal((await post(corpo)).status, 400, JSON.stringify(corpo));
  assert.equal((await post(VALIDO, { cod: "abc" })).status, 400);
  assert.equal(grupo.chamadas.metadata + grupo.chamadas.onWhatsApp.length, 0);
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
  assert.equal(grupo.chamadas.onWhatsApp.length + grupo.chamadas.metadata, 0);
});

test("a rota não usa a trava de grupo: responde mesmo com uma adição em andamento na equipe", async () => {
  assert.ok(trava.entrar("7"));
  await conectarEquipe("7");
  const resposta = await post(VALIDO);
  assert.equal(resposta.status, 200);
});

test("500 sem vazar o erro e 502 quando o adapter não tem o método", async () => {
  await conectarEquipe("7");
  const adapter = /** @type {any} */ (manager.obter("7"));
  const original = adapter.resolverContatoParticipante;
  adapter.resolverContatoParticipante = async () => {
    throw new Error(`explodiu ${FONE_A} ${LID_A}`);
  };
  const quebrou = await post(VALIDO);
  assert.equal(quebrou.status, 500);
  assert.deepEqual(await quebrou.json(), { msg: "Erro interno ao identificar o participante." });
  adapter.resolverContatoParticipante = undefined;
  const semMetodo = await post(VALIDO);
  assert.equal(semMetodo.status, 502);
  adapter.resolverContatoParticipante = original;
  assert.doesNotMatch(linhas.join("\n"), new RegExp(`${FONE_A}|${LID_A}|@lid|@s\\.whatsapp`));
});

test("nenhum log leva telefone, JID ou LID em nenhum caminho", async () => {
  await conectarEquipe("7", { numeros: { [FONE_A]: new Error(`falha ${FONE_A}`) } });
  await post(VALIDO);
  await post({ ...VALIDO, participante_jid: LID_FORA });
  await post({ ...VALIDO, participante_jid: EU_PARTICIPANTE.id });
  assert.doesNotMatch(linhas.join("\n"), /\d{10,}|@lid|@s\.whatsapp|@g\.us/);
});
