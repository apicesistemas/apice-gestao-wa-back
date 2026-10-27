// @ts-check
// POST /equipe/:cod_equipe/grupo/participantes/adicionar (Fase 28, Task 28.1, contrato D1). Manager, adapter e
// nomeGrupo reais, com o socket Baileys falso (tests/helpers/baileysFalso.js), o registro no back trocado por um
// espião e o relógio da pausa injetado. Nenhum número real, nenhuma conexão real. O console é capturado onde
// importa: nada de telefone, JID, LID ou código de convite nele.
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
const { criarDesligamento, MSG_REINICIANDO } = require("../../src/utils/desligamento");
const { mensagemWa, JID_GRUPO, EU, TELEFONE_EQUIPE } = require("../helpers/mensagensWa");

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
const EU_PARTICIPANTE = { id: "100000000000099@lid", lid: "100000000000099@lid", jid: `${TELEFONE_EQUIPE}@s.whatsapp.net`, admin: "admin" };
const ADMIN_FORA = { ...EU_PARTICIPANTE, admin: null };
const OUTRO = { id: "100000000000004@lid", lid: "100000000000004@lid", admin: null };

const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "wa-back-adicionar-"));

/** @type {{ mensagem: any }[]} */
let registradas = [];
/** @type {ReturnType<typeof criarInstanciaManager>} */
let manager;
/** @type {ReturnType<typeof criarTravaGrupo>} */
let trava;
let desligamento = criarDesligamento();
/** @type {(segundos: number, sinal?: AbortSignal) => Promise<void>} */
let dormirImpl = async () => {};
let contador = 0;
/** @type {(evento: string) => void | Promise<void>} gancho das chamadas ao socket falso (os testes seguram o onWhatsApp aqui) */
let ganchoImpl = () => {};
/** @type {http.Server} */
let servidor;
let baseUrl = "";

before(async () => {
  process.env.WA_BACK_ADMIN_TOKEN = TOKEN;
  const app = express();
  app.use(express.json());
  // Controller montado por requisição: usa o manager/trava/desligamento do teste corrente.
  /** @param {any} req @param {any} res @param {any} next */
  const delegar = (req, res, next) => {
    const sub = express();
    sub.use(express.json());
    registrarControllers(sub, [criarGrupoController(manager, { desligamento, travaGrupo: trava, dormir: (s, sinal) => dormirImpl(s, sinal) })]);
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
 * Conecta a equipe (pareada, CONECTADO) e acopla os métodos de grupo falsos ao socket dela.
 * @param {string} cod
 * @param {Parameters<typeof criarGrupoFalso>[0]} [config]
 * @param {string} [hash]
 */
async function conectarEquipe(cod, config = {}, hash = "hash-a") {
  const grupo = criarGrupoFalso({ participantes: [EU_PARTICIPANTE, OUTRO], numeros: NUMEROS, aoChamar: (e) => ganchoImpl(e), ...config });
  await manager.conectar(cod, hash);
  const socket = /** @type {any} */ (baileysFalso.ultimoSocket());
  fs.writeFileSync(path.join(raiz, `sessoes-${contador}`, cod, "creds.json"), "{}");
  Object.assign(socket, { user: { id: EU.jid, lid: EU.lid } }, grupo.metodos);
  await socket.emitir("connection.update", { connection: "open" });
  return { grupo, socket };
}

/**
 * @param {unknown} corpo
 * @param {{ token?: string | null, cod?: string }} [opcoes]
 */
function post(corpo, { token = TOKEN, cod = "7" } = {}) {
  return fetch(`${baseUrl}/equipe/${cod}/grupo/participantes/adicionar`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { "X-Internal-Token": token } : {}) },
    body: JSON.stringify(corpo),
  });
}

const VALIDO = { hash_empresa: "hash-a", chat_jid: JID_GRUPO, telefones: [FONE_A], segundos_intervalo: 5 };

