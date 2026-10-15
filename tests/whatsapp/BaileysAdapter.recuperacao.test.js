// @ts-check
// Task 14.3 no adapter: as mensagens entregues pelo Baileys na reconexão (`append` da fila offline)
// passam pelo MESMO pipeline do `notify` e são registradas uma única vez (sem refazer download de
// mídia); o `getMessage` atende o pedido de reenvio só com o que está no cache; o `pararSocket` do
// desligamento espera o `saveCreds` em andamento e nunca faz logout. Socket Baileys falso, sem rede.
const { test, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");
const baileysFalso = require("../helpers/baileysFalso");

baileysFalso.instalarBaileysFalso();
const { criarAdapter } = require("../../src/whatsapp/BaileysAdapter");
const { criarArmazemAtividade, FOLGA_RECUPERACAO_S } = require("../../src/whatsapp/recuperacao");
const { mensagemWa, long, EU, JID_CLIENTE, LID_CLIENTE } = require("../helpers/mensagensWa");
const arquivos = require("../helpers/arquivosMidia");

const { ultimoSocket, drenar, definirDownload, definirSaveCreds, DisconnectReason } = baileysFalso;

const diretorioSessoes = fs.mkdtempSync(path.join(os.tmpdir(), "wa-back-recuperacao-adapter-"));
after(() => fs.rmSync(diretorioSessoes, { recursive: true, force: true }));

beforeEach(() => baileysFalso.limparHistorico());

const agoraS = () => Math.floor(Date.now() / 1000);

/** @param {number} statusCode */
const fechamento = (statusCode) => ({
  connection: "close",
  lastDisconnect: { error: Object.assign(new Error("Connection Failure"), { output: { statusCode } }) },
});

/**
 * Adapter com registro e mídia trocados por falsos.
 * @param {{
 *   codEquipe?: string,
 *   registrar?: (mensagem: any) => Promise<unknown>,
 *   armazemAtividade?: ReturnType<typeof criarArmazemAtividade>,
 *   janelaRecuperacaoMs?: number,
 * }} [opcoes]
 */
function novoAdapter({ codEquipe = "31", registrar, armazemAtividade, janelaRecuperacaoMs } = {}) {
  /** @type {string[]} */
  const registradas = [];
  /** @type {string[]} */
  const midias = [];
  const adapter = criarAdapter({
    codEquipe,
    hashEmpresa: "hash-empresa-teste",
    diretorioSessoes,
    msReconexao: 1,
    armazemAtividade,
    janelaRecuperacaoMs,
    obterLimitesMidia: () => ({ tetoBytes: 1024, prazoMs: 1000 }),
    registrarMensagem: async (mensagem) => {
      if (registrar) await registrar(mensagem);
      registradas.push(mensagem.mensagem_wa_id);
    },
    enviarMidia: async (id) => void midias.push(id),
    enfileirarTranscricao: async () => {},
  });
  return { adapter, registradas, midias };
}

/** Abre o socket atual (connection open) com a identidade da equipe. */
async function abrir() {
  const socket = /** @type {any} */ (ultimoSocket());
  socket.user = { id: EU.jid, lid: EU.lid };
  socket.onWhatsApp = async () => [];
  await socket.emitir("connection.update", { connection: "open" });
  return socket;
}

/**
 * @param {any} socket
 * @param {any[]} messages
 * @param {"notify" | "append"} type
 */
async function receber(socket, messages, type) {
  await socket.emitir("messages.upsert", { messages, type });
  await drenar();
}

test("as mensagens entregues na reconexão são registradas uma única vez (notify antes da queda + append repetido)", async () => {
  const { adapter, registradas } = novoAdapter();
  await adapter.iniciar();
  const primeiro = await abrir();
  const antesDaQueda = mensagemWa({ conversation: "antes da queda" });
  await receber(primeiro, [antesDaQueda], "notify");

  // Queda que não é logout: o adapter reabre o socket sozinho.
  await primeiro.emitir("connection.update", fechamento(DisconnectReason.connectionLost));
  await new Promise((resolve) => setTimeout(resolve, 10));
  await drenar();
  const segundo = await abrir();
  assert.notEqual(segundo, primeiro);

  // A fila offline entrega de novo a que já tinha chegado, e a nova vem duplicada no mesmo lote.
  const duranteAQueda = mensagemWa({ conversation: "durante a queda" });
  await receber(segundo, [antesDaQueda, duranteAQueda, duranteAQueda], "append");
  await receber(segundo, [duranteAQueda], "append");

  assert.deepEqual(registradas, [antesDaQueda.key.id, duranteAQueda.key.id]);
  await adapter.pararSocket();
});

test("uma mídia recuperada duas vezes é baixada e enviada ao back uma vez só", async () => {
  definirDownload(async () => Readable.from([arquivos.pdf()]));
  const { adapter, registradas, midias } = novoAdapter({ codEquipe: "32" });
  await adapter.iniciar();
  const socket = await abrir();
  const documento = mensagemWa({ documentMessage: { mimetype: "application/pdf", fileName: "a.pdf", fileLength: long(60), url: "https://mmg.whatsapp.net/x" } });

  await receber(socket, [documento], "append");
  await receber(socket, [documento], "append");
  await receber(socket, [documento], "notify");

  assert.equal(baileysFalso.downloads.length, 1);
  assert.deepEqual(registradas, [documento.key.id]);
  assert.deepEqual(midias, [documento.key.id]);
  await adapter.pararSocket();
});

test("se o back falhou no registro, a reentrega da mesma mensagem tenta de novo (a dedup não perde mensagem)", async () => {
  let falhar = true;
  const { adapter, registradas } = novoAdapter({
    codEquipe: "33",
    registrar: async () => {
      if (falhar) throw Object.assign(new Error("back fora"), { status: 503 });
    },
  });
  await adapter.iniciar();
  const socket = await abrir();
  const msg = mensagemWa({ conversation: "oi" });
  await receber(socket, [msg], "notify");
  assert.deepEqual(registradas, []);

  falhar = false;
  await receber(socket, [msg], "append");
  assert.deepEqual(registradas, [msg.key.id]);
  await adapter.pararSocket();
});

test("append antigo demais (fora da janela, sem atividade conhecida) não chega ao back; o notify sempre chega", async () => {
  const { adapter, registradas } = novoAdapter({ codEquipe: "34", janelaRecuperacaoMs: 3600_000 });
  await adapter.iniciar();
  const socket = await abrir();
  const antiga = mensagemWa({ conversation: "histórico" }, { messageTimestamp: agoraS() - 3 * 3600 });
  const recente = mensagemWa({ conversation: "recente" }, { messageTimestamp: agoraS() - 600 });
  const tempoReal = mensagemWa({ conversation: "tempo real" }, { messageTimestamp: agoraS() - 3 * 3600 });

  await receber(socket, [antiga, recente], "append");
  await receber(socket, [tempoReal], "notify");

  assert.deepEqual(registradas, [recente.key.id, tempoReal.key.id]);
  await adapter.pararSocket();
});

test("depois de um reinício, o append é aceito desde a última atividade gravada (mesmo além da janela)", async () => {
  const caminho = path.join(diretorioSessoes, "atividade-reinicio.json");
  const ultimaAtividade = agoraS() - 5 * 3600; // o processo caiu há 5 h
  criarArmazemAtividade({ caminho }).registrar("35", ultimaAtividade, { forcar: true });

  // Processo novo: armazém novo lendo o mesmo arquivo.
  const { adapter, registradas } = novoAdapter({ codEquipe: "35", armazemAtividade: criarArmazemAtividade({ caminho }), janelaRecuperacaoMs: 3600_000 });
  await adapter.iniciar();
  const socket = await abrir();
  const duranteOReinicio = mensagemWa({ conversation: "durante o reinício" }, { messageTimestamp: ultimaAtividade + 60 });
  const jaVistaAntes = mensagemWa({ conversation: "antiga" }, { messageTimestamp: ultimaAtividade - FOLGA_RECUPERACAO_S - 3600 });

  await receber(socket, [jaVistaAntes, duranteOReinicio], "append");

  assert.deepEqual(registradas, [duranteOReinicio.key.id]);
  await adapter.pararSocket();
  // O desligamento grava a última atividade (o próximo boot sabe de onde recuperar).
  const gravada = JSON.parse(fs.readFileSync(caminho, "utf8"))["35"];
  assert.ok(gravada >= agoraS() - 5, `atividade gravada no desligamento: ${gravada}`);
});

test("o histórico do pareamento não é baixado: syncFullHistory false, shouldSyncHistoryMessage false e sem messaging-history.set", async () => {
  const { adapter } = novoAdapter({ codEquipe: "36" });
  await adapter.iniciar();
  const socket = /** @type {any} */ (ultimoSocket());
  assert.equal(socket.config.syncFullHistory, false);
  assert.equal(typeof socket.config.shouldSyncHistoryMessage, "function");
  assert.equal(socket.config.shouldSyncHistoryMessage({ syncType: 2 }), false);
  assert.equal(socket.listeners["messaging-history.set"], undefined);
  await adapter.pararSocket();
});

test("getMessage: sem a mensagem no cache devolve undefined (nunca { conversation: \"\" }); com ela, devolve o message enviado", async () => {
  const { adapter } = novoAdapter({ codEquipe: "37" });
  await adapter.iniciar();
  const socket = /** @type {any} */ (ultimoSocket());
  assert.equal(typeof socket.config.getMessage, "function");
  assert.equal(await socket.config.getMessage({ remoteJid: JID_CLIENTE, id: "NAO-ENVIADA" }), undefined);

  const message = { extendedTextMessage: { text: "Seu acesso foi liberado." } };
  adapter.guardarEnviada("3EB0ENVIADA1", message, JID_CLIENTE);
  assert.deepEqual(await socket.config.getMessage({ remoteJid: JID_CLIENTE, id: "3EB0ENVIADA1" }), message);
  assert.equal(await socket.config.getMessage({ remoteJid: "5511900000777@s.whatsapp.net", id: "3EB0ENVIADA1" }), undefined);
  await adapter.pararSocket();
});

test("getMessage aceita o pedido pelo LID do mesmo contato quando o par LID ↔ telefone é conhecido", async () => {
  const { adapter } = novoAdapter({ codEquipe: "38" });
  await adapter.iniciar();
  const socket = await abrir();
  await socket.emitir("chats.phoneNumberShare", { lid: LID_CLIENTE, jid: JID_CLIENTE });
  const message = { conversation: "ok" };
  adapter.guardarEnviada("3EB0ENVIADA2", message, JID_CLIENTE);
  assert.deepEqual(await socket.config.getMessage({ remoteJid: LID_CLIENTE, id: "3EB0ENVIADA2" }), message);
  await adapter.pararSocket();
});

test("o cache de reenvio sobrevive à reconexão (o novo socket usa o mesmo cache) e é limpo no logout", async () => {
  const { adapter } = novoAdapter({ codEquipe: "39" });
  await adapter.iniciar();
  const primeiro = await abrir();
  adapter.guardarEnviada("3EB0ENVIADA3", { conversation: "a" }, JID_CLIENTE);

  await primeiro.emitir("connection.update", fechamento(DisconnectReason.connectionLost));
  await new Promise((resolve) => setTimeout(resolve, 10));
  await drenar();
  const segundo = await abrir();
  assert.deepEqual(await segundo.config.getMessage({ remoteJid: JID_CLIENTE, id: "3EB0ENVIADA3" }), { conversation: "a" });

  await segundo.emitir("connection.update", fechamento(DisconnectReason.loggedOut));
  assert.equal(await segundo.config.getMessage({ remoteJid: JID_CLIENTE, id: "3EB0ENVIADA3" }), undefined);
});

test("pararSocket espera o saveCreds em andamento terminar, sem logout e com a sessão em disco", async () => {
  /** @type {() => void} */
  let concluirGravacao = () => {};
  definirSaveCreds(() => new Promise((resolve) => (concluirGravacao = () => resolve(undefined))));
  const { adapter } = novoAdapter({ codEquipe: "40" });
  await adapter.iniciar();
  const socket = await abrir();
  fs.writeFileSync(path.join(diretorioSessoes, "40", "creds.json"), "{}");

  socket.emitir("creds.update", {});
  await drenar();
  assert.equal(baileysFalso.contagem.saveCreds, 1);

  let parou = false;
  const parada = adapter.pararSocket().then(() => (parou = true));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(parou, false, "não pode encerrar com a gravação das credenciais pela metade");

  concluirGravacao();
  await parada;
  assert.equal(parou, true);
  assert.equal(socket.chamadasLogout, 0);
  assert.equal(socket.chamadasEnd, 1);
  assert.equal(fs.existsSync(path.join(diretorioSessoes, "40", "creds.json")), true);
});

test("as gravações de credenciais são em série: a segunda só começa depois da primeira", async () => {
  /** @type {(() => void)[]} */
  const pendentes = [];
  definirSaveCreds(() => new Promise((resolve) => pendentes.push(() => resolve(undefined))));
  const { adapter } = novoAdapter({ codEquipe: "41" });
  await adapter.iniciar();
  const socket = await abrir();

  socket.emitir("creds.update", {});
  socket.emitir("creds.update", {});
  await drenar();
  assert.equal(baileysFalso.contagem.saveCreds, 1);
  pendentes.shift()?.();
  await drenar();
  assert.equal(baileysFalso.contagem.saveCreds, 2);
  pendentes.shift()?.();
  await adapter.pararSocket();
});

test("uma falha no saveCreds não trava o desligamento", async () => {
  definirSaveCreds(async () => {
    throw new Error("disco cheio");
  });
  const { adapter } = novoAdapter({ codEquipe: "42" });
  await adapter.iniciar();
  const socket = await abrir();
  socket.emitir("creds.update", {});
  await adapter.pararSocket();
  assert.equal(adapter.obterStatusConexao().status_conexao, "DESCONECTADO");
});

test("pararSocket espera a fila de entrada registrar a mensagem que o Baileys já entregou", async () => {
  /** @type {() => void} */
  let liberarBack = () => {};
  const { adapter, registradas } = novoAdapter({
    codEquipe: "43",
    registrar: () => new Promise((resolve) => (liberarBack = () => resolve(undefined))),
  });
  await adapter.iniciar();
  const socket = await abrir();
  const msg = mensagemWa({ conversation: "chegou no sinal" });
  socket.emitir("messages.upsert", { messages: [msg], type: "notify" });
  await drenar();

  let parou = false;
  const parada = adapter.pararSocket().then(() => (parou = true));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(parou, false, "a mensagem ainda está sendo registrada no back");
  liberarBack();
  await parada;
  assert.deepEqual(registradas, [msg.key.id]);
});
