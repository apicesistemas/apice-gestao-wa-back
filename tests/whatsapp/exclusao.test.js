// @ts-check
// Apagar para todos a mensagem enviada pelo atendente: `{ delete: key }` no chat da mensagem original,
// com o id do envelope gerado e marcado no cache de eco antes do `sendMessage`. Socket e manager falsos.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const baileysFalso = require("../helpers/baileysFalso");

baileysFalso.instalarBaileysFalso();
const { criarExclusao, PRAZO_EXCLUSAO_MS } = require("../../src/whatsapp/exclusao");
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
      return Promise.resolve({ key: { remoteJid: jid, fromMe: true, id: opcoes.messageId }, message: {}, messageTimestamp: 1760400888 });
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

test("apagar envia exatamente { delete: key } no chat, com o id do envelope marcado antes do sendMessage", async () => {
  const { manager, envios, ordem } = equipeFalsa();
  const resultado = await criarExclusao({ manager }).apagar("7", JID_CLIENTE, KEY, "hash-a");
  assert.equal(envios.length, 1);
  assert.equal(envios[0].jid, JID_CLIENTE);
  assert.deepEqual(envios[0].conteudo, { delete: KEY });
  const id = envios[0].opcoes.messageId;
  assert.deepEqual(ordem, [`marcar:${id}`, `sendMessage:${id}`]);
  assert.deepEqual(resultado, { mensagem_wa_id: id, timestamp_wa: 1760400888, status: "ENVIADA" });
  assert.notEqual(resultado.mensagem_wa_id, KEY.id, "devolve o id do ENVELOPE, nunca o da original");
});

test("a key só leva os campos conhecidos (participant em grupo)", async () => {
  const { manager, envios } = equipeFalsa();
  const key = { remoteJid: JID_GRUPO, fromMe: true, id: "3EB0ORIGINAL2", participant: JID_PARTICIPANTE };
  await criarExclusao({ manager }).apagar("7", JID_GRUPO, /** @type {any} */ ({ ...key, extra: "x" }), "hash-a");
  assert.deepEqual(envios[0].conteudo, { delete: key });
});

test("fromMe diferente de true é recusado sem chamar o socket (nunca apaga como administrador)", async () => {
  const { manager, envios } = equipeFalsa();
  const { apagar } = criarExclusao({ manager });
  await assert.rejects(
    apagar("7", JID_CLIENTE, { ...KEY, fromMe: false }, "hash-a"),
    (erro) =>
      erro instanceof ErroEnvio && erro.codigo === "CONTEUDO_INVALIDO" && erro.message === "Só mensagens enviadas pelo número da equipe podem ser apagadas."
  );
  // Não booleano: a key já é inválida na validação comum (também 400).
  for (const fromMe of ["true", 1, undefined]) {
    await assert.rejects(
      apagar("7", JID_CLIENTE, /** @type {any} */ ({ ...KEY, fromMe }), "hash-a"),
      (erro) => erro instanceof ErroEnvio && erro.codigo === "CONTEUDO_INVALIDO"
    );
  }
  assert.equal(envios.length, 0);
});

test("recusa key de outra conversa, key inválida e chat inválido, sem chamar o socket", async () => {
  const { manager, envios } = equipeFalsa();
  const { apagar } = criarExclusao({ manager });
  const recusada = (/** @type {any} */ key, chat = JID_GRUPO) =>
    assert.rejects(apagar("7", chat, key, "hash-a"), (erro) => erro instanceof ErroEnvio && erro.codigo === "CONTEUDO_INVALIDO");
  await recusada({ remoteJid: "120363000000000999@g.us", fromMe: true, id: "3EB0X" });
  await recusada({ remoteJid: JID_GRUPO, fromMe: true, id: "id inválido!" });
  await recusada(null);
  await recusada({ remoteJid: JID_GRUPO, fromMe: true, id: "3EB0X" }, "inválido");
  assert.equal(envios.length, 0);
});

test("equipe desconectada: EQUIPE_DESCONECTADA; tenant diferente: EQUIPE_NAO_ENCONTRADA", async () => {
  const desconectada = equipeFalsa({ status: "ERRO" });
  await assert.rejects(
    criarExclusao({ manager: desconectada.manager }).apagar("7", JID_CLIENTE, KEY, "hash-a"),
    (erro) => erro instanceof ErroEnvio && erro.codigo === "EQUIPE_DESCONECTADA"
  );
  const { manager, envios } = equipeFalsa();
  await assert.rejects(
    criarExclusao({ manager }).apagar("7", JID_CLIENTE, KEY, "hash-b"),
    (erro) => erro instanceof ErroEnvio && erro.codigo === "EQUIPE_NAO_ENCONTRADA"
  );
  assert.equal(envios.length + desconectada.envios.length, 0);
});

test("falha no sendMessage: FALHA_ENVIO; passou do prazo técnico: ENVIO_NAO_CONFIRMADO", async () => {
  await assert.rejects(
    criarExclusao({ manager: equipeFalsa({ falhar: true }).manager }).apagar("7", JID_CLIENTE, KEY, "hash-a"),
    (erro) => erro instanceof ErroEnvio && erro.codigo === "FALHA_ENVIO" && !/55|@/.test(erro.message)
  );
  await assert.rejects(
    criarExclusao({ manager: equipeFalsa({ travar: true }).manager, prazoMs: 20 }).apagar("7", JID_CLIENTE, KEY, "hash-a"),
    (erro) => erro instanceof ErroEnvio && erro.codigo === "ENVIO_NAO_CONFIRMADO" && erro.message === "Envio não confirmado."
  );
});

test("o prazo técnico padrão é de 10 s", () => {
  assert.equal(PRAZO_EXCLUSAO_MS, 10_000);
});

test("o log não leva JID nem LID", async () => {
  const original = { error: console.error, log: console.log };
  /** @type {string[]} */
  const linhas = [];
  console.error = (...a) => void linhas.push(a.join(" "));
  console.log = (...a) => void linhas.push(a.join(" "));
  try {
    await criarExclusao({ manager: equipeFalsa().manager }).apagar("7", JID_CLIENTE, KEY, "hash-a");
    await assert.rejects(criarExclusao({ manager: equipeFalsa({ falhar: true }).manager }).apagar("7", JID_CLIENTE, KEY, "hash-a"));
    await assert.rejects(criarExclusao({ manager: equipeFalsa({ travar: true }).manager, prazoMs: 10 }).apagar("7", JID_CLIENTE, KEY, "hash-a"));
  } finally {
    console.error = original.error;
    console.log = original.log;
  }
  assert.doesNotMatch(linhas.join("\n"), /@s\.whatsapp\.net|@lid|@g\.us|5511/);
});