/** Pausa que só termina quando o teste manda (ou o sinal aborta); avisa quando a primeira pausa começou. */
function pausaControlada() {
  /** @type {() => void} */
  let comecou = () => {};
  const aviso = new Promise((resolve) => {
    comecou = () => resolve(undefined);
  });
  /** @type {(() => void)[]} */
  const liberacoes = [];
  dormirImpl = (_segundos, sinal) =>
    new Promise((resolve) => {
      liberacoes.push(resolve);
      sinal?.addEventListener("abort", () => resolve(), { once: true });
      comecou();
    });
  return { aviso, liberarTudo: () => liberacoes.forEach((l) => l()) };
}

test("200 devolve os participantes na ordem da entrada e o add usa o jid do onWhatsApp", async () => {
  const real = "551100000010@s.whatsapp.net";
  const { grupo } = await conectarEquipe("7", { numeros: { [FONE_A]: real, [FONE_C]: JID_C } });
  const resposta = await post({ ...VALIDO, telefones: [FONE_A, FONE_B, FONE_C] });
  assert.equal(resposta.status, 200);
  assert.deepEqual(await resposta.json(), {
    participantes: [
      { telefone: FONE_A, status: "ADICIONADO", convite_enviado: false },
      { telefone: FONE_B, status: "SEM_WHATSAPP", convite_enviado: false },
      { telefone: FONE_C, status: "ADICIONADO", convite_enviado: false },
    ],
  });
  assert.deepEqual(grupo.chamadas.add.map((c) => c.alvos), [[real], [JID_C]]);
});

test("no fim o cache do grupo é esquecido: a chamada seguinte consulta o groupMetadata de novo", async () => {
  const { grupo } = await conectarEquipe("7");
  await post(VALIDO);
  const depoisDaPrimeira = grupo.chamadas.metadata;
  await post({ ...VALIDO, telefones: [FONE_B] });
  assert.ok(grupo.chamadas.metadata > depoisDaPrimeira);
});

test("403 com add_request e convite no corpo → convite v4 privado; o eco do convite não gera mensagem-recebida", async () => {
  const { grupo, socket } = await conectarEquipe("7", {
    subject: "Suporte Loja Centro",
    adds: { [JID_A]: { status: "403", content: conteudoComAddRequest(JID_A, "CODIGO-FALSO", 1760000000) } },
  });
  const resposta = await post({ ...VALIDO, convite: { texto: "Convite para o grupo de suporte." } });
  assert.equal(resposta.status, 200);
  assert.deepEqual(await resposta.json(), { participantes: [{ telefone: FONE_A, status: "CONVITE_NECESSARIO", convite_enviado: true }] });
  const envio = /** @type {any} */ (grupo.chamadas.envios[0]);
  assert.equal(envio.jid, JID_A);
  assert.deepEqual(envio.conteudo.groupInvite, {
    jid: JID_GRUPO,
    name: "Suporte Loja Centro",
    caption: "Convite para o grupo de suporte.",
    inviteCode: "CODIGO-FALSO",
    inviteExpiration: 1760000000,
  });

  // O eco do que o CRM enviou chega pelo messages.upsert com o mesmo id: não vira registro de APARELHO.
  const eco = mensagemWa({ conversation: "eco do convite" }, { key: { remoteJid: JID_A, fromMe: true, id: envio.opcoes.messageId } });
  await socket.emitir("messages.upsert", { messages: [eco], type: "notify" });
  await drenar();
  assert.equal(registradas.length, 0);
  // Prova de que a marcação é o que impede o registro: o mesmo texto com outro id é registrado como APARELHO.
  const deAparelho = mensagemWa({ conversation: "do celular" }, { key: { remoteJid: JID_A, fromMe: true } });
  await socket.emitir("messages.upsert", { messages: [deAparelho], type: "notify" });
  await drenar();
  assert.equal(registradas.length, 1);
});

