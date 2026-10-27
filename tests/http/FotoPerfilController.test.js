// @ts-check
// POST /equipe/:cod_equipe/foto-perfil (Fase 32, Task 32.1, contrato D2). Manager, adapter e nomeGrupo reais, com o
// socket Baileys falso e o download da imagem trocado no `fetch` global (só para os endereços do CDN falso). Nenhuma
// rede real, nenhum número real. Nada em disco e nada de URL, JID ou LID no console.
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
const { criarFotoPerfilController } = require("../../src/http/FotoPerfilController");
const BaileysAdapter = require("../../src/whatsapp/BaileysAdapter");
const { criarInstanciaManager } = require("../../src/whatsapp/instanciaManager");
const { criarTravaGrupo } = require("../../src/whatsapp/travaGrupo");
const { criarDesligamento } = require("../../src/utils/desligamento");
const { EU, TELEFONE_EQUIPE } = require("../helpers/mensagensWa");

const { criarGrupoFalso, criarFotoFalsa, erroBoomFalso } = baileysFalso;
const TOKEN = "token-back-para-wa";
const tokenOriginal = process.env.WA_BACK_ADMIN_TOKEN;
const GRUPO = "120363000000000001@g.us";
const LID_A = "10000000000041@lid";
const LID_FORA = "10000000000098@lid";
const FONE_A = "5511900000010";
const JID_A = `${FONE_A}@s.whatsapp.net`;
const URL_CDN = "https://pps.whatsapp.net/v/t61/falso.jpg?ccb=1";
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(60, 7)]);
const EU_PARTICIPANTE = { id: "100000000000099@lid", lid: "100000000000099@lid", jid: `${TELEFONE_EQUIPE}@s.whatsapp.net`, admin: "superadmin" };
const PARTICIPANTES = [EU_PARTICIPANTE, { id: LID_A, lid: LID_A, jid: JID_A, admin: null }];

const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "wa-back-foto-"));
const fetchOriginal = globalThis.fetch;

