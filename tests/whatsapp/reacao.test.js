// @ts-check
// Reação do atendente: `{ react: { text, key } }` no chat da mensagem alvo, com o id marcado no
// cache de eco antes do `sendMessage`. Socket e manager são falsos.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const baileysFalso = require("../helpers/baileysFalso");

baileysFalso.instalarBaileysFalso();
const { criarReacao } = require("../../src/whatsapp/reacao");
const { ErroEnvio } = require("../../src/whatsapp/envio");
const { JID_CLIENTE, JID_GRUPO, JID_PARTICIPANTE } = require("../helpers/mensagensWa");

beforeEach(() => baileysFalso.limparHistorico());

/** @param {{ status?: string }} [opcoes] */
function equipeFalsa({ status = "CONECTADO" } = {}) {
  /** @type {string[]} */
  const ordem = [];
  /** @type {{ jid: string, conteudo: any, opcoes: any }[]} */
  const envios = [];
  const socket = {
    user: { id: "5511900000099:7@s.whatsapp.net" },
    /** @param {string} jid @param {any} conteudo @param {any} opcoes */
    async sendMessage(jid, conteudo, opcoes) {
      ordem.push(`sendMessage:${opcoes?.messageId}`);
      envios.push({ jid, conteudo, opcoes });
      return { key: { remoteJid: jid, fromMe: true, id: opcoes.messageId }, messageTimestamp: 1 };
    },
  };
  const adapter = {
    hashEmpresa: "hash-a",
    obterStatusConexao: () => ({ status_conexao: status, ultimo_erro_conexao: null }),
    socketConectado: () => (status === "CONECTADO" ? socket : null),
    /** @param {string} id */
    marcarEnviadaPeloCrm: (id) => void ordem.push(`marcar:${id}`),
  };
  const manager = { obter: () => /** @type {any} */ (adapter), listarRegistradas: () => [] };
  return { manager, envios, ordem };
}

test("reagir envia { react: { text, key } } no chat, com o id marcado antes do sendMessage", async () => {
  const { manager, envios, ordem } = equipeFalsa();
  const key = { remoteJid: JID_GRUPO, fromMe: false, id: "3EB0ALVO1", participant: JID_PARTICIPANTE };
  const resultado = await criarReacao({ manager }).reagir("7", JID_GRUPO, key, "👍", "hash-a");
  assert.deepEqual(resultado, { status: "ENVIADA" });
  assert.equal(envios.length, 1);
  assert.equal(envios[0].jid, JID_GRUPO);
  assert.deepEqual(envios[0].conteudo, { react: { text: "👍", key } });
  const id = envios[0].opcoes.messageId;
  assert.deepEqual(ordem, [`marcar:${id}`, `sendMessage:${id}`]);
});

test("emoji vazio remove a reação", async () => {
  const { manager, envios } = equipeFalsa();
  await criarReacao({ manager }).reagir("7", JID_CLIENTE, { remoteJid: JID_CLIENTE, fromMe: true, id: "3EB0ALVO2" }, "", "hash-a");
  assert.equal(envios[0].conteudo.react.text, "");
});

test("key de outro chat, key inválida ou emoji inválido são recusados sem chamar o socket", async () => {
  const { manager, envios } = equipeFalsa();
  const { reagir } = criarReacao({ manager });
  const recusada = (/** @type {any} */ key, /** @type {any} */ emoji = "👍", chat = JID_GRUPO) =>
    assert.rejects(reagir("7", chat, key, emoji, "hash-a"), (erro) => erro instanceof ErroEnvio && erro.codigo === "CONTEUDO_INVALIDO");
  await recusada({ remoteJid: "120363000000000999@g.us", fromMe: false, id: "3EB0X" });
  await recusada({ remoteJid: JID_GRUPO, id: "3EB0X" });
  await recusada(null);
  await recusada({ remoteJid: JID_GRUPO, fromMe: false, id: "3EB0X" }, 5);
  await recusada({ remoteJid: JID_GRUPO, fromMe: false, id: "3EB0X" }, "texto comprido demais para ser um emoji de reação");
  assert.equal(envios.length, 0);
});

test("equipe desconectada: EQUIPE_DESCONECTADA", async () => {
  const { manager, envios } = equipeFalsa({ status: "ERRO" });
  await assert.rejects(
    criarReacao({ manager }).reagir("7", JID_CLIENTE, { remoteJid: JID_CLIENTE, fromMe: false, id: "3EB0X" }, "👍", "hash-a"),
    (erro) => erro instanceof ErroEnvio && erro.codigo === "EQUIPE_DESCONECTADA"
  );
  assert.equal(envios.length, 0);
});
