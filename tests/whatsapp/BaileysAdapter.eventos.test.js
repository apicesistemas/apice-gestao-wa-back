// @ts-check
// Ligação dos eventos de recibo, presença e grupo no adapter (socket Baileys mockado): recibos →
// `/interno/mensagem-status`, presença → `/interno/presenca`, inscrição de presença por chat e
// `nome_chat` do grupo no registro. Os clientes do back são funções falsas injetadas.
const { test, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const baileysFalso = require("../helpers/baileysFalso");

baileysFalso.instalarBaileysFalso();
const { criarAdapter } = require("../../src/whatsapp/BaileysAdapter");
const { mensagemWa, mensagemGrupo, JID_CLIENTE, JID_GRUPO, JID_PARTICIPANTE, EU, TELEFONE_EQUIPE } = require("../helpers/mensagensWa");

const { ultimoSocket, drenar } = baileysFalso;
const diretorioSessoes = fs.mkdtempSync(path.join(os.tmpdir(), "wa-back-eventos-"));
after(() => fs.rmSync(diretorioSessoes, { recursive: true, force: true }));
beforeEach(() => baileysFalso.limparHistorico());

const READ = 4;
const DELIVERY_ACK = 3;

/**
 * @param {{ groupMetadata?: (jid: string) => Promise<any>, registrar?: () => Promise<unknown> }} [opcoes]
 */
async function adapterConectado({ groupMetadata, registrar } = {}) {
  /** @type {any[]} */
  const registradas = [];
  /** @type {{ mensagem_wa_id: string, status: string, contexto: any }[]} */
  const status = [];
  /** @type {{ dados: any, contexto: any }[]} */
  const presencas = [];
  const adapter = criarAdapter({
    codEquipe: "31",
    hashEmpresa: "hash-eventos",
    diretorioSessoes,
    registrarMensagem: async (mensagem) => {
      registradas.push(mensagem);
      if (registrar) await registrar();
    },
    registrarStatusMensagem: async (mensagem_wa_id, s, contexto) => void status.push({ mensagem_wa_id, status: s, contexto }),
    registrarPresenca: async (dados, contexto) => void presencas.push({ dados, contexto }),
  });
  await adapter.iniciar();
  const socket = /** @type {any} */ (ultimoSocket());
  socket.user = { id: EU.jid, lid: EU.lid };
  socket.onWhatsApp = async () => [];
  /** @type {string[]} */
  socket.inscritos = [];
  socket.presenceSubscribe = async (/** @type {string} */ jid) => void socket.inscritos.push(jid);
  socket.groupMetadata = groupMetadata || (async (/** @type {string} */ jid) => ({ id: jid, subject: "Suporte Loja Centro" }));
  await socket.emitir("connection.update", { connection: "open" });
  /** @param {string} evento @param {any} dado */
  const emitir = async (evento, dado) => {
    await socket.emitir(evento, dado);
    await drenar();
  };
  return { adapter, socket, registradas, status, presencas, emitir };
}

test("messages.update com READ de uma mensagem enviada vira LIDA no back, com o tenant e a equipe", async () => {
  const { status, emitir } = await adapterConectado();
  await emitir("messages.update", [
    { key: { remoteJid: JID_CLIENTE, fromMe: true, id: "3EB0ENVIADA1" }, update: { status: READ } },
    { key: { remoteJid: JID_CLIENTE, fromMe: true, id: "3EB0ENVIADA1" }, update: { status: READ } },
    { key: { remoteJid: JID_CLIENTE, fromMe: true, id: "3EB0SEMSTATUS" }, update: { starred: true } },
  ]);
  assert.deepEqual(status, [{ mensagem_wa_id: "3EB0ENVIADA1", status: "LIDA", contexto: { hash_empresa: "hash-eventos", cod_equipe: "31" } }]);
});

test("message-receipt.update de grupo vira ENTREGUE e depois LIDA; o recibo da própria equipe é ignorado", async () => {
  const { status, emitir } = await adapterConectado();
  const key = { remoteJid: JID_GRUPO, fromMe: true, id: "3EB0GRUPO1", participant: JID_PARTICIPANTE };
  await emitir("message-receipt.update", [{ key, receipt: { userJid: JID_PARTICIPANTE, receiptTimestamp: 1 } }]);
  await emitir("message-receipt.update", [{ key, receipt: { userJid: "5511900000099@s.whatsapp.net", readTimestamp: 2 } }]);
  await emitir("message-receipt.update", [{ key, receipt: { userJid: JID_PARTICIPANTE, readTimestamp: 3 } }]);
  assert.deepEqual(status.map((s) => s.status), ["ENTREGUE", "LIDA"]);
});

test("o recibo nunca passa na frente do registro da mensagem (mesma fila serial da entrada)", async () => {
  /** @type {string[]} */
  const ordem = [];
  /** @type {() => void} */
  let liberar = () => {};
  const { socket, status } = await adapterConectado({
    registrar: () =>
      new Promise((resolve) => {
        ordem.push("registro-iniciado");
        liberar = () => {
          ordem.push("registro-concluido");
          resolve(undefined);
        };
      }),
  });
  const msg = mensagemWa({ conversation: "respondi pelo celular" }, { key: { fromMe: true }, pushName: null });
  socket.emitir("messages.upsert", { messages: [msg], type: "append" });
  await drenar();
  socket.emitir("messages.update", [{ key: { ...msg.key }, update: { status: DELIVERY_ACK } }]);
  await drenar();
  assert.equal(status.length, 0, "o recibo espera o registro");
  liberar();
  await drenar();
  assert.deepEqual(ordem, ["registro-iniciado", "registro-concluido"]);
  assert.deepEqual(status.map((s) => [s.mensagem_wa_id, s.status]), [[msg.key.id, "ENTREGUE"]]);
});

test("presence.update do cliente vai ao back só na mudança; a da própria equipe não vai", async () => {
  const { presencas, emitir } = await adapterConectado();
  await emitir("presence.update", { id: JID_CLIENTE, presences: { [JID_CLIENTE]: { lastKnownPresence: "composing" } } });
  await emitir("presence.update", { id: JID_CLIENTE, presences: { [JID_CLIENTE]: { lastKnownPresence: "composing" } } });
  await emitir("presence.update", { id: JID_GRUPO, presences: { [EU.jid]: { lastKnownPresence: "composing" } } });
  await emitir("presence.update", { id: JID_CLIENTE, presences: { [JID_CLIENTE]: { lastKnownPresence: "available" } } });
  assert.deepEqual(
    presencas.map((p) => p.dados),
    [
      { chat_jid: JID_CLIENTE, participante_jid: null, estado: "DIGITANDO" },
      { chat_jid: JID_CLIENTE, participante_jid: null, estado: "PARADO" },
    ]
  );
  assert.deepEqual(presencas[0].contexto, { hash_empresa: "hash-eventos", cod_equipe: "31" });
});

test("a primeira mensagem de um chat inscreve a presença dele, uma vez só; o socket novo (reconexão) inscreve de novo", async () => {
  const { socket, emitir } = await adapterConectado();
  await emitir("messages.upsert", { messages: [mensagemWa({ conversation: "oi" })], type: "notify" });
  await emitir("messages.upsert", { messages: [mensagemWa({ conversation: "tudo bem?" })], type: "notify" });
  await emitir("messages.upsert", { messages: [mensagemGrupo({ conversation: "bom dia" })], type: "notify" });
  assert.deepEqual(socket.inscritos, [JID_CLIENTE, JID_GRUPO]);

  await emitir("connection.update", { connection: "open" });
  await emitir("messages.upsert", { messages: [mensagemWa({ conversation: "voltei" })], type: "notify" });
  assert.deepEqual(socket.inscritos, [JID_CLIENTE, JID_GRUPO, JID_CLIENTE]);
});

test("mensagem de grupo vai ao back com nome_chat (subject); privada vai sem nome_chat", async () => {
  let consultas = 0;
  const { registradas, emitir } = await adapterConectado({
    groupMetadata: async (jid) => {
      consultas += 1;
      return { id: jid, subject: "Suporte Loja Centro" };
    },
  });
  await emitir("messages.upsert", { messages: [mensagemGrupo({ conversation: "bom dia" })], type: "notify" });
  await emitir("messages.upsert", { messages: [mensagemGrupo({ conversation: "alguém?" })], type: "notify" });
  await emitir("messages.upsert", { messages: [mensagemWa({ conversation: "oi" })], type: "notify" });
  assert.equal(registradas[0].nome_chat, "Suporte Loja Centro");
  assert.equal(registradas[1].nome_chat, "Suporte Loja Centro");
  assert.equal(consultas, 1, "o subject vem do cache na segunda mensagem");
  assert.equal("nome_chat" in registradas[2], false);
});

test("falha no groupMetadata não perde nem impede a mensagem de grupo: vai sem nome_chat", async () => {
  const { registradas, emitir } = await adapterConectado({
    groupMetadata: async () => {
      throw new Error("item-not-found");
    },
  });
  await emitir("messages.upsert", { messages: [mensagemGrupo({ conversation: "bom dia" })], type: "notify" });
  assert.equal(registradas.length, 1);
  assert.equal("nome_chat" in registradas[0], false);
});

test("groups.update com subject novo vale para as mensagens seguintes", async () => {
  const { registradas, emitir } = await adapterConectado();
  await emitir("messages.upsert", { messages: [mensagemGrupo({ conversation: "bom dia" })], type: "notify" });
  await emitir("groups.update", [{ id: JID_GRUPO, subject: "Suporte Loja Norte" }]);
  await emitir("messages.upsert", { messages: [mensagemGrupo({ conversation: "mudamos o nome" })], type: "notify" });
  assert.deepEqual(registradas.map((m) => m.nome_chat), ["Suporte Loja Centro", "Suporte Loja Norte"]);
});

test("os listeners de recibo, presença e grupo saem com o socket (pararSocket)", async () => {
  const { adapter, socket } = await adapterConectado();
  await adapter.pararSocket();
  for (const evento of ["messages.update", "message-receipt.update", "presence.update", "groups.update"]) {
    assert.ok(socket.removidos.includes(evento), `${evento} removido`);
  }
});

test("recibo de um id enviado pelo CRM só vai ao back depois do atraso; o socketConectado só existe com a equipe CONECTADA", async () => {
  const original = process.env.RECIBO_ATRASO_ENVIO_MS;
  process.env.RECIBO_ATRASO_ENVIO_MS = "40";
  try {
    const { adapter, socket, status, emitir } = await adapterConectado();
    assert.equal(adapter.socketConectado(), socket);
    adapter.marcarEnviadaPeloCrm("3EB0DOCRM1");
    await emitir("messages.update", [{ key: { remoteJid: JID_CLIENTE, fromMe: true, id: "3EB0DOCRM1" }, update: { status: DELIVERY_ACK } }]);
    assert.equal(status.length, 0);
    await new Promise((resolve) => setTimeout(resolve, 80));
    await drenar();
    assert.deepEqual(status.map((s) => [s.mensagem_wa_id, s.status]), [["3EB0DOCRM1", "ENTREGUE"]]);

    await socket.emitir("connection.update", { connection: "close", lastDisconnect: { error: { output: { statusCode: 428 } } } });
    assert.equal(adapter.socketConectado(), null);
    await adapter.pararSocket();
  } finally {
    if (original === undefined) delete process.env.RECIBO_ATRASO_ENVIO_MS;
    else process.env.RECIBO_ATRASO_ENVIO_MS = original;
  }
});

// ---- Task 17.1: menções detalhadas (mencoes_detalhe) e participantes do grupo ----

const LID_MENCIONADO = "10000000000001@lid";
const TELEFONE_MENCIONADO = "5511900000003";
const JID_EQUIPE_LID = "100000000000099@lid";

/** Captura o console durante o teste: nenhum JID, LID ou telefone pode aparecer nele. */
function capturarConsole() {
  /** @type {string[]} */
  const linhas = [];
  const originais = { log: console.log, error: console.error };
  const gravar = (/** @type {any[]} */ ...args) => void linhas.push(args.map(String).join(" "));
  console.log = gravar;
  console.error = gravar;
  return {
    linhas,
    restaurar() {
      console.log = originais.log;
      console.error = originais.error;
    },
  };
}

test("regressão do print: menção por LID com par conhecido vai com mencoes igual a hoje e mencoes_detalhe com o telefone", async () => {
  const { registradas, emitir } = await adapterConectado();
  await emitir("contacts.upsert", [{ id: LID_MENCIONADO, lid: LID_MENCIONADO, jid: `${TELEFONE_MENCIONADO}@s.whatsapp.net` }]);
  const msg = mensagemGrupo(
    { extendedTextMessage: { text: "@10000000000001 pode ver?", contextInfo: { mentionedJid: [LID_MENCIONADO] } } },
    { key: { fromMe: true, participant: undefined, participantLid: undefined } }
  );
  await emitir("messages.upsert", { messages: [msg], type: "notify" });
  assert.equal(registradas.length, 1);
  assert.equal(registradas[0].origem, "APARELHO");
  assert.deepEqual(registradas[0].mencoes, [LID_MENCIONADO]);
  assert.deepEqual(registradas[0].mencoes_detalhe, [{ jid: LID_MENCIONADO, lid: LID_MENCIONADO, telefone: TELEFONE_MENCIONADO, propria: false }]);
});

test("o par pode vir dos participantes do groupMetadata (a mesma consulta do nome, uma só)", async () => {
  let consultas = 0;
  const { registradas, emitir } = await adapterConectado({
    groupMetadata: async (jid) => {
      consultas += 1;
      return {
        id: jid,
        subject: "Suporte Loja Centro",
        addressingMode: "lid",
        participants: [{ id: LID_MENCIONADO, lid: LID_MENCIONADO, jid: `${TELEFONE_MENCIONADO}@s.whatsapp.net`, admin: null }],
      };
    },
  });
  const conteudo = { extendedTextMessage: { text: "@10000000000001", contextInfo: { mentionedJid: [LID_MENCIONADO] } } };
  await emitir("messages.upsert", { messages: [mensagemGrupo(conteudo)], type: "notify" });
  await emitir("messages.upsert", { messages: [mensagemGrupo(conteudo)], type: "notify" });
  assert.deepEqual(registradas[0].mencoes_detalhe, [{ jid: LID_MENCIONADO, lid: LID_MENCIONADO, telefone: TELEFONE_MENCIONADO, propria: false }]);
  assert.equal(registradas[0].nome_chat, "Suporte Loja Centro");
  assert.equal(consultas, 1, "nome e participantes saem da mesma consulta, e a segunda mensagem usa o cache");
});

test("menção ao número da própria equipe (LID ou telefone) vem com propria: true", async () => {
  const { registradas, emitir } = await adapterConectado();
  const msg = mensagemGrupo({
    extendedTextMessage: { text: "@equipe @outro", contextInfo: { mentionedJid: [JID_EQUIPE_LID, `${TELEFONE_EQUIPE}@s.whatsapp.net`, LID_MENCIONADO] } },
  });
  await emitir("messages.upsert", { messages: [msg], type: "notify" });
  const detalhe = registradas[0].mencoes_detalhe;
  assert.deepEqual(detalhe.map((/** @type {any} */ d) => d.propria), [true, true, false]);
});

test("menção sem par conhecido: telefone null e a mensagem é registrada normalmente", async () => {
  const { registradas, emitir } = await adapterConectado();
  await emitir("messages.upsert", {
    messages: [mensagemGrupo({ extendedTextMessage: { text: "@10000000000001", contextInfo: { mentionedJid: [LID_MENCIONADO] } } })],
    type: "notify",
  });
  assert.equal(registradas.length, 1);
  assert.deepEqual(registradas[0].mencoes, [LID_MENCIONADO]);
  assert.deepEqual(registradas[0].mencoes_detalhe, [{ jid: LID_MENCIONADO, lid: LID_MENCIONADO, telefone: null, propria: false }]);
});

test("groupMetadata que falha não impede o registro: mencoes_detalhe segue sem o telefone", async () => {
  const { registradas, emitir } = await adapterConectado({
    groupMetadata: async () => {
      throw new Error("rate-overlimit");
    },
  });
  await emitir("messages.upsert", {
    messages: [mensagemGrupo({ extendedTextMessage: { text: "@x", contextInfo: { mentionedJid: [LID_MENCIONADO] } } })],
    type: "notify",
  });
  assert.equal(registradas.length, 1);
  assert.equal(registradas[0].mencoes_detalhe[0].telefone, null);
});

test("mensagem sem menções vai sem mencoes_detalhe", async () => {
  const { registradas, emitir } = await adapterConectado();
  await emitir("messages.upsert", { messages: [mensagemGrupo({ conversation: "bom dia" })], type: "notify" });
  assert.deepEqual(registradas[0].mencoes, []);
  assert.equal("mencoes_detalhe" in registradas[0], false);
});

test("a edição com menção também leva mencoes_detalhe", async () => {
  const { registradas, emitir } = await adapterConectado();
  await emitir("contacts.upsert", [{ id: LID_MENCIONADO, lid: LID_MENCIONADO, jid: `${TELEFONE_MENCIONADO}@s.whatsapp.net` }]);
  const edicao = mensagemGrupo({
    protocolMessage: {
      type: 14,
      key: { id: "3EB0ALVOEDIT01" },
      editedMessage: { extendedTextMessage: { text: "@10000000000001 corrigido", contextInfo: { mentionedJid: [LID_MENCIONADO] } } },
    },
  });
  await emitir("messages.upsert", { messages: [edicao], type: "notify" });
  assert.equal(registradas[0].tipo, "EDICAO");
  assert.deepEqual(registradas[0].mencoes_detalhe, [{ jid: LID_MENCIONADO, lid: LID_MENCIONADO, telefone: TELEFONE_MENCIONADO, propria: false }]);
});

test("group-participants.update esquece o grupo: a próxima mensagem consulta o groupMetadata de novo", async () => {
  let consultas = 0;
  const { registradas, emitir } = await adapterConectado({
    groupMetadata: async (jid) => {
      consultas += 1;
      return { id: jid, subject: "Suporte", participants: [] };
    },
  });
  const conteudo = { extendedTextMessage: { text: "@x", contextInfo: { mentionedJid: [LID_MENCIONADO] } } };
  await emitir("messages.upsert", { messages: [mensagemGrupo(conteudo)], type: "notify" });
  await emitir("messages.upsert", { messages: [mensagemGrupo(conteudo)], type: "notify" });
  assert.equal(consultas, 1);
  await emitir("group-participants.update", { id: JID_GRUPO, participants: [LID_MENCIONADO], action: "add" });
  await emitir("messages.upsert", { messages: [mensagemGrupo(conteudo)], type: "notify" });
  assert.equal(consultas, 2);
  assert.equal(registradas.length, 3);
});

test("o listener de group-participants.update sai com o socket", async () => {
  const { adapter, socket } = await adapterConectado();
  await adapter.pararSocket();
  assert.ok(socket.removidos.includes("group-participants.update"));
});

test("a entrada com menção não escreve JID, LID nem telefone no console", async () => {
  const captura = capturarConsole();
  try {
    const { emitir } = await adapterConectado({
      groupMetadata: async () => {
        throw Object.assign(new Error(`falha ${LID_MENCIONADO} ${TELEFONE_MENCIONADO}`), { name: "Boom" });
      },
    });
    await emitir("messages.upsert", {
      messages: [mensagemGrupo({ extendedTextMessage: { text: "@x", contextInfo: { mentionedJid: [LID_MENCIONADO] } } })],
      type: "notify",
    });
  } finally {
    captura.restaurar();
  }
  const tudo = captura.linhas.join("\n");
  assert.doesNotMatch(tudo, /10000000000001|5511900000003|@lid|@s\.whatsapp\.net/);
});

for (const [nome, no, extra] of /** @type {[string, string, any][]} */ ([
  ["imagem", "imageMessage", {}],
  ["vídeo", "videoMessage", {}],
  ["documento", "documentMessage", {}],
  ["documento com legenda (envelope)", "documentWithCaptionMessage", {}],
])) {
  test(`edição da legenda de ${nome} com menção chega ao back com mencoes e mencoes_detalhe`, async () => {
    const { registradas, emitir } = await adapterConectado();
    await emitir("contacts.upsert", [{ id: LID_MENCIONADO, lid: LID_MENCIONADO, jid: `${TELEFONE_MENCIONADO}@s.whatsapp.net` }]);
    const legenda = { caption: "@10000000000001 legenda corrigida", contextInfo: { mentionedJid: [LID_MENCIONADO] }, ...extra };
    const editedMessage = no === "documentWithCaptionMessage" ? { documentWithCaptionMessage: { message: { documentMessage: legenda } } } : { [no]: legenda };
    const edicao = mensagemGrupo({ protocolMessage: { type: 14, key: { id: "3EB0ALVOLEGEND1" }, editedMessage } });
    await emitir("messages.upsert", { messages: [edicao], type: "notify" });
    assert.equal(registradas[0].tipo, "EDICAO");
    assert.equal(registradas[0].legenda, "@10000000000001 legenda corrigida");
    assert.deepEqual(registradas[0].mencoes, [LID_MENCIONADO]);
    assert.deepEqual(registradas[0].mencoes_detalhe, [{ jid: LID_MENCIONADO, lid: LID_MENCIONADO, telefone: TELEFONE_MENCIONADO, propria: false }]);
  });
}
