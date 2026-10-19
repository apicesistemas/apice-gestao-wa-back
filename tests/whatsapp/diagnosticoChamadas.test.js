// @ts-check
// Task 34.0: o diagnóstico das chamadas só grava a FORMA do evento no log. Desligado não escreve nada;
// ligado escreve uma linha por evento, sem id, telefone, JID, LID nem nome.
const { test, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { registrarFormaEventoCall, registrarFormaMensagem, PREFIXO } = require("../../src/whatsapp/diagnosticoChamadas");
const { TELEFONE_EQUIPE, EU } = require("../helpers/mensagensWa");

const ORIGINAL = process.env.DIAGNOSTICO_CHAMADAS;
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.DIAGNOSTICO_CHAMADAS;
  else process.env.DIAGNOSTICO_CHAMADAS = ORIGINAL;
});

const TEL_CLIENTE = "5511988887777";
const LID_CLIENTE = "100000000012345@lid";
const ID_CHAMADA = "CALLID7F3A9C21B4D5E6F708192A3B4C5D6E7F";
const ID_MSG = "3EB0A1B2C3D4E5F60718";
const NOME = "Fulana de Tal";
const GRUPO = "120363000000000001@g.us";

/**
 * Captura o console.log durante a função.
 * @param {() => void} fn
 * @returns {string[]}
 */
function capturar(fn) {
  const original = console.log;
  /** @type {string[]} */
  const linhas = [];
  console.log = (/** @type {any[]} */ ...a) => void linhas.push(a.join(" "));
  try {
    fn();
  } finally {
    console.log = original;
  }
  return linhas;
}

/**
 * A linha só pode ter flags e domínios: nada de dígitos longos, `@`, id nem nome.
 * @param {string} linha
 */
function assertSemDados(linha) {
  assert.ok(linha.startsWith(`${PREFIXO} `), linha);
  assert.doesNotMatch(linha, /\d{4,}/, "dígitos de telefone, id ou LID");
  assert.doesNotMatch(linha, /@/, "JID");
  for (const proibido of [TEL_CLIENTE, TELEFONE_EQUIPE, ID_CHAMADA, ID_MSG, NOME, "Fulana", "100000000012345"]) {
    assert.ok(!linha.includes(proibido), `vazou ${proibido}`);
  }
  assert.match(linha, /^\[DIAG-CHAMADA\] evento=(call|upsert)( [a-zA-Z_]+=[A-Za-z0-9_.?-]+)+$/);
}

const eu = EU;
const eventoCall = (/** @type {any} */ extra = {}) => ({
  chatId: `${TEL_CLIENTE}@s.whatsapp.net`,
  from: `${TEL_CLIENTE}@s.whatsapp.net`,
  id: ID_CHAMADA,
  date: new Date(),
  status: "offer",
  offline: false,
  isVideo: false,
  ...extra,
});

test("desligado (padrão e qualquer valor diferente de S): nenhum log", () => {
  const linhas = capturar(() => {
    for (const valor of [undefined, "N", "s", "true", "1", ""]) {
      if (valor === undefined) delete process.env.DIAGNOSTICO_CHAMADAS;
      else process.env.DIAGNOSTICO_CHAMADAS = valor;
      registrarFormaEventoCall([eventoCall()], eu);
      registrarFormaMensagem({ key: { remoteJid: `${TEL_CLIENTE}@s.whatsapp.net`, fromMe: false, id: ID_MSG }, message: { conversation: "oi" } }, eu);
    }
  });
  assert.deepEqual(linhas, []);
});

test("evento call ligado: uma linha por evento, só a forma", () => {
  process.env.DIAGNOSTICO_CHAMADAS = "S";
  const linhas = capturar(() =>
    registrarFormaEventoCall(
      [
        eventoCall({ status: "offer", isVideo: true }),
        eventoCall({ status: "timeout", offline: true, from: LID_CLIENTE, chatId: LID_CLIENTE }),
        eventoCall({ status: "terminate", from: EU.jid, isVideo: undefined }),
        eventoCall({ status: "offer", isGroup: true, groupJid: GRUPO, chatId: GRUPO }),
      ],
      eu,
    ),
  );
  assert.equal(linhas.length, 4);
  linhas.forEach(assertSemDados);
  assert.match(linhas[0], /status=offer offline=N video=S grupo=\? groupJid=N from_equipe=N from_dominio=s\.whatsapp\.net chat_equipe=N chat_dominio=s\.whatsapp\.net$/);
  assert.match(linhas[1], /status=timeout offline=S video=N grupo=\? groupJid=N from_equipe=N from_dominio=lid chat_equipe=N chat_dominio=lid$/);
  assert.match(linhas[2], /status=terminate .*video=\? .*from_equipe=S from_dominio=s\.whatsapp\.net chat_equipe=N/);
  assert.match(linhas[3], /grupo=S groupJid=S from_equipe=N from_dominio=s\.whatsapp\.net chat_equipe=N chat_dominio=g\.us$/);
});

test("evento call: a equipe é reconhecida pelo LID, e status desconhecido vira outro", () => {
  process.env.DIAGNOSTICO_CHAMADAS = "S";
  const linhas = capturar(() => {
    registrarFormaEventoCall([eventoCall({ from: EU.lid })], eu);
    registrarFormaEventoCall([eventoCall({ status: "xyz", from: "algo", chatId: undefined })], eu);
    registrarFormaEventoCall([eventoCall()], undefined);
  });
  linhas.forEach(assertSemDados);
  assert.match(linhas[0], /from_equipe=S from_dominio=lid/);
  assert.match(linhas[1], /status=outro .*from_equipe=\? from_dominio=outro chat_equipe=\? chat_dominio=ausente/);
  assert.match(linhas[2], /from_equipe=\? /);
});