test("sem `convite` no corpo o 403 não convida", async () => {
  const { grupo } = await conectarEquipe("7", { adds: { [JID_A]: { status: "403", content: conteudoComAddRequest(JID_A, "CODIGO-FALSO", 1760000000) } } });
  const resposta = await post(VALIDO);
  assert.deepEqual(await resposta.json(), { participantes: [{ telefone: FONE_A, status: "CONVITE_NECESSARIO", convite_enviado: false }] });
  assert.equal(grupo.chamadas.envios.length, 0);
});

test("segunda chamada da mesma equipe durante a primeira → 409 OCUPADA; outra equipe não é afetada; a trava é liberada no fim", async () => {
  await conectarEquipe("7");
  const outra = await conectarEquipe("8");
  const { aviso, liberarTudo } = pausaControlada();

  const primeira = post({ ...VALIDO, telefones: [FONE_A, FONE_B] });
  await aviso;
  const segunda = await post(VALIDO);
  assert.equal(segunda.status, 409);
  assert.deepEqual(await segunda.json(), { msg: "Outra alteração de grupo desta equipe está em andamento.", codigo: "OCUPADA" });

  const daOutra = post({ ...VALIDO, telefones: [FONE_A, FONE_B] }, { cod: "8" });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(trava.ocupada("8"), true, "a equipe 8 entrou na própria trava, sem depender da 7");
  assert.equal(outra.grupo.chamadas.add.length, 1);

  dormirImpl = async () => {};
  liberarTudo();
  assert.equal((await primeira).status, 200);
  assert.equal((await daOutra).status, 200);
  dormirImpl = async () => {};
  assert.equal((await post(VALIDO)).status, 200, "a trava foi liberada");
});

test("equipe ocupada pelo conectar/desconectar/remover (equipeOcupada) → 409 OCUPADA antes de qualquer consulta", async () => {
  const { grupo } = await conectarEquipe("7");
  const original = manager.equipeOcupada;
  manager.equipeOcupada = () => true;
  try {
    const resposta = await post(VALIDO);
    assert.equal(resposta.status, 409);
    assert.deepEqual(await resposta.json(), { msg: "Outra alteração de grupo desta equipe está em andamento.", codigo: "OCUPADA" });
    assert.equal(grupo.chamadas.onWhatsApp.length, 0);
  } finally {
    manager.equipeOcupada = original;
  }
});

test("a trava é liberada depois de exceção na operação (a chamada seguinte não recebe OCUPADA)", async () => {
  const { socket } = await conectarEquipe("7");
  const metadataOriginal = socket.groupMetadata;
  socket.groupMetadata = async () => Promise.reject(new Error("falha de rede"));
  const falha = await post(VALIDO);
  assert.equal(falha.status, 502);
  assert.equal(trava.ocupada("7"), false);
  socket.groupMetadata = metadataOriginal;
  // (a falha do grupo fica em cache por 60 s no nomeGrupo; outro grupo da mesma equipe segue normal)
  assert.equal((await post({ ...VALIDO, chat_jid: "120363000000000002@g.us" })).status, 200);
});

test("sem admin e sem memberAddMode → 409 NAO_ADMIN, sem IQ; com memberAddMode a equipe comum pode adicionar", async () => {
  const sem = await conectarEquipe("7", { participantes: [ADMIN_FORA, OUTRO], memberAddMode: false });
  const resposta = await post(VALIDO);
  assert.equal(resposta.status, 409);
  assert.deepEqual(await resposta.json(), { msg: "O número da equipe não é administrador deste grupo.", codigo: "NAO_ADMIN" });
  assert.equal(sem.grupo.chamadas.onWhatsApp.length + sem.grupo.chamadas.add.length, 0);

  const com = await conectarEquipe("8", { participantes: [ADMIN_FORA, OUTRO], memberAddMode: true });
  assert.equal((await post(VALIDO, { cod: "8" })).status, 200);
  assert.equal(com.grupo.chamadas.add.length, 1);
});

