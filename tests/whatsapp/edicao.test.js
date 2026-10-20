// @ts-check
// Edição de mensagem enviada pelo atendente: `{ text, edit: key, mentions? }` no chat da mensagem
// original, com o id do envelope gerado e marcado no cache de eco antes do `sendMessage`.
// Socket e manager são falsos.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const baileysFalso = require("../helpers/baileysFalso");

baileysFalso.instalarBaileysFalso();
const { criarEdicao, PRAZO_EDICAO_MS } = require("../../src/whatsapp/edicao");
const { ErroEnvio } = require("../../src/whatsapp/envio");
const { JID_CLIENTE, JID_GRUPO, JID_PARTICIPANTE } = require("../helpers/mensagensWa");

beforeEach(() => baileysFalso.limparHistorico());

/** @param {{ status?: string, travar?: boolean, falhar?: boolean }} [opcoes] */
function equipeFalsa({ status = "CONECTADO", travar = false, falhar = false } = {}) {
  /** @type {string[]} */
  const ordem = [];
  /** @type {{ jid: string, conteudo: any, opcoes: any }[]} */
  const envios = [];
  const socket = {
    user: { id: "5511900000099:7@s.whatsapp.net" },
    /** @param {string} jid @param {any} conteudo @param {any} opcoes */
    sendMessage(jid, conteudo, opcoes) {
      ordem.push(`sendMessage:${opcoes?.messageId}`);
      envios.push({ jid, conteudo, opcoes });
      if (travar) return new Promise(() => {});
      if (falhar) return Promise.reject(new Error(`Connection Closed ${jid}`));
      return Promise.resolve({ key: { remoteJid: jid, fromMe: true, id: opcoes.messageId }, message: {}, messageTimestamp: 1760400777 });
    },
  };
  const adapter = {
    hashEmpresa: "hash-a",
    socketConectado: () => (status === "CONECTADO" ? socket : null),
    /** @param {string} id */
    marcarEnviadaPeloCrm: (id) => void ordem.push(`marcar:${id}`),
  };
  const manager = { obter: () => /** @type {any} */ (adapter), listarRegistradas: () => [] };
  return { manager, envios, ordem };
}

const KEY = { remoteJid: JID_CLIENTE, fromMe: true, id: "3EB0ORIGINAL1" };

test("editar envia exatamente { text, edit: key } no chat, com o id do envelope marcado antes do sendMessage", async () => {
  const { manager, envios, ordem } = equipeFalsa();
  const resultado = await criarEdicao({ manager }).editar("7", JID_CLIENTE, KEY, "*Ana*\ntexto corrigido", undefined, "hash-a");
  assert.equal(envios.length, 1);
  assert.equal(envios[0].jid, JID_CLIENTE);
  assert.deepEqual(envios[0].conteudo, { text: "*Ana*\ntexto corrigido", edit: KEY });
  const id = envios[0].opcoes.messageId;
  assert.deepEqual(ordem, [`marcar:${id}`, `sendMessage:${id}`]);
  assert.deepEqual(resultado, { mensagem_wa_id: id, timestamp_wa: 1760400777, status: "ENVIADA" });
  assert.notEqual(resultado.mensagem_wa_id, KEY.id, "devolve o id do ENVELOPE, nunca o da original");
});

test("a key só leva os campos conhecidos (participant em grupo) e as menções vão em mentions", async () => {
  const { manager, envios } = equipeFalsa();
  const key = { remoteJid: JID_GRUPO, fromMe: true, id: "3EB0ORIGINAL2", participant: JID_PARTICIPANTE };
  await criarEdicao({ manager }).editar("7", JID_GRUPO, /** @type {any} */ ({ ...key, extra: "x" }), "oi @fulano", [JID_PARTICIPANTE, JID_PARTICIPANTE], "hash-a");
  assert.deepEqual(envios[0].conteudo, { text: "oi @fulano", edit: key, mentions: [JID_PARTICIPANTE] });
});

test("fromMe diferente de true é recusado sem chamar o socket", async () => {
  const { manager, envios } = equipeFalsa();
  const { editar } = criarEdicao({ manager });
  for (const fromMe of [false, "true", 1, undefined]) {
    await assert.rejects(
      editar("7", JID_CLIENTE, /** @type {any} */ ({ ...KEY, fromMe }), "novo", [], "hash-a"),
      (erro) => erro instanceof ErroEnvio && erro.codigo === "CONTEUDO_INVALIDO"
    );
  }
  assert.equal(envios.length, 0);
});