test("evento call: valores inesperados e um evento isolado nunca derrubam", () => {
  process.env.DIAGNOSTICO_CHAMADAS = "S";
  const linhas = capturar(() => {
    registrarFormaEventoCall(null, eu);
    registrarFormaEventoCall([null, 5, "x"], eu);
    registrarFormaEventoCall(eventoCall(), eu); // objeto solto, não lista
  });
  assert.equal(linhas.length, 1);
  linhas.forEach(assertSemDados);
});

/**
 * @param {any} message
 * @param {any} [chave]
 * @param {any} [extra]
 */
const upsert = (message, chave = {}, extra = {}) => ({
  key: { remoteJid: `${TEL_CLIENTE}@s.whatsapp.net`, fromMe: true, id: ID_MSG, ...chave },
  pushName: NOME,
  message,
  ...extra,
});

test("messages.upsert: callLogMesssage direto, com resultado, vídeo e duração", () => {
  process.env.DIAGNOSTICO_CHAMADAS = "S";
  const linhas = capturar(() => {
    registrarFormaMensagem(upsert({ callLogMesssage: { callOutcome: 0, isVideo: true, durationSecs: 42 } }), eu);
    registrarFormaMensagem(upsert({ callLogMesssage: { callOutcome: 1, isVideo: false } }), eu);
    registrarFormaMensagem(upsert({ callLogMesssage: {} }), eu);
    registrarFormaMensagem(upsert({ callLogMesssage: { callOutcome: 3, durationSecs: 0 } }, { remoteJid: LID_CLIENTE }), eu);
    registrarFormaMensagem(upsert({ callLogMesssage: { callOutcome: 99 } }), eu);
  });
  linhas.forEach(assertSemDados);
  assert.match(linhas[0], /fromMe=S dominio=s\.whatsapp\.net .*callLog=S call=N outcome=CONNECTED video=S duracao=S campo=callLogMesssage/);
  assert.match(linhas[1], /outcome=MISSED video=N duracao=N/);
  assert.match(linhas[2], /outcome=ausente video=\? duracao=N/);
  assert.match(linhas[3], /dominio=lid .*outcome=REJECTED video=\? duracao=S/);
  assert.match(linhas[4], /outcome=outro/);
});

test("messages.upsert: callLogMesssage desembrulhado de ephemeralMessage e viewOnce", () => {
  process.env.DIAGNOSTICO_CHAMADAS = "S";
  const registro = { callLogMesssage: { callOutcome: 2, isVideo: true, durationSecs: 7 } };
  const linhas = capturar(() => {
    registrarFormaMensagem(upsert({ ephemeralMessage: { message: registro } }), eu);
    registrarFormaMensagem(upsert({ viewOnceMessage: { message: registro } }), eu);
    registrarFormaMensagem(upsert({ ephemeralMessage: { message: { viewOnceMessageV2: { message: registro } } } }), eu);
  });
  assert.equal(linhas.length, 3);
  for (const linha of linhas) {
    assertSemDados(linha);
    assert.match(linha, /embrulhada=S callLog=S call=N outcome=FAILED video=S duracao=S/);
  }
});

test("messages.upsert: message.call, stub de chamada perdida, grupo e mensagem comum", () => {
  process.env.DIAGNOSTICO_CHAMADAS = "S";
  const linhas = capturar(() => {
    registrarFormaMensagem(upsert({ call: { callKey: Buffer.from("x") } }, { fromMe: false }), eu);
    registrarFormaMensagem(upsert(undefined, { fromMe: false }, { messageStubType: 40 }), eu);
    registrarFormaMensagem(upsert(undefined, { fromMe: false }, { messageStubType: 46 }), eu);
    registrarFormaMensagem(upsert(undefined, {}, { messageStubType: 28 }), eu);
    registrarFormaMensagem(upsert(undefined, {}, { messageStubType: 123456789 }), eu);
    registrarFormaMensagem(upsert({ callLogMesssage: { callOutcome: 0 } }, { remoteJid: GRUPO, participant: EU.jid }), eu);
    registrarFormaMensagem(upsert({ conversation: `Oi ${NOME} ${TEL_CLIENTE}`, messageContextInfo: {} }, { fromMe: false }), eu);
  });
  linhas.forEach(assertSemDados);
  assert.match(linhas[0], /fromMe=N .*stub=ausente embrulhada=N callLog=N call=S outcome=- video=- duracao=- campo=call /);
  assert.match(linhas[1], /stub=CALL_MISSED_VOICE .*callLog=N call=N .*campo=nenhum/);
  assert.match(linhas[2], /stub=CALL_MISSED_GROUP_VIDEO/);
  assert.match(linhas[3], /stub=28 /);
  assert.match(linhas[4], /stub=outro /);
  assert.match(linhas[5], /dominio=g\.us participante=s\.whatsapp\.net .*callLog=S .*equipe_remetente=S/);
  assert.match(linhas[6], /callLog=N call=N .*campo=conversation /);
});

test("messages.upsert: entrada inválida não grava nem lança", () => {
  process.env.DIAGNOSTICO_CHAMADAS = "S";
  const linhas = capturar(() => {
    registrarFormaMensagem(null, eu);
    registrarFormaMensagem("texto", eu);
    registrarFormaMensagem({}, eu);
    registrarFormaMensagem({ key: null, message: { "campo com espaço": 1 } }, undefined);
    registrarFormaMensagem(
      /** @type {any} */ ({
        get key() {
          throw new Error("falha");
        },
      }),
      eu,
    );
  });
  assert.equal(linhas.length, 2);
  linhas.forEach(assertSemDados);
});