test("número fora do grupo → 404 'Grupo não encontrado.'; consulta travada → 504; falha → 502", async () => {
  await conectarEquipe("7", { participantes: [OUTRO] });
  const fora = await post(VALIDO);
  assert.equal(fora.status, 404);
  assert.deepEqual(await fora.json(), { msg: "Grupo não encontrado." });

  const { socket } = await conectarEquipe("8");
  socket.groupMetadata = () => Promise.reject(Object.assign(new Error("forbidden"), { output: { statusCode: 403 } }));
  assert.equal((await post(VALIDO, { cod: "8" })).status, 404);
});

test("remover durante a adição: o laço para, o restante sai NAO_PROCESSADO, a trava cai e a seguinte recebe 409 DESCONECTADA (nunca OCUPADA)", async () => {
  const { grupo } = await conectarEquipe("7");
  const { aviso } = pausaControlada();
  const primeira = post({ ...VALIDO, telefones: [FONE_A, FONE_B, FONE_C] });
  await aviso;

  await manager.remover(7, "hash-a");

  const resposta = await primeira;
  assert.equal(resposta.status, 200);
  assert.deepEqual((/** @type {any} */ (await resposta.json())).participantes.map((/** @type {any} */ p) => p.status), ["ADICIONADO", "NAO_PROCESSADO", "NAO_PROCESSADO"]);
  assert.equal(grupo.chamadas.add.length, 1);
  assert.equal(trava.ocupada("7"), false);
  const seguinte = await post(VALIDO);
  assert.equal(seguinte.status, 409);
  assert.deepEqual(await seguinte.json(), { msg: "O WhatsApp da equipe não está conectado.", codigo: "DESCONECTADA" });
});

test("desconectar durante a adição: o laço para, o restante sai NAO_PROCESSADO e a seguinte recebe 409 DESCONECTADA", async () => {
  await conectarEquipe("7");
  const { aviso } = pausaControlada();
  const primeira = post({ ...VALIDO, telefones: [FONE_A, FONE_B] });
  await aviso;

  await manager.desconectar(7, "hash-a");

  const resposta = await primeira;
  assert.equal(resposta.status, 200);
  assert.deepEqual((/** @type {any} */ (await resposta.json())).participantes.map((/** @type {any} */ p) => p.status), ["ADICIONADO", "NAO_PROCESSADO"]);
  const seguinte = await post(VALIDO);
  assert.equal(seguinte.status, 409);
  assert.equal((/** @type {any} */ (await seguinte.json())).codigo, "DESCONECTADA");
});

test("desligamento gracioso no meio: a pausa é interrompida, o restante sai NAO_PROCESSADO e as novas chamadas recebem 503", async () => {
  await conectarEquipe("7");
  const { aviso } = pausaControlada();
  const primeira = post({ ...VALIDO, telefones: [FONE_A, FONE_B, FONE_C] });
  await aviso;

  desligamento.marcarEncerrando();

  const resposta = await primeira;
  assert.equal(resposta.status, 200);
  assert.deepEqual((/** @type {any} */ (await resposta.json())).participantes.map((/** @type {any} */ p) => p.status), ["ADICIONADO", "NAO_PROCESSADO", "NAO_PROCESSADO"]);
  await desligamento.aguardarEmAndamento(); // a resposta cabe no teto: nada fica em andamento
  const nova = await post(VALIDO);
  assert.equal(nova.status, 503);
  assert.deepEqual(await nova.json(), { msg: MSG_REINICIANDO });
  assert.ok(Number(nova.headers.get("retry-after")) > 0);
});

test("allowlist: transcricao, nota_interna, explicacao ou chave desconhecida → 400 sem tocar no Baileys", async () => {
  const { grupo } = await conectarEquipe("7");
  for (const campo of ["transcricao", "nota_interna", "explicacao", "especificacao", "qualquer_outra", "cod_empresa"]) {
    const resposta = await post({ ...VALIDO, [campo]: "texto interno" });
    assert.equal(resposta.status, 400, campo);
    const corpo = /** @type {any} */ (await resposta.json());
    assert.match(corpo.msg, /^Campo não permitido na adição: /);
  }
  const dentroDoConvite = await post({ ...VALIDO, convite: { texto: "Convite", transcricao: "x" } });
  assert.equal(dentroDoConvite.status, 400);
  assert.equal(grupo.chamadas.metadata + grupo.chamadas.onWhatsApp.length + grupo.chamadas.add.length + grupo.chamadas.envios.length, 0);
});