test("recusa key de outra conversa, key inválida, texto vazio ou longo e menção inválida, sem chamar o socket", async () => {
  const { manager, envios } = equipeFalsa();
  const { editar } = criarEdicao({ manager });
  const recusada = (/** @type {any} */ key, /** @type {any} */ texto = "novo", /** @type {any} */ mencoes = [], chat = JID_GRUPO) =>
    assert.rejects(editar("7", chat, key, texto, mencoes, "hash-a"), (erro) => erro instanceof ErroEnvio && erro.codigo === "CONTEUDO_INVALIDO");
  const ok = { remoteJid: JID_GRUPO, fromMe: true, id: "3EB0X" };
  await recusada({ remoteJid: "120363000000000999@g.us", fromMe: true, id: "3EB0X" });
  await recusada({ remoteJid: JID_GRUPO, fromMe: true, id: "id inválido!" });
  await recusada(null);
  await recusada(ok, "");
  await recusada(ok, "   ");
  await recusada(ok, 5);
  await recusada(ok, "a".repeat(65537));
  await recusada(ok, "novo", ["não-é-jid"]);
  await recusada(ok, "novo", "texto");
  await recusada(ok, "novo", [], "inválido");
  assert.equal(envios.length, 0);
});

test("texto de 65536 caracteres é aceito (limite do contrato)", async () => {
  const { manager, envios } = equipeFalsa();
  await criarEdicao({ manager }).editar("7", JID_CLIENTE, KEY, "a".repeat(65536), [], "hash-a");
  assert.equal(envios[0].conteudo.text.length, 65536);
});

test("equipe desconectada: EQUIPE_DESCONECTADA; tenant diferente: EQUIPE_NAO_ENCONTRADA", async () => {
  const desconectada = equipeFalsa({ status: "ERRO" });
  await assert.rejects(
    criarEdicao({ manager: desconectada.manager }).editar("7", JID_CLIENTE, KEY, "novo", [], "hash-a"),
    (erro) => erro instanceof ErroEnvio && erro.codigo === "EQUIPE_DESCONECTADA"
  );
  const { manager, envios } = equipeFalsa();
  await assert.rejects(
    criarEdicao({ manager }).editar("7", JID_CLIENTE, KEY, "novo", [], "hash-b"),
    (erro) => erro instanceof ErroEnvio && erro.codigo === "EQUIPE_NAO_ENCONTRADA"
  );
  assert.equal(envios.length + desconectada.envios.length, 0);
});

test("falha no sendMessage: FALHA_ENVIO; passou do prazo técnico: ENVIO_NAO_CONFIRMADO", async () => {
  await assert.rejects(
    criarEdicao({ manager: equipeFalsa({ falhar: true }).manager }).editar("7", JID_CLIENTE, KEY, "novo", [], "hash-a"),
    (erro) => erro instanceof ErroEnvio && erro.codigo === "FALHA_ENVIO" && !/55|@/.test(erro.message)
  );
  await assert.rejects(
    criarEdicao({ manager: equipeFalsa({ travar: true }).manager, prazoMs: 20 }).editar("7", JID_CLIENTE, KEY, "novo", [], "hash-a"),
    (erro) => erro instanceof ErroEnvio && erro.codigo === "ENVIO_NAO_CONFIRMADO" && erro.message === "Envio não confirmado."
  );
});

test("o prazo técnico padrão é de 10 s", () => {
  assert.equal(PRAZO_EDICAO_MS, 10_000);
});

test("o log não leva texto, JID nem LID", async () => {
  const original = { error: console.error, log: console.log };
  /** @type {string[]} */
  const linhas = [];
  console.error = (...a) => void linhas.push(a.join(" "));
  console.log = (...a) => void linhas.push(a.join(" "));
  try {
    await criarEdicao({ manager: equipeFalsa().manager }).editar("7", JID_CLIENTE, KEY, "texto secreto do atendente", [], "hash-a");
    await assert.rejects(criarEdicao({ manager: equipeFalsa({ falhar: true }).manager }).editar("7", JID_CLIENTE, KEY, "texto secreto do atendente", [], "hash-a"));
    await assert.rejects(criarEdicao({ manager: equipeFalsa({ travar: true }).manager, prazoMs: 10 }).editar("7", JID_CLIENTE, KEY, "texto secreto do atendente", [], "hash-a"));
  } finally {
    console.error = original.error;
    console.log = original.log;
  }
  const tudo = linhas.join("\n");
  assert.doesNotMatch(tudo, /secreto|@s\.whatsapp\.net|@lid|@g\.us|5511/);
});
