// @ts-check
// Fase 56, Task 56.0: diagnóstico TEMPORÁRIO da presença "digitando". Desligado por padrão, só para as
// equipes de DIAGNOSTICO_PRESENCA_EQUIPES, e a linha nunca leva JID, LID, telefone, nome nem texto.
const { test, beforeEach, afterEach, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const baileysFalso = require("../helpers/baileysFalso");

baileysFalso.instalarBaileysFalso();
const { criarAdapter } = require("../../src/whatsapp/BaileysAdapter");
const diagnostico = require("../../src/whatsapp/diagnosticoPresenca");
const { criarPresenca } = require("../../src/whatsapp/presenca");
const { mensagemWa, JID_CLIENTE, LID_CLIENTE, JID_GRUPO, JID_PARTICIPANTE, EU } = require("../helpers/mensagensWa");

const { ultimoSocket, drenar } = baileysFalso;
const PREFIXO = diagnostico.PREFIXO;
const diretorioSessoes = fs.mkdtempSync(path.join(os.tmpdir(), "wa-back-diagpresenca-"));
after(() => fs.rmSync(diretorioSessoes, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));

const VARIAVEIS = ["DIAGNOSTICO_PRESENCA", "DIAGNOSTICO_PRESENCA_EQUIPES", "DIAGNOSTICO_PRESENCA_ONLINE"];
/** @type {Record<string, string | undefined>} */
const ORIGINAL = Object.fromEntries(VARIAVEIS.map((v) => [v, process.env[v]]));
beforeEach(() => {
  baileysFalso.limparHistorico();
  for (const v of VARIAVEIS) delete process.env[v];
});
afterEach(() => {
  for (const v of VARIAVEIS) {
    if (ORIGINAL[v] === undefined) delete process.env[v];
    else process.env[v] = ORIGINAL[v];
  }
});

/** JID/LID marcadores com sufixo de aparelho: o teste procura por eles na linha. */
const JID_MARCADOR = "5511977776666:4@s.whatsapp.net";
const LID_MARCADOR = "100000000098765:4@lid";

/**
 * Captura console.log e console.error durante a função assíncrona e devolve só as linhas do diagnóstico.
 * @param {() => Promise<void>} fn
 * @returns {Promise<string[]>}
 */
async function capturar(fn) {
  const log = console.log;
  const erro = console.error;
  /** @type {string[]} */
  const linhas = [];
  console.log = (/** @type {any[]} */ ...a) => void linhas.push(a.join(" "));
  console.error = (/** @type {any[]} */ ...a) => void linhas.push(a.join(" "));
  try {
    await fn();
  } finally {
    console.log = log;
    console.error = erro;
  }
  return linhas.filter((l) => l.includes(PREFIXO));
}

/** @param {string} linha */
function assertSemDados(linha) {
  assert.ok(linha.startsWith(`${PREFIXO} `), linha);
  assert.doesNotMatch(linha, /@/, `JID na linha: ${linha}`);
  assert.doesNotMatch(linha, /\d{5,}/, `sequência longa de dígitos: ${linha}`);
  assert.match(linha, /^\[DIAG_PRESENCA\]( [a-z_]+=[A-Za-z0-9_.?>#-]+)+$/, linha);
}

/**
 * @param {{ codEquipe?: string, falhaPresenca?: boolean, respostaBack?: any, falhaOnline?: boolean }} [opcoes]
 */
async function adapterConectado({ codEquipe = "31", falhaPresenca = false, respostaBack = { msg: "Presença repassada." }, falhaOnline = false } = {}) {
  /** @type {{ dados: any, contexto: any }[]} */
  const presencas = [];
  const adapter = criarAdapter({
    codEquipe,
    hashEmpresa: "hash-diag",
    diretorioSessoes,
    registrarMensagem: async () => {},
    registrarStatusMensagem: async () => {},
    registrarPresenca: async (dados, contexto) => {
      presencas.push({ dados, contexto });
      if (falhaPresenca) throw Object.assign(new Error("HTTP 500 com 5511977776666@s.whatsapp.net"), { name: "ErroRotaInterna", status: 500 });
      return respostaBack;
    },
  });
  await adapter.iniciar();
  const socket = /** @type {any} */ (ultimoSocket());
  socket.user = { id: EU.jid, lid: EU.lid };
  socket.onWhatsApp = async () => [];
  socket.presenceSubscribe = async () => {};
  socket.groupMetadata = async (/** @type {string} */ jid) => ({ id: jid, subject: "Grupo" });
  /** @type {string[]} */
  socket.disponibilidade = [];
  socket.sendPresenceUpdate = async (/** @type {string} */ tipo) => {
    socket.disponibilidade.push(tipo);
    if (falhaOnline) throw new Error(`falha com ${JID_MARCADOR}`);
  };
  /** @param {string} evento @param {any} dado */
  const emitir = async (evento, dado) => {
    await socket.emitir(evento, dado);
    await drenar();
  };
  return { adapter, socket, presencas, emitir };
}

/** @param {string} id @param {string} participante @param {string} estado */
const evento = (id, participante, estado) => ({ id, presences: { [participante]: { lastKnownPresence: estado } } });

function ligar(equipes = "31", extra = {}) {
  process.env.DIAGNOSTICO_PRESENCA = "S";
  process.env.DIAGNOSTICO_PRESENCA_EQUIPES = equipes;
  Object.assign(process.env, extra);
}

test("sem a flag: nenhuma linha de log e nenhum sendPresenceUpdate, e o /interno/presenca recebe o corpo de sempre", async () => {
  process.env.DIAGNOSTICO_PRESENCA_ONLINE = "S"; // sozinha, sem DIAGNOSTICO_PRESENCA=S, não liga nada
  process.env.DIAGNOSTICO_PRESENCA_EQUIPES = "31";
  const { socket, presencas, emitir } = await adapterConectado();
  const linhas = await capturar(async () => {
    await emitir("connection.update", { connection: "open" });
    await emitir("messages.upsert", { messages: [mensagemWa({ conversation: "oi" })], type: "notify" });
    await emitir("presence.update", evento(JID_MARCADOR, JID_MARCADOR, "composing"));
    await emitir("presence.update", evento(JID_MARCADOR, JID_MARCADOR, "available"));
  });
  assert.deepEqual(linhas, []);
  assert.deepEqual(socket.disponibilidade, []);
  assert.deepEqual(
    presencas.map((p) => p.dados),
    [
      { chat_jid: JID_MARCADOR, participante_jid: null, estado: "DIGITANDO" },
      { chat_jid: JID_MARCADOR, participante_jid: null, estado: "PARADO" },
    ]
  );
});

test("com a flag: uma linha por presence.update, sem '@', sem 5+ dígitos, com os campos pedidos", async () => {
  ligar();
  const { presencas, emitir } = await adapterConectado();
  const linhas = await capturar(async () => {
    await emitir("presence.update", evento(JID_MARCADOR, JID_MARCADOR, "composing"));
    await emitir("presence.update", evento(JID_MARCADOR, JID_MARCADOR, "composing"));
    await emitir("presence.update", evento(LID_MARCADOR, LID_MARCADOR, "recording"));
    await emitir("presence.update", evento(JID_GRUPO, JID_PARTICIPANTE, "composing"));
    await emitir("presence.update", evento(JID_GRUPO, EU.jid, "composing"));
    await emitir("presence.update", evento("status@broadcast", "status@broadcast", "composing"));
  });
  assert.equal(linhas.length, 6);
  for (const linha of linhas) assertSemDados(linha);
  for (const linha of linhas) for (const proibido of ["5511977776666", "100000000098765", "5511900000002"]) assert.ok(!linha.includes(proibido), linha);

  assert.equal(
    linhas[0],
    `${PREFIXO} evento=presence equipe=31 chat_dominio=s.whatsapp.net chat_aparelho=S part_dominio=s.whatsapp.net part_igual_chat=S ` +
      "presenca=composing inscrito=N proprio=N repetido=N intervalo=- resposta=repassada"
  );
  assert.match(linhas[1], /presenca=composing .*repetido=S intervalo=\d+ms resposta=-$/);
  assert.match(linhas[2], /chat_dominio=lid chat_aparelho=S part_dominio=lid part_igual_chat=S presenca=recording .*resposta=repassada$/);
  assert.match(linhas[3], /chat_dominio=g\.us chat_aparelho=N part_dominio=s\.whatsapp\.net part_igual_chat=N presenca=composing/);
  assert.match(linhas[4], /proprio=S repetido=\? .*resposta=-$/);
  assert.match(linhas[5], /chat_dominio=outro /);
  const contexto = { hash_empresa: "hash-diag", cod_equipe: "31" };
  assert.deepEqual(presencas, [
    { dados: { chat_jid: JID_MARCADOR, participante_jid: null, estado: "DIGITANDO" }, contexto },
    { dados: { chat_jid: LID_MARCADOR, participante_jid: null, estado: "GRAVANDO" }, contexto },
    { dados: { chat_jid: JID_GRUPO, participante_jid: JID_PARTICIPANTE, estado: "DIGITANDO" }, contexto },
    { dados: { chat_jid: "status@broadcast", participante_jid: null, estado: "DIGITANDO" }, contexto },
  ]);
});

test("a linha informa se o chat estava inscrito, a inscrição e o 'ignorada' do back", async () => {
  ligar();
  const { emitir } = await adapterConectado({ respostaBack: { msg: "Conversa não encontrada; presença ignorada." } });
  const linhas = await capturar(async () => {
    await emitir("messages.upsert", { messages: [mensagemWa({ conversation: "oi" })], type: "notify" });
    await emitir("presence.update", evento(JID_CLIENTE, JID_CLIENTE, "composing"));
  });
  for (const linha of linhas) assertSemDados(linha);
  assert.ok(linhas.some((l) => /^\[DIAG_PRESENCA\] evento=inscricao equipe=31 chat_dominio=s\.whatsapp\.net resultado=ok$/.test(l)), linhas.join("\n"));
  assert.ok(linhas.some((l) => /evento=presence .*inscrito=S .*resposta=ignorada$/.test(l)), linhas.join("\n"));
});

test("falha do back e falha da inscrição viram o código/nome do erro, sem dado nenhum", async () => {
  ligar();
  const { socket, emitir } = await adapterConectado({ falhaPresenca: true });
  socket.presenceSubscribe = async () => {
    throw new Error(`falha ${JID_MARCADOR}`);
  };
  const linhas = await capturar(async () => {
    await emitir("messages.upsert", { messages: [mensagemWa({ conversation: "oi" })], type: "notify" });
    await emitir("presence.update", evento(JID_MARCADOR, JID_MARCADOR, "composing"));
  });
  for (const linha of linhas) assertSemDados(linha);
  assert.ok(linhas.some((l) => /evento=inscricao .*resultado=Error$/.test(l)), linhas.join("\n"));
  assert.ok(linhas.some((l) => /evento=presence .*resposta=ErroRotaInterna_HTTP_500$/.test(l)), linhas.join("\n"));
});

test("equipe fora de DIAGNOSTICO_PRESENCA_EQUIPES: sem log e sem 'available', mesmo com ONLINE=S", async () => {
  ligar("7, 8", { DIAGNOSTICO_PRESENCA_ONLINE: "S" });
  const { socket, presencas, emitir } = await adapterConectado({ codEquipe: "31" });
  const linhas = await capturar(async () => {
    await emitir("connection.update", { connection: "open" });
    await emitir("messages.upsert", { messages: [mensagemWa({ conversation: "oi" })], type: "notify" });
    await emitir("presence.update", evento(JID_MARCADOR, JID_MARCADOR, "composing"));
  });
  assert.deepEqual(linhas, []);
  assert.deepEqual(socket.disponibilidade, []);
  assert.equal(presencas.length, 1);
});

test("lista de equipes vazia ou ausente não liga para ninguém", () => {
  process.env.DIAGNOSTICO_PRESENCA = "S";
  assert.equal(diagnostico.ligadoPara("31"), false);
  process.env.DIAGNOSTICO_PRESENCA_EQUIPES = " , ";
  assert.equal(diagnostico.ligadoPara("31"), false);
  process.env.DIAGNOSTICO_PRESENCA_EQUIPES = "5, 31";
  assert.equal(diagnostico.ligadoPara(31), true);
  assert.equal(diagnostico.ligadoPara("3"), false);
});

test("open com a flag: loga o open; com DIAGNOSTICO_PRESENCA_ONLINE=S manda 'available' depois dele", async () => {
  ligar();
  const a = await adapterConectado();
  const semOnline = await capturar(async () => {
    await a.emitir("connection.update", { connection: "open" });
  });
  assert.equal(semOnline.length, 1);
  assertSemDados(semOnline[0]);
  assert.equal(semOnline[0], `${PREFIXO} evento=open equipe=31 baileys_padrao=unavailable nome_no_socket=N online_diag=N resultado=-`);
  assert.deepEqual(a.socket.disponibilidade, []);
  await a.adapter.pararSocket();

  process.env.DIAGNOSTICO_PRESENCA_ONLINE = "S";
  const b = await adapterConectado();
  const comOnline = await capturar(async () => {
    await b.emitir("connection.update", { connection: "open" });
  });
  assert.deepEqual(b.socket.disponibilidade, ["available"]);
  assert.ok(comOnline.some((l) => l === `${PREFIXO} evento=open equipe=31 baileys_padrao=unavailable nome_no_socket=N online_diag=S resultado=ok`), comOnline.join("\n"));
  await b.adapter.pararSocket();
});

test("a linha do open diz se o socket tem nome (sem nome o Baileys ignora o 'available' em silêncio)", async () => {
  ligar();
  const { socket, emitir } = await adapterConectado();
  socket.user = { ...socket.user, name: "Equipe Teste" };
  const linhas = await capturar(async () => {
    await emitir("connection.update", { connection: "open" });
  });
  assert.equal(linhas[0], `${PREFIXO} evento=open equipe=31 baileys_padrao=unavailable nome_no_socket=S online_diag=N resultado=-`);
  assert.doesNotMatch(linhas[0], /Equipe|Teste/);
});

test("erro do sendPresenceUpdate('available') só loga (sem o texto do erro)", async () => {
  ligar("31", { DIAGNOSTICO_PRESENCA_ONLINE: "S" });
  const { socket, emitir, adapter } = await adapterConectado({ falhaOnline: true });
  const linhas = await capturar(async () => {
    await emitir("connection.update", { connection: "open" });
  });
  assert.deepEqual(socket.disponibilidade, ["available"]);
  assert.ok(linhas.some((l) => /evento=open .*online_diag=S resultado=Error$/.test(l)), linhas.join("\n"));
  for (const linha of linhas) assertSemDados(linha);
  await adapter.pararSocket();
});

test("socket sem sendPresenceUpdate com ONLINE=S não derruba o open", async () => {
  ligar("31", { DIAGNOSTICO_PRESENCA_ONLINE: "S" });
  const { socket, emitir } = await adapterConectado();
  socket.sendPresenceUpdate = undefined;
  const linhas = await capturar(async () => {
    await emitir("connection.update", { connection: "open" });
  });
  assert.ok(linhas.some((l) => /evento=open .*online_diag=S resultado=TypeError$/.test(l)), linhas.join("\n"));
});

test("o diagnóstico nunca derruba a presença: registrarEvento com entrada torta só é ignorado", async () => {
  ligar();
  const linhas = await capturar(async () => {
    diagnostico.registrarEvento("31", /** @type {any} */ (null));
    diagnostico.registrarEvento("31", /** @type {any} */ ({ chat: 7, participante: {}, presenca: 3 }));
    diagnostico.registrarInscricao("31", /** @type {any} */ (null), "ok");
  });
  for (const linha of linhas) assertSemDados(linha);
});

test("intervalo: abaixo de 10 s em ms, acima em s (nunca 5+ dígitos), e o mapa não cresce sem limite", () => {
  ligar();
  const real = Date.now;
  let agora = 1_000_000;
  Date.now = () => agora;
  /** @type {string[]} */
  const linhas = [];
  const log = console.log;
  console.log = (/** @type {any[]} */ ...a) => void linhas.push(a.join(" "));
  /** @param {any} i */
  const ev = (i) => diagnostico.registrarEvento("31", diagnostico.marcarChegada("31", i));
  try {
    const info = { chat: "5511900000777@s.whatsapp.net", participante: "5511900000777@s.whatsapp.net", presenca: "composing", inscrito: false, proprio: false, repetido: false, resposta: "repassada" };
    ev(info);
    agora += 4_321;
    ev(info);
    agora += 25_000;
    ev(info);
    agora += 20_000_000;
    ev(info);
    for (let i = 0; i < 1100; i += 1) ev({ ...info, chat: `${i + 1}@lid`, participante: `${i + 1}@lid` });
    ev(info);
  } finally {
    console.log = log;
    Date.now = real;
  }
  assert.match(linhas[0], /intervalo=-/);
  assert.match(linhas[1], /intervalo=4321ms/);
  assert.match(linhas[2], /intervalo=25s/);
  assert.match(linhas[3], /intervalo=>9999s/);
  assert.match(linhas[linhas.length - 1], /intervalo=-/, "o mapa foi esvaziado");
  for (const linha of linhas) assertSemDados(linha);
});

test("o intervalo vem da chegada: back lento não inverte nem zera o cálculo, e a linha do repetido sai antes", async () => {
  ligar();
  const real = Date.now;
  let agora = 5_000_000;
  Date.now = () => agora;
  /** @type {() => void} */
  let liberar = () => {};
  const presenca = criarPresenca({
    contexto: { hash_empresa: "h", cod_equipe: "31" },
    registrarPresenca: () => new Promise((resolve) => void (liberar = () => resolve({ msg: "Presença repassada." }))),
  });
  const linhas = await capturar(async () => {
    const fila = presenca.tratarAtualizacao(evento(JID_CLIENTE, JID_CLIENTE, "composing"), EU);
    agora += 50;
    void presenca.tratarAtualizacao(evento(JID_CLIENTE, JID_CLIENTE, "composing"), EU); // repetido: a fila é a mesma, então não se espera
    await new Promise((resolve) => setImmediate(resolve));
    agora += 4_000; // o back responde muito depois dos 50 ms entre as duas chegadas
    liberar();
    await fila;
  }).finally(() => {
    Date.now = real;
  });
  assert.equal(linhas.length, 2);
  assert.match(linhas[0], /repetido=S intervalo=50ms resposta=-$/);
  assert.match(linhas[1], /repetido=N intervalo=- resposta=repassada$/);
});

test("seguro: sequência de 5+ dígitos num código de erro vira '#'", async () => {
  ligar();
  const presenca = criarPresenca({
    contexto: { hash_empresa: "h", cod_equipe: "31" },
    registrarPresenca: async () => {
      throw Object.assign(new Error("x"), { code: "ERR1234567" });
    },
  });
  const linhas = await capturar(async () => {
    await presenca.tratarAtualizacao(evento(JID_CLIENTE, JID_CLIENTE, "composing"), EU);
  });
  assert.match(linhas[0], /resposta=ERR#$/);
  assertSemDados(linhas[0]);
});

test("diagnóstico que lança (log quebrado) nunca rejeita nem trava a fila: o envio seguinte sai", async () => {
  ligar();
  /** @type {any[]} */
  const enviados = [];
  const presenca = criarPresenca({ contexto: { hash_empresa: "h", cod_equipe: "31" }, registrarPresenca: async (d) => void enviados.push(d.estado) });
  const log = console.log;
  console.log = () => {
    throw new Error("log quebrado");
  };
  try {
    await presenca.inscrever({ presenceSubscribe: async () => {} }, JID_CLIENTE);
    await presenca.tratarAtualizacao(evento(JID_CLIENTE, JID_CLIENTE, "composing"), EU);
    await presenca.tratarAtualizacao(evento(JID_CLIENTE, JID_CLIENTE, "available"), EU);
    await presenca.tratarAtualizacao(evento(JID_CLIENTE, JID_CLIENTE, "recording"), EU);
    await diagnostico.aoAbrir("31", { sendPresenceUpdate: async () => {} });
  } finally {
    console.log = log;
  }
  assert.deepEqual(enviados, ["DIGITANDO", "PARADO", "GRAVANDO"]);
});

test("presenca.js sem diagnóstico ligado: o corpo enviado ao back é o mesmo de antes, por criarPresenca", async () => {
  /** @type {any[]} */
  const enviados = [];
  const presenca = criarPresenca({ contexto: { hash_empresa: "h", cod_equipe: "31" }, registrarPresenca: async (d) => void enviados.push(d) });
  await presenca.tratarAtualizacao(evento(LID_CLIENTE, LID_CLIENTE, "composing"), EU);
  assert.deepEqual(enviados, [{ chat_jid: LID_CLIENTE, participante_jid: null, estado: "DIGITANDO" }]);
});