test("400: telefones, grupo, intervalo, convite e corpo inválidos (mesmo com a equipe desconectada)", async () => {
  const { grupo } = await conectarEquipe("7");
  /** @type {[unknown, string][]} */
  const casos = [
    [{ ...VALIDO, telefones: [] }, "Informe de 1 a 50 telefones."],
    [{ ...VALIDO, telefones: Array.from({ length: 51 }, (_, i) => `55119000000${String(10 + (i % 80)).padStart(2, "0")}`) }, "Informe de 1 a 50 telefones."],
    [{ ...VALIDO, telefones: "5511900000010" }, "Informe de 1 a 50 telefones."],
    [{ ...VALIDO, telefones: ["11900000010"] }, "Telefone inválido: confira o DDD e o número."],
    [{ ...VALIDO, telefones: ["55119000001"] }, "Telefone inválido: confira o DDD e o número."],
    [{ ...VALIDO, telefones: [5511900000010] }, "Telefone inválido: confira o DDD e o número."],
    [{ ...VALIDO, chat_jid: "5511900000001@s.whatsapp.net" }, "Grupo inválido."],
    [{ ...VALIDO, chat_jid: undefined }, "Grupo inválido."],
    [{ ...VALIDO, segundos_intervalo: -1 }, "Informe o intervalo entre as adições, em segundos."],
    [{ ...VALIDO, segundos_intervalo: 2.5 }, "Informe o intervalo entre as adições, em segundos."],
    [{ ...VALIDO, segundos_intervalo: "5" }, "Informe o intervalo entre as adições, em segundos."],
    [{ ...VALIDO, segundos_intervalo: undefined }, "Informe o intervalo entre as adições, em segundos."],
    [{ ...VALIDO, convite: {} }, "Convite inválido."],
    [{ ...VALIDO, convite: { texto: "" } }, "Convite inválido."],
    [{ ...VALIDO, convite: { texto: "x".repeat(501) } }, "Convite inválido."],
    [{ ...VALIDO, convite: { texto: 5 } }, "Convite inválido."],
    [{ ...VALIDO, convite: "texto" }, "Convite inválido."],
    [{ ...VALIDO, convite: null }, "Convite inválido."],
    [{ ...VALIDO, hash_empresa: undefined }, "Informe o hash_empresa da equipe."],
    [[1, 2], "Corpo da requisição inválido."],
  ];
  for (const [corpo, msg] of casos) {
    const resposta = await post(corpo);
    assert.equal(resposta.status, 400, msg);
    assert.deepEqual(await resposta.json(), { msg });
  }
  assert.equal((await post(VALIDO, { cod: "abc" })).status, 400);
  assert.equal(grupo.chamadas.metadata + grupo.chamadas.onWhatsApp.length + grupo.chamadas.add.length, 0);
  // convite de 500 caracteres e 50 telefones são aceitos (limites do contrato).
  const limite = await post({ ...VALIDO, convite: { texto: "x".repeat(500) }, segundos_intervalo: 0 });
  assert.equal(limite.status, 200);
});

test("400 de validação vem antes do 409 de equipe desconectada", async () => {
  const resposta = await post({ ...VALIDO, telefones: [] }, { cod: "9" });
  assert.equal(resposta.status, 400);
});