/** @type {ReturnType<typeof criarInstanciaManager>} */
let manager;
let desligamento = criarDesligamento();
let contador = 0;
/** @type {http.Server} */
let servidor;
let baseUrl = "";
/** @type {string[]} */
let linhas = [];
/** @type {{ url: string, init: any }[]} */
let downloads = [];
/** @type {(url: string, init: any) => Promise<Response>} */
let cdn = async () => new Response(JPEG, { status: 200 });
const originais = { log: console.log, error: console.error };
// Prova de "não envia nada e não chama o back": contadores dos stubs e espião de qualquer fetch que não seja para o
// servidor de teste nem para o CDN falso (inclui http para o back). Conferidos no afterEach de TODOS os testes.
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
    registrarControllers(sub, [criarFotoPerfilController(manager, { desligamento, msPrazo: 80 })]);
    sub(req, res, next);
  };
  app.use(delegar);
  servidor = http.createServer(app);
  await new Promise((resolve) => servidor.listen(0, () => resolve(undefined)));
  const endereco = servidor.address();
  assert.ok(endereco && typeof endereco === "object");
  baseUrl = `http://127.0.0.1:${endereco.port}`;
  // Só o endereço do CDN falso é desviado; as chamadas do teste ao servidor local seguem o fetch real.
  globalThis.fetch = /** @type {any} */ (
    (/** @type {any} */ url, /** @type {any} */ init) => {
      if (String(url).startsWith(baseUrl)) return fetchOriginal(url, init);
      if (/^https:\/\/[^/]*\.whatsapp\.net\//.test(String(url))) {
        downloads.push({ url: String(url), init });
        return cdn(String(url), init);
      }
      fetchsDeSaida.push(String(url));
      return Promise.reject(new Error("fetch de saída bloqueado no teste"));
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
  contador += 1;
  linhas = [];
  reportes = 0;
  reportesBase = 0;
  registros = 0;
  fetchsDeSaida = [];
  gruposDoTeste = [];
  downloads = [];
  cdn = async () => new Response(JPEG, { status: 200 });
  const gravar = (/** @type {any[]} */ ...args) => void linhas.push(args.map(String).join(" "));
  console.log = gravar;
  console.error = gravar;
  manager = criarInstanciaManager({
    diretorioSessoes: path.join(raiz, `sessoes-${contador}`),
    caminhoRegistro: path.join(raiz, `cache-${contador}`, "equipes-wa.json"),
    reportarStatus: async () => {
      reportes += 1;
    },
    travaGrupo: criarTravaGrupo(),
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
 * @param {{ urls?: Parameters<typeof criarFotoFalsa>[0] extends infer C ? (C extends { urls?: infer U } ? U : never) : never, participantes?: any[] }} [config]
 */
async function conectarEquipe(cod, { urls = { [JID_A]: URL_CDN, [GRUPO]: URL_CDN, [LID_A]: URL_CDN }, participantes = PARTICIPANTES } = {}) {
  const grupo = criarGrupoFalso({ participantes });
  const foto = criarFotoFalsa({ urls });
  await manager.conectar(cod, "hash-a");
  const socket = /** @type {any} */ (baileysFalso.ultimoSocket());
  fs.writeFileSync(path.join(raiz, `sessoes-${contador}`, cod, "creds.json"), "{}");
  Object.assign(socket, { user: { id: EU.jid, lid: EU.lid } }, grupo.metodos, foto.metodos);
  await socket.emitir("connection.update", { connection: "open" });
  await baileysFalso.drenar();
  gruposDoTeste.push(grupo);
  reportesBase = reportes; // o status da própria conexão é legítimo; o que vem depois, não
  return { grupo, foto, socket };
}

/**
 * @param {unknown} corpo
 * @param {{ token?: string | null, cod?: string }} [opcoes]
 */
function post(corpo, { token = TOKEN, cod = "7" } = {}) {
  return fetchOriginal(`${baseUrl}/equipe/${cod}/foto-perfil`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { "X-Internal-Token": token } : {}) },
    body: JSON.stringify(corpo),
  });
}

const VALIDO = { hash_empresa: "hash-a", jid: JID_A };

test("200 COM_FOTO com o base64 do JPEG; pede o preview ao Baileys e baixa só a URL do CDN, sem seguir redirecionamento", async () => {
  const { foto } = await conectarEquipe("7");
  const resposta = await post(VALIDO);
  assert.equal(resposta.status, 200);
  assert.deepEqual(await resposta.json(), { situacao: "COM_FOTO", mimetype: "image/jpeg", conteudo_base64: JPEG.toString("base64") });
  assert.deepEqual(foto.chamadas.map((c) => [c.jid, c.tipo]), [[JID_A, "preview"]]);
  assert.equal(downloads.length, 1);
  assert.equal(downloads[0]?.url, URL_CDN);
  assert.equal(downloads[0]?.init.redirect, "error");
});

test("foto de grupo e de LID também funcionam (sem grupo_jid)", async () => {
  await conectarEquipe("7");
  for (const jid of [GRUPO, LID_A]) assert.equal(((/** @type {any} */ (await (await post({ ...VALIDO, jid })).json()))).situacao, "COM_FOTO");
});

test("url ausente, Boom 401 ou Boom 404 → 200 SEM_FOTO, sem fetch", async () => {
  const respostas = [undefined, erroBoomFalso("not-authorized", 401), erroBoomFalso("item-not-found", 404)];
  for (const [i, resposta] of respostas.entries()) {
    baileysFalso.limparHistorico();
    await conectarEquipe(`1${i}`, { urls: { [JID_A]: resposta } });
    const r = await post(VALIDO, { cod: `1${i}` });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { situacao: "SEM_FOTO" });
  }
  assert.equal(downloads.length, 0);
});

test("host fora de .whatsapp.net, http, redirecionamento, acima de 100 KB ou conteúdo que não é imagem → SEM_FOTO", async () => {
  const casos = [
    { urls: { [JID_A]: "https://evil.example.com/foto.jpg" }, esperaFetch: false },
    { urls: { [JID_A]: "http://pps.whatsapp.net/foto.jpg" }, esperaFetch: false },
    { urls: { [JID_A]: URL_CDN }, esperaFetch: true, cdn: async () => { throw Object.assign(new TypeError("fetch failed"), { cause: new Error("unexpected redirect") }); } },
    { urls: { [JID_A]: URL_CDN }, esperaFetch: true, cdn: async () => new Response(Buffer.alloc(100 * 1024 + 1, 0xff), { status: 200 }) },
    { urls: { [JID_A]: URL_CDN }, esperaFetch: true, cdn: async () => new Response("<html>nao e imagem</html>", { status: 200 }) },
  ];
  for (const [i, caso] of casos.entries()) {
    baileysFalso.limparHistorico();
    downloads = [];
    cdn = caso.cdn ?? cdn;
    await conectarEquipe(`2${i}`, { urls: caso.urls });
    const r = await post(VALIDO, { cod: `2${i}` });
    assert.equal(r.status, 200, `caso ${i}`);
    assert.deepEqual(await r.json(), { situacao: "SEM_FOTO" }, `caso ${i}`);
    assert.equal(downloads.length, caso.esperaFetch ? 1 : 0, `caso ${i}`);
    cdn = async () => new Response(JPEG, { status: 200 });
  }
});

