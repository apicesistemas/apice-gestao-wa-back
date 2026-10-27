// @ts-check
// Chamadas recebidas no adapter (Tasks 34.2 e 34.6): o evento `call` do Baileys falso vai ao
// consolidador; o registro (C1) passa pela fila serial da entrada e o alerta (C2) não. Os clientes do
// back são funções falsas injetadas, e o relógio das janelas é manual.
const { test, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const baileysFalso = require("../helpers/baileysFalso");

baileysFalso.instalarBaileysFalso();
const { criarAdapter } = require("../../src/whatsapp/BaileysAdapter");
const { mensagemWa, JID_CLIENTE, TELEFONE_CLIENTE, EU, TELEFONE_EQUIPE } = require("../helpers/mensagensWa");

const { ultimoSocket, drenar, espiarSaidas } = baileysFalso;
const diretorioSessoes = fs.mkdtempSync(path.join(os.tmpdir(), "wa-back-chamadas-"));
after(() => fs.rmSync(diretorioSessoes, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
beforeEach(() => baileysFalso.limparHistorico());

const LID = "100000000000001@lid";
const GRUPO = "120363000000000001@g.us";
const PARTICIPANTE = "100000000000002@lid";
const JANELA = 15000;
const TETO = 300000;

/**
 * @param {{ registrar?: () => Promise<unknown>, registrarChamada?: (c: any, ctx: any) => Promise<unknown>, alertarChamada?: (a: any, ctx: any) => Promise<unknown>, onWhatsApp?: (jids: string) => Promise<any[]>, groupMetadata?: (jid: string) => Promise<any> }} [o]
 */
async function adapterConectado(o = {}) {
  let agora = Date.now();
  /** @type {{ ate: number, fn: () => void, cancelado: boolean }[]} */
  const timers = [];
  /** @type {any[]} */
  const mensagens = [];
  /** @type {{ corpo: any, contexto: any }[]} */
  const chamadas = [];
  /** @type {{ corpo: any, contexto: any }[]} */
  const alertas = [];
  const adapter = criarAdapter({
    codEquipe: "41",
    hashEmpresa: "hash-chamadas",
    diretorioSessoes,
    registrarMensagem: async (m) => {
      mensagens.push(m);
      if (o.registrar) await o.registrar();
    },
    registrarStatusMensagem: async () => {},
    registrarPresenca: async () => {},
    registrarChamada: async (corpo, contexto) => {
      chamadas.push({ corpo, contexto });
      return o.registrarChamada ? o.registrarChamada(corpo, contexto) : { msg: "Chamada registrada." };
    },
    alertarChamada: async (corpo, contexto) => {
      alertas.push({ corpo, contexto });
      return o.alertarChamada ? o.alertarChamada(corpo, contexto) : { msg: "Alerta de chamada emitido." };
    },
    opcoesChamadas: {
      msTeto: TETO,
      msJanelaAccept: JANELA,
      agora: () => agora,
      agendar: (fn, ms) => {
        const t = { ate: agora + ms, fn, cancelado: false };
        timers.push(t);
        return () => {
          t.cancelado = true;
        };
      },
    },
  });
  await adapter.iniciar();
  const socket = /** @type {any} */ (ultimoSocket());
  socket.user = { id: EU.jid, lid: EU.lid };
  /** @type {string[]} */
  socket.consultasOnWhatsApp = [];
  socket.onWhatsApp = async (/** @type {string} */ jid) => {
    socket.consultasOnWhatsApp.push(jid);
    return o.onWhatsApp ? o.onWhatsApp(jid) : [];
  };
  socket.groupMetadata = o.groupMetadata ?? (async (/** @type {string} */ jid) => ({ id: jid, subject: "Suporte Loja Centro" }));
  await socket.emitir("connection.update", { connection: "open" });
  const espiao = espiarSaidas(socket);
  /** @param {any} evento */
  const emitirCall = async (evento) => {
    await socket.emitir("call", Array.isArray(evento) ? evento : [evento]);
    await drenar();
  };
  /** @param {number} ms */
  const avancar = async (ms) => {
    agora += ms;
    for (;;) {
      const pronto = timers.filter((t) => !t.cancelado && t.ate <= agora).sort((a, b) => a.ate - b.ate)[0];
      if (!pronto) break;
      pronto.cancelado = true;
      pronto.fn();
    }
    await drenar();
    await new Promise((resolve) => setImmediate(resolve));
    await drenar();
  };
  return { adapter, socket, mensagens, chamadas, alertas, espiao, emitirCall, avancar };
}

/** @param {string} status @param {any} [extra] */
const evento = (status, extra = {}) => ({ id: "CALLID1", status, from: LID, chatId: LID, date: new Date(), offline: false, isVideo: true, ...extra });

/** Captura console.log e console.error durante o teste. @returns {{ linhas: string[], restaurar: () => void }} */
function capturarConsole() {
  const log = console.log;
  const erro = console.error;
  /** @type {string[]} */
  const linhas = [];
  console.log = (/** @type {any[]} */ ...a) => void linhas.push(a.join(" "));
  console.error = (/** @type {any[]} */ ...a) => void linhas.push(a.join(" "));
  return {
    linhas,
    restaurar() {
      console.log = log;
      console.error = erro;
    },
  };
}

test("34.2: recebida perdida (offer → ringing → terminate) registra UM PERDIDA depois da janela, com o corpo do C1", async () => {
  const { socket, chamadas, avancar, emitirCall, espiao } = await adapterConectado();
  try {
    await emitirCall([evento("offer"), evento("ringing"), evento("ringing")]);
    await emitirCall(evento("terminate"));
    await avancar(JANELA - 1);
    assert.equal(chamadas.length, 0);
    await avancar(1);
    assert.equal(chamadas.length, 1);
    const { corpo, contexto } = chamadas[0];
    assert.deepEqual(contexto, { hash_empresa: "hash-chamadas", cod_equipe: "41" });
    assert.deepEqual(
      { ...corpo, timestamp_wa: typeof corpo.timestamp_wa },
      {
        chamada_wa_id: "CALLID1",
        origem: "CLIENTE",
        tipo_chat: "PRIVADO",
        chat_jid: LID,
        remetente: { jid: LID, lid: LID, telefone: null, nome: null },
        contato: { jid: LID, lid: LID, telefone: null },
        video: true,
        resultado: "PERDIDA",
        timestamp_wa: "number",
      },
    );
    assert.deepEqual(socket.consultasOnWhatsApp, [], "LID sem telefone não consulta nada");
    assert.deepEqual(espiao.efeitos, [], "nenhum rejectCall, sendMessage nem fetch");
  } finally {
    espiao.restaurar();
  }
});

test("34.2: offer → reject registra RECUSADA na hora; terminate → accept dentro da janela registra ATENDIDA com video do offer", async () => {
  const { chamadas, avancar, emitirCall, espiao } = await adapterConectado();
  try {
    await emitirCall([evento("offer", { id: "R1" }), { ...evento("reject", { id: "R1" }), chatId: EU.jid, isVideo: undefined }]);
    await emitirCall(evento("terminate", { id: "R1" }));
    await emitirCall(evento("offer", { id: "A1", isVideo: false }));
    await emitirCall(evento("terminate", { id: "A1" }));
    await avancar(JANELA - 1000);
    await emitirCall({ ...evento("accept", { id: "A1" }), chatId: EU.jid, isVideo: undefined });
    await avancar(TETO * 2);
    assert.deepEqual(chamadas.map((c) => [c.corpo.chamada_wa_id, c.corpo.resultado, c.corpo.video, c.corpo.origem]), [
      ["R1", "RECUSADA", true, "CLIENTE"],
      ["A1", "ATENDIDA", false, "CLIENTE"],
    ]);
    assert.deepEqual(espiao.efeitos, []);
  } finally {
    espiao.restaurar();
  }
});

test("34.2: offer sem desfecho vira ENCERRADA no teto", async () => {
  const { chamadas, avancar, emitirCall, espiao } = await adapterConectado();
  try {
    await emitirCall(evento("offer"));
    await avancar(TETO);
    assert.deepEqual(chamadas.map((c) => c.corpo.resultado), ["ENCERRADA"]);
  } finally {
    espiao.restaurar();
  }
});

test("34.2: telefone sem LID → UM onWhatsApp; com o par no cache, a chamada seguinte não consulta", async () => {
  const { socket, chamadas, emitirCall, espiao } = await adapterConectado({
    onWhatsApp: async () => [{ jid: JID_CLIENTE, exists: true, lid: LID }],
  });
  try {
    await emitirCall([evento("reject", { id: "T1", from: JID_CLIENTE }), evento("reject", { id: "T2", from: JID_CLIENTE })]);
    assert.equal(chamadas.length, 2);
    assert.deepEqual(chamadas[0].corpo.contato, { jid: JID_CLIENTE, lid: LID, telefone: TELEFONE_CLIENTE });
    assert.deepEqual(chamadas[0].corpo.remetente, { jid: JID_CLIENTE, lid: LID, telefone: TELEFONE_CLIENTE, nome: null });
    assert.equal(socket.consultasOnWhatsApp.length, 1);
    assert.equal(chamadas[1].corpo.contato.lid, LID);
  } finally {
    espiao.restaurar();
  }
});

test("34.2: LID com par aprendido leva os dois; LID sem par vai só com o LID", async () => {
  const { socket, chamadas, emitirCall, espiao } = await adapterConectado();
  try {
    await socket.emitir("contacts.upsert", [{ id: JID_CLIENTE, lid: LID }]);
    await emitirCall(evento("reject", { id: "P1" }));
    await emitirCall(evento("reject", { id: "P2", from: PARTICIPANTE, chatId: PARTICIPANTE }));
    assert.deepEqual(chamadas[0].corpo.contato, { jid: LID, lid: LID, telefone: TELEFONE_CLIENTE });
    assert.deepEqual(chamadas[1].corpo.contato, { jid: PARTICIPANTE, lid: PARTICIPANTE, telefone: null });
  } finally {
    espiao.restaurar();
  }
});

test("34.2: grupo com groupJid → GRUPO (chat do grupo, remetente = participante, nome_chat); sem groupJid → PRIVADO", async () => {
  const { chamadas, emitirCall, espiao } = await adapterConectado();
  try {
    await emitirCall([
      evento("reject", { id: "G1", isGroup: true, groupJid: GRUPO, from: PARTICIPANTE, chatId: GRUPO }),
      evento("reject", { id: "G2", isGroup: true, groupJid: undefined, from: PARTICIPANTE, chatId: GRUPO }),
    ]);
    assert.deepEqual(chamadas[0].corpo, {
      chamada_wa_id: "G1",
      origem: "CLIENTE",
      tipo_chat: "GRUPO",
      chat_jid: GRUPO,
      remetente: { jid: PARTICIPANTE, lid: PARTICIPANTE, telefone: null, nome: null },
      contato: null,
      video: true,
      resultado: "RECUSADA",
      timestamp_wa: chamadas[0].corpo.timestamp_wa,
      nome_chat: "Suporte Loja Centro",
    });
    assert.equal(chamadas[1].corpo.tipo_chat, "PRIVADO");
    assert.equal(chamadas[1].corpo.chat_jid, PARTICIPANTE);
    assert.equal("nome_chat" in chamadas[1].corpo, false);
  } finally {
    espiao.restaurar();
  }
});

test("34.2: grupo sem nome (groupMetadata falha) é registrado sem nome_chat", async () => {
  const { chamadas, emitirCall, espiao } = await adapterConectado({
    groupMetadata: async () => {
      throw new Error("falha");
    },
  });
  try {
    await emitirCall(evento("reject", { id: "G9", isGroup: true, groupJid: GRUPO, from: PARTICIPANTE, chatId: GRUPO }));
    assert.equal(chamadas.length, 1);
    assert.equal("nome_chat" in chamadas[0].corpo, false);
  } finally {
    espiao.restaurar();
  }
});

test("34.2: status, broadcast, o número da equipe e o evento offline fora da janela não geram nada; offline recente gera", async () => {
  const { chamadas, alertas, avancar, emitirCall, espiao } = await adapterConectado();
  try {
    await emitirCall([
      evento("reject", { id: "S1", from: "status@broadcast" }),
      evento("reject", { id: "S2", from: "120363@newsletter" }),
      evento("reject", { id: "S3", from: EU.jid }),
      evento("reject", { id: "S4", from: EU.lid }),
      evento("reject", { id: "O1", offline: true, date: new Date(1_000_000_000_000) }),
      evento("reject", { id: "O2", offline: true, date: "inválida" }),
    ]);
    await avancar(TETO * 2);
    assert.deepEqual([chamadas.length, alertas.length], [0, 0]);
    await emitirCall(evento("reject", { id: "O3", offline: true, date: new Date() }));
    assert.deepEqual(chamadas.map((c) => c.corpo.chamada_wa_id), ["O3"]);
  } finally {
    espiao.restaurar();
  }
});

test("34.2: 404 e 500 do back só vão ao log (sem repetir, sem telefone, JID nem LID); a próxima chamada segue", async () => {
  const { ErroRotaInterna } = require("../../src/services/internoHttpClient");
  let n = 0;
  const { chamadas, emitirCall, espiao } = await adapterConectado({
    registrarChamada: async () => {
      n += 1;
      throw new ErroRotaInterna("Erro ao chamar a rota (HTTP 404) 5511988887777", { rota: "/interno/chamada", tipo: "http", status: n === 1 ? 404 : 500 });
    },
  });
  const cap = capturarConsole();
  try {
    await emitirCall([evento("reject", { id: "L1", from: JID_CLIENTE }), evento("reject", { id: "L2", from: JID_CLIENTE })]);
  } finally {
    cap.restaurar();
    espiao.restaurar();
  }
  assert.equal(chamadas.length, 2, "uma tentativa cada, sem laço de repetição");
  const saida = cap.linhas.join("\n");
  assert.match(saida, /Falha ao registrar a chamada L1 da equipe 41:.*HTTP 404/);
  assert.match(saida, /HTTP 500/);
  assert.doesNotMatch(saida, /5511\d{8,9}|@s\.whatsapp\.net|@lid/);
});

test("34.2: o registro de sucesso loga só equipe, id, origem, resultado e a sequência", async () => {
  const { emitirCall, avancar, espiao } = await adapterConectado();
  const cap = capturarConsole();
  try {
    await emitirCall([evento("offer", { id: "LOG1", from: JID_CLIENTE }), evento("terminate", { id: "LOG1", from: JID_CLIENTE })]);
    await avancar(JANELA);
  } finally {
    cap.restaurar();
    espiao.restaurar();
  }
  const linha = cap.linhas.find((l) => l.includes("[CHAMADA]"));
  assert.equal(linha, "[CHAMADA] Equipe 41: chamada LOG1 registrada (CLIENTE PERDIDA; offer>terminate>PERDIDA).");
  assert.doesNotMatch(cap.linhas.join("\n"), /5511\d{8,9}|@/);
});

test("34.2: o registro da chamada passa pela fila serial da entrada: espera a mensagem anterior", async () => {
  /** @type {() => void} */
  let liberar = () => {};
  const { socket, chamadas, emitirCall, espiao } = await adapterConectado({ registrar: () => new Promise((resolve) => (liberar = () => resolve(undefined))) });
  try {
    socket.emitir("messages.upsert", { type: "notify", messages: [mensagemWa({ conversation: "oi" })] });
    await new Promise((resolve) => setImmediate(resolve));
    await emitirCall(evento("reject", { id: "F1" }));
    assert.equal(chamadas.length, 0, "a fila está ocupada pela mensagem");
    liberar();
    await drenar();
    await new Promise((resolve) => setImmediate(resolve));
    await drenar();
    assert.equal(chamadas.length, 1);
  } finally {
    espiao.restaurar();
  }
});

test("34.2: socket fechado (pararSocket, queda) descarta a janela pendente: nada é publicado depois", async () => {
  const a = await adapterConectado();
  try {
    await a.emitirCall([evento("offer"), evento("terminate")]);
    await a.adapter.pararSocket();
    await a.avancar(TETO * 2);
    assert.equal(a.chamadas.length, 0);
    assert.equal(a.socket.listeners.call, undefined);
  } finally {
    a.espiao.restaurar();
  }
  const b = await adapterConectado();
  try {
    await b.emitirCall([evento("offer", { id: "Q1" }), evento("terminate", { id: "Q1" })]);
    await b.socket.emitir("connection.update", { connection: "close", lastDisconnect: { error: { output: { statusCode: 428 } } } });
    await b.avancar(TETO * 2);
    assert.equal(b.chamadas.length, 0);
    assert.deepEqual(b.alertas.map((x) => x.corpo.situacao), ["TOCANDO", "PAROU"], "só o que já tinha saído antes da queda");
    await b.adapter.pararSocket();
  } finally {
    b.espiao.restaurar();
  }
});

test("34.2: logout pelo aparelho também descarta o que estava pendente", async () => {
  const a = await adapterConectado();
  try {
    await a.emitirCall([evento("offer"), evento("terminate")]);
    await a.socket.emitir("connection.update", { connection: "close", lastDisconnect: { error: { output: { statusCode: baileysFalso.DisconnectReason.loggedOut } } } });
    await a.avancar(TETO * 2);
    assert.equal(a.chamadas.length, 0);
  } finally {
    a.espiao.restaurar();
  }
});

test("34.2 regressão: stub CALL_MISSED_*, message.call e callLogMesssage nunca vão por /interno/mensagem-recebida nem viram chamada", async () => {
  const { socket, mensagens, chamadas, avancar, espiao } = await adapterConectado();
  try {
    const base = { remoteJid: JID_CLIENTE, fromMe: false };
    await socket.emitir("messages.upsert", {
      type: "notify",
      messages: [
        { key: { ...base, id: "3EB0STUB01" }, messageStubType: 40, messageTimestamp: 1760000000 },
        { key: { ...base, id: "3EB0STUB02" }, messageStubType: 41, messageTimestamp: 1760000000 },
        { key: { ...base, id: "3EB0CALL01" }, message: { call: { callKey: Buffer.from("k") } }, messageTimestamp: 1760000000 },
        { key: { ...base, fromMe: true, id: "3EB0LOG001" }, message: { callLogMesssage: { callOutcome: 1, isVideo: false } }, messageTimestamp: 1760000000 },
        { key: { ...base, fromMe: true, id: "3EB0LOG002" }, message: { ephemeralMessage: { message: { callLogMesssage: { callOutcome: 0, durationSecs: 5 } } } }, messageTimestamp: 1760000000 },
      ],
    });
    await drenar();
    await avancar(TETO);
    assert.deepEqual([mensagens.length, chamadas.length], [0, 0]);
    assert.deepEqual(espiao.efeitos, []);
  } finally {
    espiao.restaurar();
  }
});

test("34.2: o diagnóstico fica no código e desligado por padrão: o call não gera linha [DIAG-CHAMADA]", async () => {
  const original = process.env.DIAGNOSTICO_CHAMADAS;
  delete process.env.DIAGNOSTICO_CHAMADAS;
  const { emitirCall, espiao } = await adapterConectado();
  const cap = capturarConsole();
  try {
    await emitirCall(evento("reject", { id: "D1" }));
  } finally {
    cap.restaurar();
    espiao.restaurar();
    if (original !== undefined) process.env.DIAGNOSTICO_CHAMADAS = original;
  }
  assert.equal(cap.linhas.filter((l) => l.includes("[DIAG-CHAMADA]")).length, 0);
});

test("34.2/34.6: logout pelo aparelho com a chamada tocando: nenhum alerta nem registro é publicado depois", async () => {
  const a = await adapterConectado();
  try {
    await a.emitirCall([evento("offer", { id: "LO1" }), evento("offer", { id: "LO2" }), evento("terminate", { id: "LO2" })]);
    assert.deepEqual(a.alertas.map((x) => `${x.corpo.chamada_wa_id}:${x.corpo.situacao}`), ["LO1:TOCANDO", "LO2:TOCANDO", "LO2:PAROU"]);
    await a.socket.emitir("connection.update", { connection: "close", lastDisconnect: { error: { output: { statusCode: baileysFalso.DisconnectReason.loggedOut } } } });
    await a.avancar(TETO * 2);
    await a.socket.emitir("call", [evento("reject", { id: "LO1" }), evento("accept", { id: "LO2" })]); // eventos tardios do socket antigo
    await a.avancar(TETO);
    assert.equal(a.alertas.length, 3, "nenhum PAROU nem TOCANDO novo");
    assert.equal(a.chamadas.length, 0, "nenhum registro (nem ENCERRADA do teto, nem PERDIDA da janela)");
    assert.equal(a.socket.listeners.call, undefined);
  } finally {
    a.espiao.restaurar();
  }
});

test("34.2/34.6: reabrir o socket deixa um único listener de call, e a chamada nova gera um TOCANDO e um registro só", async () => {
  const a = await adapterConectado();
  try {
    const antigo = a.socket;
    assert.equal(antigo.registrosOn.call, 1);
    await a.adapter.iniciar(); // segundo iniciar(): fecha o socket anterior e abre outro
    const novo = /** @type {any} */ (ultimoSocket());
    assert.notEqual(novo, antigo);
    assert.ok(antigo.removidos.includes("call"), "o listener do socket antigo saiu");
    assert.equal(antigo.listeners.call, undefined);
    assert.equal(novo.registrosOn.call, 1, "um único listener de call no socket novo");
    novo.user = { id: EU.jid, lid: EU.lid };
    novo.onWhatsApp = async () => [];
    await novo.emitir("connection.update", { connection: "open" });
    const espiaoNovo = espiarSaidas(novo);
    try {
      await antigo.emitir("call", [evento("offer", { id: "DUP0" })]); // sem listener: nada
      await novo.emitir("call", [evento("offer", { id: "DUP1" }), evento("reject", { id: "DUP1" })]);
      await drenar();
      await a.avancar(TETO);
      assert.deepEqual(a.alertas.map((x) => `${x.corpo.chamada_wa_id}:${x.corpo.situacao}`), ["DUP1:TOCANDO", "DUP1:PAROU"]);
      assert.deepEqual(a.chamadas.map((c) => [c.corpo.chamada_wa_id, c.corpo.resultado]), [["DUP1", "RECUSADA"]]);
      assert.deepEqual(espiaoNovo.efeitos, []);
    } finally {
      espiaoNovo.restaurar();
    }
    await a.adapter.pararSocket();
  } finally {
    a.espiao.restaurar();
  }
});

test("34.2: tabela de chamadas cheia loga só equipe e motivo, sem id", async () => {
  const adapter = criarAdapter({
    codEquipe: "41",
    hashEmpresa: "hash-chamadas",
    diretorioSessoes,
    registrarChamada: async () => ({}),
    alertarChamada: async () => ({}),
    opcoesChamadas: { maxPendentes: 1, agendar: () => () => {} },
  });
  await adapter.iniciar();
  const socket = /** @type {any} */ (ultimoSocket());
  socket.user = { id: EU.jid, lid: EU.lid };
  await socket.emitir("connection.update", { connection: "open" });
  const cap = capturarConsole();
  try {
    await socket.emitir("call", [evento("offer", { id: "CHEIA1" }), evento("offer", { id: "CHEIA2" })]);
    await drenar();
  } finally {
    cap.restaurar();
  }
  const linha = cap.linhas.find((l) => l.includes("tabela de chamadas"));
  assert.equal(linha, "[CHAMADA] Equipe 41: tabela de chamadas abertas cheia (TABELA_CHEIA); a mais antiga foi encerrada.");
  await adapter.pararSocket();
});

// ---- Task 34.6: alerta tocando / parou ----

test("34.6: offer em tempo real → UM TOCANDO na hora, antes de qualquer registro e com a fila de entrada ocupada", async () => {
  /** @type {() => void} */
  let liberar = () => {};
  const { socket, alertas, chamadas, emitirCall, espiao } = await adapterConectado({ registrar: () => new Promise((resolve) => (liberar = () => resolve(undefined))) });
  try {
    socket.emitir("messages.upsert", { type: "notify", messages: [mensagemWa({ conversation: "download lento" })] });
    await new Promise((resolve) => setImmediate(resolve));
    await emitirCall([evento("offer"), evento("offer"), evento("ringing")]);
    assert.equal(alertas.length, 1);
    assert.equal(chamadas.length, 0);
    assert.deepEqual(alertas[0].contexto, { hash_empresa: "hash-chamadas", cod_equipe: "41" });
    liberar();
    await drenar();
  } finally {
    espiao.restaurar();
  }
});

test("34.6: o corpo do TOCANDO tem só identificadores: LID sem telefone, sem nome, sem nome_chat e sem onWhatsApp", async () => {
  const { socket, alertas, emitirCall, espiao } = await adapterConectado();
  try {
    await emitirCall(evento("offer", { id: "T1", isVideo: false }));
    await emitirCall(evento("offer", { id: "T2", from: JID_CLIENTE }));
    await emitirCall(evento("offer", { id: "T3", isGroup: true, groupJid: GRUPO, from: PARTICIPANTE, chatId: GRUPO }));
    assert.deepEqual(alertas[0].corpo, {
      chamada_wa_id: "T1",
      situacao: "TOCANDO",
      tipo_chat: "PRIVADO",
      chat_jid: LID,
      remetente: { jid: LID, lid: LID, telefone: null, nome: null },
      contato: { jid: LID, lid: LID, telefone: null },
      video: false,
    });
    assert.deepEqual(alertas[1].corpo.contato, { jid: JID_CLIENTE, lid: null, telefone: TELEFONE_CLIENTE }, "sem LID no cache, o alerta vai sem LID");
    assert.deepEqual(
      { t: alertas[2].corpo.tipo_chat, c: alertas[2].corpo.chat_jid, k: alertas[2].corpo.contato, r: alertas[2].corpo.remetente.jid, nome: "nome_chat" in alertas[2].corpo },
      { t: "GRUPO", c: GRUPO, k: null, r: PARTICIPANTE, nome: false },
    );
    for (const a of alertas) assert.equal(JSON.stringify(a.corpo).includes("nome\":\"") || JSON.stringify(a.corpo).includes("Suporte"), false);
    assert.deepEqual(socket.consultasOnWhatsApp, []);
  } finally {
    espiao.restaurar();
  }
});

test("34.6: terminate → um PAROU na hora; o accept que chega depois não gera outro e o registro ATENDIDA segue", async () => {
  const { alertas, chamadas, avancar, emitirCall, espiao } = await adapterConectado();
  try {
    await emitirCall([evento("offer"), evento("terminate")]);
    assert.deepEqual(alertas.map((a) => a.corpo.situacao), ["TOCANDO", "PAROU"]);
    assert.deepEqual(alertas[1].corpo, { chamada_wa_id: "CALLID1", situacao: "PAROU" });
    assert.equal(chamadas.length, 0, "o registro espera a janela");
    await avancar(JANELA - 1000);
    await emitirCall({ ...evento("accept"), chatId: EU.jid });
    assert.deepEqual(alertas.map((a) => a.corpo.situacao), ["TOCANDO", "PAROU"]);
    assert.deepEqual(chamadas.map((c) => c.corpo.resultado), ["ATENDIDA"]);
  } finally {
    espiao.restaurar();
  }
});

test("34.6: reject → PAROU; teto sem desfecho → PAROU", async () => {
  const { alertas, avancar, emitirCall, espiao } = await adapterConectado();
  try {
    await emitirCall([evento("offer", { id: "J1" }), evento("reject", { id: "J1" }), evento("terminate", { id: "J1" })]);
    await emitirCall(evento("offer", { id: "J2" }));
    await avancar(TETO);
    assert.deepEqual(alertas.map((a) => [a.corpo.chamada_wa_id, a.corpo.situacao]), [
      ["J1", "TOCANDO"],
      ["J1", "PAROU"],
      ["J2", "TOCANDO"],
      ["J2", "PAROU"],
    ]);
  } finally {
    espiao.restaurar();
  }
});

test("34.6: TOCANDO lento → o PAROU sai depois da resposta dele, nunca antes", async () => {
  /** @type {(() => void)[]} */
  const liberar = [];
  const { alertas, emitirCall, espiao } = await adapterConectado({
    alertarChamada: (corpo) => (corpo.situacao === "TOCANDO" ? new Promise((resolve) => liberar.push(() => resolve({ msg: "ok" }))) : Promise.resolve({ msg: "ok" })),
  });
  try {
    await emitirCall([evento("offer"), evento("reject")]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(alertas.map((a) => a.corpo.situacao), ["TOCANDO"], "PAROU ainda espera");
    liberar[0]();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(alertas.map((a) => a.corpo.situacao), ["TOCANDO", "PAROU"]);
  } finally {
    espiao.restaurar();
  }
});

test("34.6: falha ou prazo do TOCANDO só vão ao log: o PAROU sai e o registro não é afetado", async () => {
  const { ErroRotaInterna } = require("../../src/services/internoHttpClient");
  const { alertas, chamadas, emitirCall, espiao } = await adapterConectado({
    alertarChamada: async (corpo) => {
      if (corpo.situacao === "TOCANDO") throw new ErroRotaInterna("Tempo esgotado ao chamar a rota 5511988887777", { rota: "/interno/chamada-alerta", tipo: "timeout" });
      return { msg: "ok" };
    },
  });
  const cap = capturarConsole();
  try {
    await emitirCall([evento("offer", { from: JID_CLIENTE }), evento("reject", { from: JID_CLIENTE })]);
    await new Promise((resolve) => setTimeout(resolve, 20));
  } finally {
    cap.restaurar();
    espiao.restaurar();
  }
  assert.deepEqual(alertas.map((a) => a.corpo.situacao), ["TOCANDO", "PAROU"]);
  assert.deepEqual(chamadas.map((c) => c.corpo.resultado), ["RECUSADA"]);
  const saida = cap.linhas.join("\n");
  assert.match(saida, /Falha no alerta TOCANDO da chamada CALLID1 da equipe 41: ErroRotaInterna timeout/);
  assert.doesNotMatch(saida, /5511\d{8,9}|@/);
});

test("34.6: offer offline (dentro da janela de recuperação) não gera alerta; o registro segue a 34.2", async () => {
  const { alertas, chamadas, avancar, emitirCall, espiao } = await adapterConectado();
  try {
    await emitirCall([evento("offer", { offline: true }), evento("terminate", { offline: true })]);
    await avancar(JANELA);
    assert.equal(alertas.length, 0);
    assert.deepEqual(chamadas.map((c) => c.corpo.resultado), ["PERDIDA"]);
  } finally {
    espiao.restaurar();
  }
});

test("34.6: depois de logout, desconexão ou troca de socket, nenhum alerta é publicado", async () => {
  /** @type {(() => void)[]} */
  const liberar = [];
  const a = await adapterConectado({
    alertarChamada: (corpo) => (corpo.situacao === "TOCANDO" ? new Promise((resolve) => liberar.push(() => resolve({ msg: "ok" }))) : Promise.resolve({ msg: "ok" })),
  });
  try {
    await a.emitirCall([evento("offer", { id: "Z1" }), evento("reject", { id: "Z1" })]);
    assert.deepEqual(a.alertas.map((x) => x.corpo.situacao), ["TOCANDO"]);
    await a.socket.emitir("connection.update", { connection: "close", lastDisconnect: { error: { output: { statusCode: 428 } } } });
    liberar[0]();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(a.alertas.map((x) => x.corpo.situacao), ["TOCANDO"], "o PAROU pendente foi descartado");
    // evento atrasado do socket antigo
    await a.socket.emitir("call", [evento("offer", { id: "Z2" })]);
    assert.equal(a.alertas.length, 1);
    await a.adapter.pararSocket();
  } finally {
    a.espiao.restaurar();
  }
});

test("34.6: nunca chama rejectCall nem sendMessage, e o alerta não usa o fetch por fora do cliente injetado", async () => {
  const { emitirCall, avancar, espiao } = await adapterConectado();
  try {
    await emitirCall([evento("offer"), evento("terminate")]);
    await avancar(JANELA);
    assert.deepEqual(espiao.efeitos, []);
    assert.ok(TELEFONE_EQUIPE);
  } finally {
    espiao.restaurar();
  }
});