test("401 sem token ou com token errado; 404 de outro tenant (mesmo corpo); 409 desconectada com codigo; 503 + Retry-After", async () => {
  const { grupo } = await conectarEquipe("7");
  assert.equal((await post(VALIDO, { token: null })).status, 401);
  assert.equal((await post(VALIDO, { token: "errado" })).status, 401);

  const outro = await post({ ...VALIDO, hash_empresa: "hash-b" });
  assert.equal(outro.status, 404);
  assert.deepEqual(await outro.json(), { msg: "Equipe não encontrada." });
  assert.equal(grupo.chamadas.onWhatsApp.length, 0);

  const semInstancia = await post(VALIDO, { cod: "9" });
  assert.equal(semInstancia.status, 409);
  assert.deepEqual(await semInstancia.json(), { msg: "O WhatsApp da equipe não está conectado.", codigo: "DESCONECTADA" });

  desligamento.marcarEncerrando();
  const durante = await post(VALIDO);
  assert.equal(durante.status, 503);
  assert.ok(Number(durante.headers.get("retry-after")) > 0);
  assert.equal(grupo.chamadas.onWhatsApp.length, 0);
});

test("500 não vaza o erro; adapter sem o método responde 502", async () => {
  await conectarEquipe("7");
  const adapter = /** @type {any} */ (manager.obter(7));
  const original = adapter.adicionarParticipantesGrupo;
  adapter.adicionarParticipantesGrupo = async () => {
    throw new Error(`segredo ${FONE_A} ${JID_A}`);
  };
  /** @type {Response | undefined} */
  let resposta;
  const originalError = console.error;
  console.error = () => {};
  try {
    resposta = await post(VALIDO);
  } finally {
    console.error = originalError;
  }
  assert.equal(resposta?.status, 500);
  const texto = JSON.stringify(await resposta?.json());
  assert.deepEqual(JSON.parse(texto), { msg: "Erro interno ao adicionar os participantes." });
  assert.equal(trava.ocupada("7"), false);

  adapter.adicionarParticipantesGrupo = undefined;
  const semMetodo = await post(VALIDO);
  assert.equal(semMetodo.status, 502);
  adapter.adicionarParticipantesGrupo = original;
});