test("rate-overlimit → 429 LIMITE_WHATSAPP", async () => {
  await conectarEquipe("7", { urls: { [JID_A]: erroBoomFalso("rate-overlimit", 429) } });
  const r = await post(VALIDO);
  assert.equal(r.status, 429);
  assert.deepEqual(await r.json(), { msg: "O WhatsApp limitou as consultas. Tente mais tarde.", codigo: "LIMITE_WHATSAPP" });
  assert.equal(downloads.length, 0);
});

test("prazo do IQ → 504; prazo do download → 504; falha do IQ ou do CDN → 502", async () => {
  await conectarEquipe("7", { urls: { [JID_A]: "travar" } });
  const iq = await post(VALIDO);
  assert.equal(iq.status, 504);
  assert.deepEqual(await iq.json(), { msg: "A consulta da foto não respondeu." });

  baileysFalso.limparHistorico();
  cdn = (_url, init) =>
    new Promise((_, rejeitar) => {
      init.signal.addEventListener("abort", () => rejeitar(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
    });
  await conectarEquipe("8");
  const download = await post(VALIDO, { cod: "8" });
  assert.equal(download.status, 504);
  assert.deepEqual(await download.json(), { msg: "A consulta da foto não respondeu." });

  baileysFalso.limparHistorico();
  await conectarEquipe("9", { urls: { [JID_A]: erroBoomFalso("internal-server-error", 500) } });
  const falha = await post(VALIDO, { cod: "9" });
  assert.equal(falha.status, 502);
  assert.deepEqual(await falha.json(), { msg: "Não foi possível consultar a foto." });
});

test("com grupo_jid: participante no cache → 200; jid fora do cache → 409 FORA_DO_GRUPO, sem IQ de foto", async () => {
  const { foto } = await conectarEquipe("7");
  const dentro = await post({ ...VALIDO, jid: LID_A, grupo_jid: GRUPO });
  assert.equal(dentro.status, 200);
  assert.equal(foto.chamadas.length, 1);
  // pelo telefone, quando o jid pedido não é o do grupo
  assert.equal((await post({ ...VALIDO, grupo_jid: GRUPO })).status, 200);

  foto.chamadas.length = 0;
  const fora = await post({ ...VALIDO, jid: LID_FORA, grupo_jid: GRUPO });
  assert.equal(fora.status, 409);
  assert.deepEqual(await fora.json(), { msg: "Participante não encontrado no grupo.", codigo: "FORA_DO_GRUPO" });
  assert.equal(foto.chamadas.length, 0);
});

test("com grupo_jid que o WhatsApp não devolve → 409 FORA_DO_GRUPO; consulta do grupo com falha → 502; consulta travada → 504", async () => {
  const { socket, foto } = await conectarEquipe("7");
  socket.groupMetadata = async () => {
    throw Object.assign(new Error("forbidden"), { output: { statusCode: 403 } });
  };
  const naoAchou = await post({ ...VALIDO, grupo_jid: GRUPO });
  assert.equal(naoAchou.status, 409);
  assert.equal(((/** @type {any} */ (await naoAchou.json()))).codigo, "FORA_DO_GRUPO");
  assert.equal(foto.chamadas.length, 0);

  const falha = await conectarEquipe("8");
  falha.socket.groupMetadata = async () => {
    throw new Error("falha");
  };
  assert.equal((await post({ ...VALIDO, grupo_jid: GRUPO }, { cod: "8" })).status, 502);

  const demorada = await conectarEquipe("6");
  demorada.socket.groupMetadata = () => new Promise(() => {});
  assert.equal((await post({ ...VALIDO, grupo_jid: GRUPO }, { cod: "6" })).status, 504);

});

test("allowlist: transcricao, nota_interna, explicacao ou chave desconhecida → 400, sem tocar no Baileys", async () => {
  const { foto, grupo } = await conectarEquipe("7");
  for (const extra of [{ transcricao: "x" }, { nota_interna: "x" }, { explicacao: "x" }, { texto: "x" }, { url: URL_CDN }]) {
    const r = await post({ ...VALIDO, ...extra });
    assert.equal(r.status, 400, JSON.stringify(Object.keys(extra)));
    assert.match(String((/** @type {any} */ (await r.json())).msg), /não permitido/i);
  }
  assert.equal(foto.chamadas.length + grupo.chamadas.metadata, 0);
  assert.equal(downloads.length, 0);
});

test("400: jid ou grupo_jid inválido, hash ausente, corpo que não é objeto e código da equipe inválido", async () => {
  const { foto } = await conectarEquipe("7");
  const casos = [
    { ...VALIDO, jid: "abc" },
    { ...VALIDO, jid: 7 },
    { ...VALIDO, jid: `${FONE_A}:3@s.whatsapp.net` },
    { ...VALIDO, jid: "123@s.whatsapp.net" },
    { ...VALIDO, jid: "status@broadcast" },
    { ...VALIDO, grupo_jid: "abc" },
    { ...VALIDO, grupo_jid: LID_A },
    { ...VALIDO, grupo_jid: 7 },
    { ...VALIDO, grupo_jid: null },
    { jid: JID_A },
    { ...VALIDO, hash_empresa: "" },
    [],
  ];
  for (const corpo of casos) assert.equal((await post(corpo)).status, 400, JSON.stringify(corpo));
  assert.equal((await post(VALIDO, { cod: "abc" })).status, 400);
  assert.equal(foto.chamadas.length, 0);
});

test("401 sem token ou token errado; 404 de outro tenant; 409 DESCONECTADA; 503 + Retry-After", async () => {
  const { foto } = await conectarEquipe("7");
  assert.equal((await post(VALIDO, { token: null })).status, 401);
  assert.equal((await post(VALIDO, { token: "errado" })).status, 401);
  const outro = await post({ ...VALIDO, hash_empresa: "hash-b" });
  assert.equal(outro.status, 404);
  assert.deepEqual(await outro.json(), { msg: "Equipe não encontrada." });
  const desconectada = await post(VALIDO, { cod: "99" });
  assert.equal(desconectada.status, 409);
  assert.deepEqual(await desconectada.json(), { msg: "O WhatsApp da equipe não está conectado.", codigo: "DESCONECTADA" });
  desligamento.marcarEncerrando();
  const durante = await post(VALIDO);
  assert.equal(durante.status, 503);
  assert.ok(Number(durante.headers.get("retry-after")) > 0);
  assert.equal(foto.chamadas.length, 0);
});

test("cai no meio (adapter sem socket depois do tenant) → 409 DESCONECTADA", async () => {
  await conectarEquipe("7");
  const adapter = /** @type {any} */ (manager.obter("7"));
  adapter.obterFotoPerfil = async () => {
    throw new (require("../../src/whatsapp/grupoGestao").ErroGrupo)("DESCONECTADA");
  };
  const r = await post(VALIDO);
  assert.equal(r.status, 409);
  assert.equal(((/** @type {any} */ (await r.json()))).codigo, "DESCONECTADA");
});

test("500 sem vazar o erro e 502 quando o adapter não tem o método; nenhum log com URL, jid ou LID", async () => {
  await conectarEquipe("7");
  const adapter = /** @type {any} */ (manager.obter("7"));
  const original = adapter.obterFotoPerfil;
  adapter.obterFotoPerfil = async () => {
    throw new Error(`explodiu ${URL_CDN} ${JID_A} ${LID_A}`);
  };
  const quebrou = await post(VALIDO);
  assert.equal(quebrou.status, 500);
  assert.deepEqual(await quebrou.json(), { msg: "Erro interno ao consultar a foto." });
  adapter.obterFotoPerfil = undefined;
  assert.equal((await post(VALIDO)).status, 502);
  adapter.obterFotoPerfil = original;
  assert.doesNotMatch(linhas.join("\n"), /whatsapp\.net|@lid|@g\.us|\d{10,}|falso\.jpg/);
});

test("nada em disco: nenhuma escrita em fs durante as consultas, e nenhum cache de imagem (duas chamadas = dois downloads)", async () => {
  await conectarEquipe("7");
  /** @type {string[]} */
  const escritas = [];
  const nomes = /** @type {const} */ (["writeFile", "writeFileSync", "appendFile", "appendFileSync", "createWriteStream", "mkdir", "mkdirSync", "rename", "renameSync", "copyFile", "copyFileSync"]);
  const originaisFs = new Map();
  for (const nome of nomes) {
    originaisFs.set(nome, /** @type {any} */ (fs)[nome]);
    /** @type {any} */ (fs)[nome] = (/** @type {any[]} */ ...args) => {
      escritas.push(nome);
      return originaisFs.get(nome)(...args);
    };
  }
  try {
    await post(VALIDO);
    await post(VALIDO);
    await post({ ...VALIDO, jid: LID_FORA, grupo_jid: GRUPO });
  } finally {
    for (const nome of nomes) /** @type {any} */ (fs)[nome] = originaisFs.get(nome);
  }
  assert.deepEqual(escritas, []);
  assert.equal(downloads.length, 2);
});
