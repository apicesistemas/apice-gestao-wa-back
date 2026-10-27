// @ts-check
// POST /equipe/:cod_equipe/grupo/criar (Fase 29, Task 29.1, contrato D2). Manager, adapter e nomeGrupo reais, com o
// socket Baileys falso (tests/helpers/baileysFalso.js), o registro no back trocado por um espião e o relógio da
// pausa injetado. Nenhum número real, nenhuma conexão real. Nada de telefone, JID, LID ou nome do grupo no console.
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
const { criarGrupoController } = require("../../src/http/GrupoController");
const BaileysAdapter = require("../../src/whatsapp/BaileysAdapter");
const { criarInstanciaManager } = require("../../src/whatsapp/instanciaManager");
const { criarTravaGrupo } = require("../../src/whatsapp/travaGrupo");
const { criarDesligamento } = require("../../src/utils/desligamento");
const { mensagemGrupo, EU, TELEFONE_EQUIPE } = require("../helpers/mensagensWa");

const { criarGrupoFalso, conteudoComAddRequest, drenar } = baileysFalso;
const TOKEN = "token-back-para-wa";
const tokenOriginal = process.env.WA_BACK_ADMIN_TOKEN;
const FONE_A = "5511900000010";
const FONE_B = "5511900000011";
const FONE_C = "5511900000012";
const JID_A = `${FONE_A}@s.whatsapp.net`;
const JID_B = `${FONE_B}@s.whatsapp.net`;
const JID_C = `${FONE_C}@s.whatsapp.net`;
const NUMEROS = { [FONE_A]: JID_A, [FONE_B]: JID_B, [FONE_C]: JID_C };
const ID_NOVO = "120363000000000777@g.us";
const NOME = "Suporte Loja Nova";
const EU_PARTICIPANTE = { id: "100000000000099@lid", lid: "100000000000099@lid", jid: `${TELEFONE_EQUIPE}@s.whatsapp.net`, admin: "superadmin" };

const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "wa-back-criar-"));

/** @type {{ mensagem: any }[]} */
let registradas = [];
/** @type {ReturnType<typeof criarInstanciaManager>} */
let manager;
/** @type {ReturnType<typeof criarTravaGrupo>} */
let trava;
let desligamento = criarDesligamento();
/** @type {(segundos: number, sinal?: AbortSignal) => Promise<void>} */
let dormirImpl = async () => {};
/** @type {(evento: string) => void | Promise<void>} */
let ganchoImpl = () => {};
let contador = 0;
/** @type {http.Server} */
let servidor;
let baseUrl = "";

before(async () => {
  process.env.WA_BACK_ADMIN_TOKEN = TOKEN;
  const app = express();
  /** @param {any} req @param {any} res @param {any} next */
  const delegar = (req, res, next) => {
    const sub = express();
    sub.use(express.json());
    registrarControllers(sub, [criarGrupoController(manager, { desligamento, travaGrupo: trava, dormir: (s, sinal) => dormirImpl(s, sinal), msPrazoCriacao: 150 })]);
    sub(req, res, next);
  };
  app.use(delegar);
  servidor = http.createServer(app);
  await new Promise((resolve) => servidor.listen(0, () => resolve(undefined)));
  const endereco = servidor.address();
  assert.ok(endereco && typeof endereco === "object");
  baseUrl = `http://127.0.0.1:${endereco.port}`;
});