test("o console da rota (sucesso, convite, falhas) não leva telefone, JID, LID nem código de convite", async () => {
  await conectarEquipe("7", {
    adds: { [JID_A]: { status: "403", content: conteudoComAddRequest(JID_A, "CODIGO-FALSO", 1760000000) }, [JID_B]: new Error(`erro ${FONE_B}`) },
    numeros: { ...NUMEROS, [FONE_C]: new Error(`rede ${FONE_C}`) },
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
  assert.doesNotMatch(linhas.join("\n"), /\d{10,}|@lid|@s\.whatsapp\.net|@g\.us|CODIGO-FALSO/);
  assert.match(linhas.join("\n"), /equipe 7/);
});

test("a mensagem de sistema de adição (GROUP_PARTICIPANT_ADD) não gera registro e invalida o cache do grupo", async () => {
  const { grupo, socket } = await conectarEquipe("7");
  const adapter = /** @type {any} */ (manager.obter(7));
  await adapter.obterParticipantesGrupo(JID_GRUPO);
  await adapter.obterParticipantesGrupo(JID_GRUPO);
  assert.equal(grupo.chamadas.metadata, 1, "a segunda consulta veio do cache");

  const sistema = { key: { remoteJid: JID_GRUPO, fromMe: true, id: "3EB0SISTEMA000001" }, messageStubType: 27, messageStubParameters: [JID_A], messageTimestamp: Math.floor(Date.now() / 1000) };
  await socket.emitir("messages.upsert", { messages: [sistema], type: "notify" });
  await drenar();
  assert.equal(registradas.length, 0, "a mensagem de sistema não é registrada");
  await adapter.obterParticipantesGrupo(JID_GRUPO);
  assert.equal(grupo.chamadas.metadata, 2, "o cache do grupo foi invalidado");
});

test("o desconectar ao lado de um grupo parado não aborta nada de outra equipe", async () => {
  await conectarEquipe("7");
  await conectarEquipe("8");
  const { aviso, liberarTudo } = pausaControlada();
  const primeira = post({ ...VALIDO, telefones: [FONE_A, FONE_B] });
  await aviso;
  await manager.desconectar(8, "hash-a");
  assert.equal(trava.ocupada("7"), true);
  dormirImpl = async () => {};
  liberarTudo();
  const resposta = await primeira;
  assert.deepEqual((/** @type {any} */ (await resposta.json())).participantes.map((/** @type {any} */ p) => p.status), ["ADICIONADO", "ADICIONADO"]);
});

/** Segura o primeiro onWhatsApp até `liberar()`; `aviso` resolve quando ele começou. */
function onWhatsAppSegurado() {
  /** @type {() => void} */
  let comecou = () => {};
  const aviso = new Promise((resolve) => {
    comecou = () => resolve(undefined);
  });
  /** @type {() => void} */
  let liberar = () => {};
  const porta = new Promise((resolve) => {
    liberar = () => resolve(undefined);
  });
  let primeira = true;
  ganchoImpl = async (evento) => {
    if (evento !== "onWhatsApp" || !primeira) return;
    primeira = false;
    comecou();
    await porta;
  };
  return { aviso, liberar };
}

test("remover durante o onWhatsApp do telefone em andamento: ele e o restante saem NAO_PROCESSADO, sem IQ de adição", async () => {
  const { grupo } = await conectarEquipe("7");
  const { aviso, liberar } = onWhatsAppSegurado();
  const chamada = post({ ...VALIDO, telefones: [FONE_A, FONE_B] });
  await aviso;
  await manager.remover(7, "hash-a");
  liberar();
  const resposta = await chamada;
  assert.equal(resposta.status, 200);
  assert.deepEqual((/** @type {any} */ (await resposta.json())).participantes.map((/** @type {any} */ p) => p.status), ["NAO_PROCESSADO", "NAO_PROCESSADO"]);
  assert.equal(grupo.chamadas.add.length, 0);
});

test("desconectar durante o onWhatsApp: nenhum IQ de adição depois do aborto", async () => {
  const { grupo } = await conectarEquipe("7");
  const { aviso, liberar } = onWhatsAppSegurado();
  const chamada = post(VALIDO);
  await aviso;
  await manager.desconectar(7, "hash-a");
  liberar();
  const resposta = await chamada;
  assert.deepEqual((/** @type {any} */ (await resposta.json())).participantes.map((/** @type {any} */ p) => p.status), ["NAO_PROCESSADO"]);
  assert.equal(grupo.chamadas.add.length, 0);
});

test("desligamento durante o onWhatsApp: nenhum IQ de adição depois do aborto", async () => {
  const { grupo } = await conectarEquipe("7");
  const { aviso, liberar } = onWhatsAppSegurado();
  const chamada = post({ ...VALIDO, telefones: [FONE_A, FONE_B] });
  await aviso;
  desligamento.marcarEncerrando();
  liberar();
  const resposta = await chamada;
  assert.deepEqual((/** @type {any} */ (await resposta.json())).participantes.map((/** @type {any} */ p) => p.status), ["NAO_PROCESSADO", "NAO_PROCESSADO"]);
  assert.equal(grupo.chamadas.add.length, 0);
});

test("o back desiste antes (conexão fechada sem resposta): o laço para, nada mais é adicionado e a trava cai", async () => {
  const { grupo } = await conectarEquipe("7");
  const { aviso } = pausaControlada();
  const cliente = new AbortController();
  const chamada = fetch(`${baseUrl}/equipe/7/grupo/participantes/adicionar`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Internal-Token": TOKEN },
    body: JSON.stringify({ ...VALIDO, telefones: [FONE_A, FONE_B, FONE_C] }),
    signal: cliente.signal,
  });
  await aviso;
  assert.equal(trava.ocupada("7"), true);
  cliente.abort();
  await assert.rejects(chamada);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(trava.ocupada("7"), false, "a trava caiu");
  assert.equal(grupo.chamadas.add.length, 1, "só o telefone que já estava feito");
  assert.equal(grupo.chamadas.onWhatsApp.length, 1);
  dormirImpl = async () => {};
  assert.equal((await post(VALIDO)).status, 200);
});
