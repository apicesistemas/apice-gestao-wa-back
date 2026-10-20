// @ts-check
// Ligação messages.upsert → normalizar → registrar no adapter, com o socket Baileys mockado
// (tests/helpers/baileysFalso.js) e o registro no back substituído por uma função falsa.
const { test, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const baileysFalso = require("../helpers/baileysFalso");

baileysFalso.instalarBaileysFalso();
const { criarAdapter } = require("../../src/whatsapp/BaileysAdapter");
const {
  mensagemWa,
  mensagemGrupo,
  TELEFONE_CLIENTE,
  JID_CLIENTE,
  LID_CLIENTE,
  JID_GRUPO,
  TELEFONE_PARTICIPANTE,
  JID_PARTICIPANTE,
  LID_PARTICIPANTE,
  TELEFONE_EQUIPE,
  EU,
} = require("../helpers/mensagensWa");

const { ultimoSocket, drenar } = baileysFalso;

const diretorioSessoes = fs.mkdtempSync(path.join(os.tmpdir(), "wa-back-entrada-"));
after(() => fs.rmSync(diretorioSessoes, { recursive: true, force: true }));

beforeEach(() => baileysFalso.limparHistorico());

/**
 * Adapter conectado com o registro no back trocado por um falso que guarda as chamadas.
 * @param {{ registrar?: (mensagem: any, contexto: any) => Promise<unknown>, onWhatsApp?: (jid: string) => Promise<any> }} [opcoes]
 */
async function adapterConectado({ registrar, onWhatsApp } = {}) {
  /** @type {{ mensagem: any, contexto: any }[]} */
  const registradas = [];
  const adapter = criarAdapter({
    codEquipe: "21",
    hashEmpresa: "hash-empresa-teste",
    diretorioSessoes,
    registrarMensagem: async (mensagem, contexto) => {
      registradas.push({ mensagem, contexto });
      if (registrar) await registrar(mensagem, contexto);
    },
  });
  await adapter.iniciar();
  const socket = /** @type {any} */ (ultimoSocket());
  socket.user = { id: EU.jid, lid: EU.lid };
  socket.onWhatsApp = onWhatsApp || (async () => []);
  await socket.emitir("connection.update", { connection: "open" });
  /** @param {any[]} messages @param {"notify" | "append"} [type] */
  const receber = async (messages, type = "notify") => {
    await socket.emitir("messages.upsert", { messages, type });
    await drenar();
  };
  return { adapter, socket, registradas, receber };
}

test("messages.upsert normaliza e registra no back com hash_empresa e cod_equipe da instância", async () => {
  const { registradas, receber } = await adapterConectado();
  const msg = mensagemWa({ conversation: "preciso de suporte" });
  await receber([msg]);

  assert.equal(registradas.length, 1);
  assert.deepEqual(registradas[0].contexto, { hash_empresa: "hash-empresa-teste", cod_equipe: "21" });
  const m = registradas[0].mensagem;
  assert.equal(m.mensagem_wa_id, msg.key.id);
  assert.equal(m.tipo, "TEXTO");
  assert.equal(m.texto, "preciso de suporte");
  assert.equal(m.origem, "CLIENTE");
  assert.deepEqual(m.contato, { jid: JID_CLIENTE, lid: null, telefone: TELEFONE_CLIENTE });
});

test("mensagens recuperadas na reconexão (type append) também são registradas; status é ignorado", async () => {
  const { registradas, receber } = await adapterConectado();
  await receber([mensagemWa({ conversation: "enviada durante a queda" })], "append");
  await receber([mensagemWa({ conversation: "status" }, { key: { remoteJid: "status@broadcast", participant: JID_CLIENTE } })]);
  assert.deepEqual(registradas.map((r) => r.mensagem.texto), ["enviada durante a queda"]);
});

test("recuperada: true só no lote append com origem CLIENTE; notify e eco do aparelho vão sem a chave (Task 24.3)", async () => {
  const { registradas, receber } = await adapterConectado();
  const recuperadaDoCliente = mensagemWa({ conversation: "enviada durante a queda" });
  const aoVivo = mensagemWa({ conversation: "ao vivo" });
  const doAparelhoAppend = mensagemWa({ conversation: "celular em append" }, { key: { fromMe: true }, pushName: null });
  const doAparelhoNotify = mensagemWa({ conversation: "celular em notify" }, { key: { fromMe: true }, pushName: null });

  await receber([recuperadaDoCliente], "append");
  await receber([aoVivo], "notify");
  await receber([doAparelhoAppend], "append");
  await receber([doAparelhoNotify], "notify");

  const porTexto = Object.fromEntries(registradas.map((r) => [r.mensagem.texto, r.mensagem]));
  assert.equal(porTexto["enviada durante a queda"].origem, "CLIENTE");
  assert.equal(porTexto["enviada durante a queda"].recuperada, true);
  assert.equal("recuperada" in porTexto["ao vivo"], false);
  assert.equal(porTexto["celular em append"].origem, "APARELHO");
  assert.equal("recuperada" in porTexto["celular em append"], false);
  assert.equal("recuperada" in porTexto["celular em notify"], false);
});

test("mensagem em @g.us chega ao back com o grupo e o participante remetente", async () => {
  const { registradas, receber } = await adapterConectado();
  await receber([mensagemGrupo({ conversation: "bom dia" })]);
  const m = registradas[0].mensagem;
  assert.equal(m.tipo_chat, "GRUPO");
  assert.equal(m.chat_jid, JID_GRUPO);
  assert.deepEqual(m.remetente, { jid: JID_PARTICIPANTE, lid: LID_PARTICIPANTE, telefone: TELEFONE_PARTICIPANTE, nome: "Participante Teste" });
});

test("fromMe digitada no aparelho é registrada com origem APARELHO, e o eco de um envio do CRM é descartado", async () => {
  const { adapter, registradas, receber } = await adapterConectado();
  const doAparelho = mensagemWa({ conversation: "respondi pelo celular" }, { key: { fromMe: true }, pushName: null });
  const ecoDoCrm = mensagemWa({ conversation: "enviada pelo CRM" }, { key: { fromMe: true }, pushName: null });
  adapter.marcarEnviadaPeloCrm(ecoDoCrm.key.id);

  await receber([ecoDoCrm], "append");
  await receber([doAparelho]);

  assert.equal(registradas.length, 1);
  assert.equal(registradas[0].mensagem.mensagem_wa_id, doAparelho.key.id);
  assert.equal(registradas[0].mensagem.origem, "APARELHO");
  assert.equal(registradas[0].mensagem.remetente.telefone, TELEFONE_EQUIPE);
});

test("mensagem @lid sem telefone resolvível é registrada pelo LID, sem ser descartada", async () => {
  const { registradas, receber } = await adapterConectado();
  await receber([mensagemWa({ conversation: "oi" }, { key: { remoteJid: LID_CLIENTE } })]);
  assert.equal(registradas.length, 1);
  const m = registradas[0].mensagem;
  assert.equal(m.chat_jid, LID_CLIENTE);
  assert.deepEqual(m.remetente, { jid: LID_CLIENTE, lid: LID_CLIENTE, telefone: null, nome: "Cliente Teste" });
  assert.deepEqual(m.contato, { jid: LID_CLIENTE, lid: LID_CLIENTE, telefone: null });
});

test("o par LID ↔ telefone aprendido pelo senderPn completa as mensagens seguintes só com LID (inclusive do aparelho)", async () => {
  const { registradas, receber } = await adapterConectado();
  await receber([mensagemWa({ conversation: "oi" }, { key: { remoteJid: LID_CLIENTE, senderPn: JID_CLIENTE } })]);
  await receber([
    mensagemWa({ conversation: "resposta" }, { key: { remoteJid: LID_CLIENTE, fromMe: true, senderPn: `${TELEFONE_EQUIPE}@s.whatsapp.net` }, pushName: null }),
  ]);
  assert.equal(registradas[0].mensagem.remetente.telefone, TELEFONE_CLIENTE);
  assert.deepEqual(registradas[1].mensagem.contato, { jid: LID_CLIENTE, lid: LID_CLIENTE, telefone: TELEFONE_CLIENTE });
  assert.equal(registradas[1].mensagem.origem, "APARELHO");
});

test("chats.phoneNumberShare e contacts.upsert ensinam pares ao resolvedor", async () => {
  const { socket, registradas, receber } = await adapterConectado();
  await socket.emitir("chats.phoneNumberShare", { lid: LID_CLIENTE, jid: JID_CLIENTE });
  await socket.emitir("contacts.upsert", [{ id: LID_PARTICIPANTE, jid: JID_PARTICIPANTE }]);
  await receber([mensagemWa({ conversation: "oi" }, { key: { remoteJid: LID_CLIENTE } })]);
  await receber([mensagemGrupo({ conversation: "oi" }, { key: { participant: LID_PARTICIPANTE, participantLid: undefined } })]);
  assert.equal(registradas[0].mensagem.remetente.telefone, TELEFONE_CLIENTE);
  assert.equal(registradas[1].mensagem.remetente.telefone, TELEFONE_PARTICIPANTE);
});

test("contato privado só com telefone ganha o LID pelo onWhatsApp (consultado uma vez)", async () => {
  /** @type {string[]} */
  const consultas = [];
  const { registradas, receber } = await adapterConectado({
    onWhatsApp: async (jid) => {
      consultas.push(jid);
      return [{ jid, exists: true, lid: LID_CLIENTE }];
    },
  });
  await receber([mensagemWa({ conversation: "1" }), mensagemWa({ conversation: "2" })]);
  assert.deepEqual(consultas, [JID_CLIENTE]);
  assert.deepEqual(registradas.map((r) => r.mensagem.contato.lid), [LID_CLIENTE, LID_CLIENTE]);
  assert.equal(registradas[0].mensagem.remetente.lid, LID_CLIENTE);
});

test("falha ao registrar no back só loga: não derruba o processo nem perde a ordem das mensagens seguintes", async (t) => {
  const erros = t.mock.method(console, "error", () => {});
  let primeira = true;
  const { registradas, receber, socket } = await adapterConectado({
    registrar: async () => {
      if (primeira) {
        primeira = false;
        await new Promise((resolve) => setTimeout(resolve, 20));
        throw Object.assign(new Error("Erro ao chamar /interno/mensagem-recebida (HTTP 404)."), { name: "ErroRotaInterna", tipo: "http", status: 404 });
      }
    },
  });
  const a = mensagemWa({ conversation: "a" });
  const b = mensagemWa({ conversation: "b" });
  const c = mensagemWa({ conversation: "c" });
  // Dois eventos sem esperar o primeiro terminar: o segundo só é registrado depois do primeiro.
  const p1 = socket.emitir("messages.upsert", { messages: [a], type: "notify" });
  const p2 = socket.emitir("messages.upsert", { messages: [b, c], type: "notify" });
  await Promise.all([p1, p2]);
  await receber([]);

  assert.deepEqual(registradas.map((r) => r.mensagem.texto), ["a", "b", "c"]);
  assert.ok(erros.mock.callCount() >= 1);
  const logado = erros.mock.calls.map((c) => c.arguments.join(" ")).join("\n");
  assert.doesNotMatch(logado, /5511900000001/, "o log não traz telefone");
});

test("pararSocket remove o listener de messages.upsert", async () => {
  const { adapter, socket } = await adapterConectado();
  await adapter.pararSocket();
  assert.ok(socket.removidos.includes("messages.upsert"));
});

test("Fase 40: o eco da edição do CRM (protocolMessage MESSAGE_EDIT com o id do envelope) não vai ao back; a edição real do aparelho continua indo", async () => {
  const { adapter, registradas, receber } = await adapterConectado();
  const protocolo = (/** @type {string} */ alvo) => ({
    protocolMessage: { type: 14, key: { remoteJid: JID_CLIENTE, fromMe: true, id: alvo }, editedMessage: { conversation: "texto corrigido" } },
  });
  const ecoDoCrm = mensagemWa(protocolo("3EB0ORIGINAL1"), { key: { fromMe: true }, pushName: null });
  const doAparelho = mensagemWa(protocolo("3EB0ORIGINAL2"), { key: { fromMe: true }, pushName: null });
  adapter.marcarEnviadaPeloCrm(ecoDoCrm.key.id);

  await receber([ecoDoCrm], "append");
  assert.equal(registradas.length, 0, "o eco da edição do CRM não gera POST /interno/*");
  await receber([doAparelho], "notify");

  assert.equal(registradas.length, 1);
  assert.equal(registradas[0].mensagem.tipo, "EDICAO");
  assert.equal(registradas[0].mensagem.origem, "APARELHO");
  assert.equal(registradas[0].mensagem.alvo.mensagem_wa_id, "3EB0ORIGINAL2");
});