after(async () => {
  await new Promise((resolve) => servidor.close(() => resolve(undefined)));
  fs.rmSync(raiz, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  if (tokenOriginal === undefined) delete process.env.WA_BACK_ADMIN_TOKEN;
  else process.env.WA_BACK_ADMIN_TOKEN = tokenOriginal;
});

beforeEach(() => {
  baileysFalso.limparHistorico();
  registradas = [];
  desligamento = criarDesligamento();
  trava = criarTravaGrupo();
  dormirImpl = async () => {};
  ganchoImpl = () => {};
  contador += 1;
  manager = criarInstanciaManager({
    diretorioSessoes: path.join(raiz, `sessoes-${contador}`),
    caminhoRegistro: path.join(raiz, `cache-${contador}`, "equipes-wa.json"),
    reportarStatus: async () => {},
    travaGrupo: trava,
    criarAdapter: (opcoes) =>
      BaileysAdapter.criarAdapter({
        ...opcoes,
        registrarMensagem: async (mensagem) => {
          registradas.push({ mensagem });
        },
      }),
  });
});

/**
 * @param {string} cod
 * @param {Parameters<typeof criarGrupoFalso>[0]} [config]
 */
async function conectarEquipe(cod, config = {}) {
  const grupo = criarGrupoFalso({ participantes: [EU_PARTICIPANTE], numeros: NUMEROS, aoChamar: (e) => ganchoImpl(e), ...config });
  await manager.conectar(cod, "hash-a");
  const socket = /** @type {any} */ (baileysFalso.ultimoSocket());
  fs.writeFileSync(path.join(raiz, `sessoes-${contador}`, cod, "creds.json"), "{}");
  Object.assign(socket, { user: { id: EU.jid, lid: EU.lid } }, grupo.metodos);
  await socket.emitir("connection.update", { connection: "open" });
  return { grupo, socket };
}

/**
 * @param {unknown} corpo
 * @param {{ token?: string | null, cod?: string, rota?: string }} [opcoes]
 */
function post(corpo, { token = TOKEN, cod = "7", rota = "criar" } = {}) {
  return fetch(`${baseUrl}/equipe/${cod}/grupo/${rota}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { "X-Internal-Token": token } : {}) },
    body: JSON.stringify(corpo),
  });
}

const VALIDO = { hash_empresa: "hash-a", nome_grupo: NOME, telefones: [FONE_A], segundos_intervalo: 5 };

/** @param {Response} resposta */
const statusDe = async (resposta) => (/** @type {any} */ (await resposta.json())).participantes.map((/** @type {any} */ p) => p.status);

/** Pausa controlada (depois do groupCreate e entre os adds). */
function pausaControlada() {
  /** @type {() => void} */
  let comecou = () => {};
  const aviso = new Promise((resolve) => {
    comecou = () => resolve(undefined);
  });
  /** @type {(() => void)[]} */
  const liberacoes = [];
  dormirImpl = (_s, sinal) =>
    new Promise((resolve) => {
      liberacoes.push(resolve);
      sinal?.addEventListener("abort", () => resolve(), { once: true });
      comecou();
    });
  return { aviso, liberarTudo: () => liberacoes.forEach((l) => l()) };
}

test("200 devolve chat_jid, nome aparado e os participantes; groupCreate uma vez com um único jid (o real) e os demais por add", async () => {
  const real = "551100000010@s.whatsapp.net";
  const { grupo } = await conectarEquipe("7", { numeros: { ...NUMEROS, [FONE_A]: real }, participantes: [EU_PARTICIPANTE, { id: real }] });
  const resposta = await post({ ...VALIDO, nome_grupo: `  ${NOME}  `, telefones: [FONE_A, FONE_B, FONE_C] });
  assert.equal(resposta.status, 200);
  assert.deepEqual(await resposta.json(), {
    chat_jid: ID_NOVO,
    nome_grupo: NOME,
    participantes: [
      { telefone: FONE_A, status: "ADICIONADO", convite_enviado: false },
      { telefone: FONE_B, status: "ADICIONADO", convite_enviado: false },
      { telefone: FONE_C, status: "ADICIONADO", convite_enviado: false },
    ],
  });
  assert.deepEqual(grupo.chamadas.criacoes, [{ subject: NOME, participantes: [real] }]);
  assert.deepEqual(grupo.chamadas.add.map((c) => [c.jid, c.alvos]), [[ID_NOVO, [JID_B]], [ID_NOVO, [JID_C]]]);
});

test("nenhum telefone com WhatsApp → 409 SEM_PARTICIPANTE_VALIDO com os status, sem groupCreate e com a trava liberada", async () => {
  const { grupo } = await conectarEquipe("7", { numeros: {} });
  const resposta = await post({ ...VALIDO, telefones: [FONE_A, FONE_B] });
  assert.equal(resposta.status, 409);
  assert.deepEqual(await resposta.json(), {
    msg: "Nenhum dos telefones informados tem WhatsApp. O grupo não foi criado.",
    codigo: "SEM_PARTICIPANTE_VALIDO",
    participantes: [
      { telefone: FONE_A, status: "SEM_WHATSAPP", convite_enviado: false },
      { telefone: FONE_B, status: "SEM_WHATSAPP", convite_enviado: false },
    ],
  });
  assert.equal(grupo.chamadas.criacoes.length, 0);
  assert.equal(trava.ocupada("7"), false);
});

test("erro ou prazo esgotado do groupCreate → 504 'Criação do grupo não confirmada.', uma só tentativa", async () => {
  for (const criacao of [new Error("falha"), /** @type {const} */ ("travar")]) {
    baileysFalso.limparHistorico();
    contador += 1;
    manager = criarInstanciaManager({
      diretorioSessoes: path.join(raiz, `sessoes-${contador}`),
      caminhoRegistro: path.join(raiz, `cache-${contador}`, "equipes-wa.json"),
      reportarStatus: async () => {},
      travaGrupo: trava,
    });
    const { grupo } = await conectarEquipe("7", { criacao });
    const resposta = await post({ ...VALIDO, telefones: [FONE_A, FONE_B] });
    assert.equal(resposta.status, 504);
    assert.deepEqual(await resposta.json(), { msg: "Criação do grupo não confirmada." });
    assert.equal(grupo.chamadas.criacoes.length, 1, "nunca repete o groupCreate");
    assert.equal(grupo.chamadas.add.length, 0);
    assert.equal(trava.ocupada("7"), false);
  }
});

test("1º ausente na confirmação → CONVITE_NECESSARIO sem convite; os demais seguem o ritmo e o convite da adição", async () => {
  const adds = { [JID_B]: { status: "403", content: conteudoComAddRequest(JID_B, "CODIGO-FALSO", 1760000000) } };
  const { grupo } = await conectarEquipe("7", { adds, participantes: [EU_PARTICIPANTE] });
  const resposta = await post({ ...VALIDO, telefones: [FONE_A, FONE_B, FONE_C], convite: { texto: "Convite" } });
  assert.equal(resposta.status, 200);
  assert.deepEqual((/** @type {any} */ (await resposta.json())).participantes, [
    { telefone: FONE_A, status: "CONVITE_NECESSARIO", convite_enviado: false },
    { telefone: FONE_B, status: "CONVITE_NECESSARIO", convite_enviado: true },
    { telefone: FONE_C, status: "ADICIONADO", convite_enviado: false },
  ]);
  assert.equal(/** @type {any} */ (grupo.chamadas.envios[0]).jid, JID_B);
});

test("falha no groupMetadata depois da criação → ainda 200 com o chat_jid (1º FALHA, restante NAO_PROCESSADO)", async () => {
  await conectarEquipe("7", { falhaMetadata: true });
  const resposta = await post({ ...VALIDO, telefones: [FONE_A, FONE_B] });
  assert.equal(resposta.status, 200);
  const corpo = /** @type {any} */ (await resposta.json());
  assert.equal(corpo.chat_jid, ID_NOVO);
  assert.deepEqual(corpo.participantes.map((/** @type {any} */ p) => p.status), ["FALHA", "NAO_PROCESSADO"]);
});

test("falha no add dos demais → 200 com FALHA no telefone e o laço segue; 429 para o laço", async () => {
  const limite = Object.assign(new Error("x"), { data: 429, output: { statusCode: 500 } });
  await conectarEquipe("7", { adds: { [JID_B]: new Error("rede") }, participantes: [EU_PARTICIPANTE, { id: JID_A }] });
  assert.deepEqual(await statusDe(await post({ ...VALIDO, telefones: [FONE_A, FONE_B, FONE_C] })), ["ADICIONADO", "FALHA", "ADICIONADO"]);
  baileysFalso.limparHistorico();
  trava = criarTravaGrupo();
  contador += 1;
  manager = criarInstanciaManager({
    diretorioSessoes: path.join(raiz, `sessoes-${contador}`),
    caminhoRegistro: path.join(raiz, `cache-${contador}`, "equipes-wa.json"),
    reportarStatus: async () => {},
    travaGrupo: trava,
  });
  await conectarEquipe("7", { adds: { [JID_B]: limite }, participantes: [EU_PARTICIPANTE, { id: JID_A }] });
  assert.deepEqual(await statusDe(await post({ ...VALIDO, telefones: [FONE_A, FONE_B, FONE_C] })), ["ADICIONADO", "FALHA", "NAO_PROCESSADO"]);
});

test("remover, desconectar e desligamento depois da criação → ainda 200 com o chat_jid (restante NAO_PROCESSADO)", async () => {
  /** @type {(() => Promise<unknown>)[]} */
  const acoes = [() => manager.remover(7, "hash-a"), () => manager.desconectar(7, "hash-a"), async () => desligamento.marcarEncerrando()];
  for (const acao of acoes) {
    baileysFalso.limparHistorico();
    trava = criarTravaGrupo();
    desligamento = criarDesligamento();
    contador += 1;
    manager = criarInstanciaManager({
      diretorioSessoes: path.join(raiz, `sessoes-${contador}`),
      caminhoRegistro: path.join(raiz, `cache-${contador}`, "equipes-wa.json"),
      reportarStatus: async () => {},
      travaGrupo: trava,
    });
    const { grupo } = await conectarEquipe("7", { participantes: [EU_PARTICIPANTE, { id: JID_A }] });
    const { aviso } = pausaControlada();
    const chamada = post({ ...VALIDO, telefones: [FONE_A, FONE_B, FONE_C] });
    await aviso; // pausa logo depois do groupCreate
    await acao();
    const resposta = await chamada;
    assert.equal(resposta.status, 200);
    const corpo = /** @type {any} */ (await resposta.json());
    assert.equal(corpo.chat_jid, ID_NOVO);
    assert.deepEqual(corpo.participantes.map((/** @type {any} */ p) => p.status), ["ADICIONADO", "NAO_PROCESSADO", "NAO_PROCESSADO"]);
    assert.equal(grupo.chamadas.criacoes.length, 1);
    assert.equal(grupo.chamadas.add.length, 0);
    assert.equal(trava.ocupada("7"), false);
  }
});

test("o back fecha a conexão depois da criação: o laço para, o groupCreate não se repete e a trava cai", async () => {
  const { grupo } = await conectarEquipe("7", { participantes: [EU_PARTICIPANTE, { id: JID_A }] });
  const { aviso } = pausaControlada();
  const cliente = new AbortController();
  const chamada = fetch(`${baseUrl}/equipe/7/grupo/criar`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Internal-Token": TOKEN },
    body: JSON.stringify({ ...VALIDO, telefones: [FONE_A, FONE_B, FONE_C] }),
    signal: cliente.signal,
  });
  await aviso;
  cliente.abort();
  await assert.rejects(chamada);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(trava.ocupada("7"), false);
  assert.equal(grupo.chamadas.criacoes.length, 1);
  assert.equal(grupo.chamadas.add.length, 0);
});

test("o nome entra no cache: a primeira mensagem do grupo criado chega ao back com nome_chat, sem consultar o grupo de novo", async () => {
  const { grupo, socket } = await conectarEquipe("7", { falhaMetadata: true });
  await post(VALIDO);
  const consultas = grupo.chamadas.metadata;
  await socket.emitir("messages.upsert", { messages: [mensagemGrupo({ conversation: "oi" }, { key: { remoteJid: ID_NOVO } })], type: "notify" });
  await drenar();
  assert.equal(registradas.length, 1);
  assert.equal(registradas[0]?.mensagem.nome_chat, NOME);
  assert.equal(grupo.chamadas.metadata, consultas);
});

const MSG_NOME = "Informe o nome do grupo com até 100 caracteres, sem quebra de linha.";

test("400 (mesmo texto): nome vazio, só espaços ou invisíveis, acima de 100, com quebra de linha/controle ou não texto; 100 aceito", async () => {
  const { grupo } = await conectarEquipe("7");
  const invalidos = [
    "",
    "   ",
    "x".repeat(101),
    `  ${"x".repeat(101)}  `,
    "Suporte\nLoja",
    "Suporte\r\nLoja",
    "Suporte\n",
    "\tSuporte",
    "Suporte\u0000Loja",
    "Suporte\u001FLoja",
    "Suporte\u007FLoja",
    "\u200B\u200B",
    " \uFEFF \u200C\u200D ",
    5,
    null,
    undefined,
  ];
  for (const nome_grupo of invalidos) {
    const resposta = await post({ ...VALIDO, nome_grupo });
    assert.equal(resposta.status, 400, JSON.stringify(nome_grupo)?.slice(0, 20));
    assert.deepEqual(await resposta.json(), { msg: MSG_NOME });
  }
  assert.equal(grupo.chamadas.criacoes.length + grupo.chamadas.onWhatsApp.length, 0);
  assert.equal((await post({ ...VALIDO, nome_grupo: "x".repeat(100) })).status, 200);
  assert.equal(grupo.chamadas.criacoes[0]?.subject, "x".repeat(100));
});

test("desligamento antes de criar → 503 + Retry-After (nada criado); desconectar antes de criar segue 409 DESCONECTADA", async () => {
  for (const acao of ["desligamento", "desconectar"]) {
    baileysFalso.limparHistorico();
    trava = criarTravaGrupo();
    desligamento = criarDesligamento();
    contador += 1;
    manager = criarInstanciaManager({
      diretorioSessoes: path.join(raiz, `sessoes-${contador}`),
      caminhoRegistro: path.join(raiz, `cache-${contador}`, "equipes-wa.json"),
      reportarStatus: async () => {},
      travaGrupo: trava,
    });
    const { grupo } = await conectarEquipe("7");
    /** @type {() => void} */
    let liberar = () => {};
    const porta = new Promise((resolve) => {
      liberar = () => resolve(undefined);
    });
    /** @type {() => void} */
    let comecou = () => {};
    const aviso = new Promise((resolve) => {
      comecou = () => resolve(undefined);
    });
    ganchoImpl = async (evento) => {
      if (evento !== "onWhatsApp") return;
      comecou();
      await porta;
    };
    const chamada = post(VALIDO);
    await aviso;
    if (acao === "desligamento") desligamento.marcarEncerrando();
    else await manager.desconectar(7, "hash-a");
    liberar();
    const resposta = await chamada;
    if (acao === "desligamento") {
      assert.equal(resposta.status, 503);
      assert.ok(Number(resposta.headers.get("retry-after")) > 0);
      assert.deepEqual(await resposta.json(), { msg: "Serviço de WhatsApp reiniciando. Tente novamente em instantes." });
    } else {
      assert.equal(resposta.status, 409);
      assert.equal((/** @type {any} */ (await resposta.json())).codigo, "DESCONECTADA");
    }
    assert.equal(grupo.chamadas.criacoes.length, 0, "nada foi criado");
    assert.equal(trava.ocupada("7"), false);
  }
});

test("400: telefones, intervalo, convite, hash e allowlist (transcricao, nota_interna, explicacao, chat_jid, desconhecida)", async () => {
  const { grupo } = await conectarEquipe("7");
  /** @type {[unknown, string][]} */
  const casos = [
    [{ ...VALIDO, telefones: [] }, "Informe de 1 a 50 telefones."],
    [{ ...VALIDO, telefones: ["11900000010"] }, "Telefone inválido: confira o DDD e o número."],
    [{ ...VALIDO, segundos_intervalo: -1 }, "Informe o intervalo entre as adições, em segundos."],
    [{ ...VALIDO, convite: { texto: "" } }, "Convite inválido."],
    [{ ...VALIDO, hash_empresa: undefined }, "Informe o hash_empresa da equipe."],
    [[1], "Corpo da requisição inválido."],
  ];
  for (const [corpo, msg] of casos) {
    const resposta = await post(corpo);
    assert.equal(resposta.status, 400, msg);
    assert.deepEqual(await resposta.json(), { msg });
  }
  for (const campo of ["transcricao", "nota_interna", "explicacao", "chat_jid", "qualquer_outra"]) {
    const resposta = await post({ ...VALIDO, [campo]: "texto interno" });
    assert.equal(resposta.status, 400, campo);
    assert.match((/** @type {any} */ (await resposta.json())).msg, /^Campo não permitido na criação: /);
  }
  assert.equal((await post(VALIDO, { cod: "abc" })).status, 400);
  assert.equal(grupo.chamadas.criacoes.length + grupo.chamadas.onWhatsApp.length, 0);
});

test("401 sem token ou com token errado; 404 de outro tenant; 409 DESCONECTADA; 503 + Retry-After", async () => {
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
  assert.equal(grupo.chamadas.onWhatsApp.length + grupo.chamadas.criacoes.length, 0);
});

test("409 OCUPADA com criação ou adição em andamento na mesma equipe (e a trava é a mesma da adição)", async () => {
  const { grupo } = await conectarEquipe("7", { participantes: [EU_PARTICIPANTE, { id: JID_A }] });
  /** @type {() => void} */
  let liberar = () => {};
  const porta = new Promise((resolve) => {
    liberar = () => resolve(undefined);
  });
  /** @type {() => void} */
  let comecou = () => {};
  const aviso = new Promise((resolve) => {
    comecou = () => resolve(undefined);
  });
  ganchoImpl = async (evento) => {
    if (evento !== "groupCreate") return;
    comecou();
    await porta;
  };
  const primeira = post(VALIDO);
  await aviso;
  for (const rota of ["criar", "participantes/adicionar"]) {
    const corpo = rota === "criar" ? VALIDO : { hash_empresa: "hash-a", chat_jid: ID_NOVO, telefones: [FONE_B], segundos_intervalo: 0 };
    const r = await post(corpo, { rota });
    assert.equal(r.status, 409, rota);
    assert.deepEqual(await r.json(), { msg: "Outra alteração de grupo desta equipe está em andamento.", codigo: "OCUPADA" });
  }
  liberar();
  assert.equal((await primeira).status, 200);
  assert.equal(grupo.chamadas.criacoes.length, 1);
  assert.equal(trava.ocupada("7"), false);
});

test("500 não vaza o erro; adapter sem criarGrupo responde 502", async () => {
  await conectarEquipe("7");
  const adapter = /** @type {any} */ (manager.obter(7));
  const original = adapter.criarGrupo;
  adapter.criarGrupo = async () => {
    throw new Error(`segredo ${FONE_A} ${JID_A} ${NOME}`);
  };
  const originalError = console.error;
  console.error = () => {};
  /** @type {Response | undefined} */
  let resposta;
  try {
    resposta = await post(VALIDO);
  } finally {
    console.error = originalError;
  }
  assert.equal(resposta?.status, 500);
  assert.deepEqual(await resposta?.json(), { msg: "Erro interno ao criar o grupo." });
  assert.equal(trava.ocupada("7"), false);
  adapter.criarGrupo = undefined;
  assert.equal((await post(VALIDO)).status, 502);
  adapter.criarGrupo = original;
});

test("o console da rota (sucesso, convite, falhas, 504, 409) não leva telefone, JID, LID nem o nome do grupo", async () => {
  await conectarEquipe("7", {
    adds: { [JID_B]: { status: "403", content: conteudoComAddRequest(JID_B, "CODIGO-FALSO", 1760000000) }, [JID_C]: new Error(`erro ${FONE_C} ${NOME}`) },
    participantes: [EU_PARTICIPANTE],
  });
  /** @type {string[]} */
  const linhas = [];
  const originais = { log: console.log, error: console.error };
  const gravar = (/** @type {any[]} */ ...args) => void linhas.push(args.map(String).join(" "));
  console.log = gravar;
  console.error = gravar;
  try {
    await post({ ...VALIDO, telefones: [FONE_A, FONE_B, FONE_C], convite: { texto: "Convite" } });
    await post({ ...VALIDO, hash_empresa: "hash-b" });
  } finally {
    console.log = originais.log;
    console.error = originais.error;
  }
  assert.ok(linhas.length > 0);
  assert.doesNotMatch(linhas.join("\n"), new RegExp(`\\d{10,}|@lid|@s\\.whatsapp\\.net|@g\\.us|CODIGO-FALSO|${NOME}`));
  assert.match(linhas.join("\n"), /equipe 7/);
});
