// @ts-check
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { criarResolvedorLid } = require("../../src/whatsapp/resolverLid");
const {
  mensagemWa,
  mensagemGrupo,
  TELEFONE_CLIENTE,
  JID_CLIENTE,
  LID_CLIENTE,
  TELEFONE_PARTICIPANTE,
  JID_PARTICIPANTE,
  LID_PARTICIPANTE,
  TELEFONE_EQUIPE,
} = require("../helpers/mensagensWa");

test("aprende o par pelo senderPn de uma mensagem do cliente em @lid", () => {
  const resolvedor = criarResolvedorLid();
  resolvedor.aprenderDaMensagem(mensagemWa({ conversation: "oi" }, { key: { remoteJid: LID_CLIENTE, senderPn: JID_CLIENTE } }));
  assert.equal(resolvedor.telefoneDoLid(LID_CLIENTE), TELEFONE_CLIENTE);
  assert.equal(resolvedor.lidDoTelefone(TELEFONE_CLIENTE), LID_CLIENTE);
});

test("aprende o par pelo senderLid (@s.whatsapp.net) e pelo participante de grupo", () => {
  const resolvedor = criarResolvedorLid();
  resolvedor.aprenderDaMensagem(mensagemWa({ conversation: "oi" }, { key: { senderLid: LID_CLIENTE } }));
  resolvedor.aprenderDaMensagem(mensagemGrupo({ conversation: "oi" }));
  assert.equal(resolvedor.telefoneDoLid(LID_CLIENTE), TELEFONE_CLIENTE);
  assert.equal(resolvedor.telefoneDoLid(LID_PARTICIPANTE), TELEFONE_PARTICIPANTE);

  const outro = criarResolvedorLid();
  outro.aprenderDaMensagem(mensagemGrupo({ conversation: "oi" }, { key: { participant: "100000000000002:4@lid", participantPn: JID_PARTICIPANTE } }));
  assert.equal(outro.telefoneDoLid(LID_PARTICIPANTE), TELEFONE_PARTICIPANTE);
});

test("nunca aprende de mensagem fromMe (o senderPn dela é o número da equipe)", () => {
  const resolvedor = criarResolvedorLid();
  resolvedor.aprenderDaMensagem(
    mensagemWa({ conversation: "oi" }, { key: { remoteJid: LID_CLIENTE, fromMe: true, senderPn: `${TELEFONE_EQUIPE}@s.whatsapp.net` } })
  );
  assert.equal(resolvedor.telefoneDoLid(LID_CLIENTE), null);
});

test("aprenderPar recusa LID ou telefone inválidos e aceita contatos do Baileys (id/lid/jid)", () => {
  const resolvedor = criarResolvedorLid();
  assert.equal(resolvedor.aprenderPar("abc@lid", JID_CLIENTE), false);
  assert.equal(resolvedor.aprenderPar(LID_CLIENTE, "120363000000000001@g.us"), false);
  assert.equal(resolvedor.aprenderPar(LID_CLIENTE, "123"), false);
  assert.equal(resolvedor.telefoneDoLid(LID_CLIENTE), null);

  resolvedor.aprenderContatos([{ id: LID_CLIENTE, jid: JID_CLIENTE }, { id: JID_PARTICIPANTE, lid: LID_PARTICIPANTE }, { id: "lixo" }]);
  assert.equal(resolvedor.telefoneDoLid(LID_CLIENTE), TELEFONE_CLIENTE);
  assert.equal(resolvedor.telefoneDoLid(LID_PARTICIPANTE), TELEFONE_PARTICIPANTE);
});

test("completarIdentidade preenche o telefone de quem só tem LID (e o LID de quem só tem telefone) pelo cache", () => {
  const resolvedor = criarResolvedorLid();
  resolvedor.aprenderPar(LID_CLIENTE, JID_CLIENTE);
  assert.deepEqual(resolvedor.completarIdentidade({ jid: LID_CLIENTE, lid: LID_CLIENTE, telefone: null, nome: "X" }), {
    jid: LID_CLIENTE,
    lid: LID_CLIENTE,
    telefone: TELEFONE_CLIENTE,
    nome: "X",
  });
  assert.deepEqual(resolvedor.completarIdentidade({ jid: JID_CLIENTE, lid: null, telefone: TELEFONE_CLIENTE }), {
    jid: JID_CLIENTE,
    lid: LID_CLIENTE,
    telefone: TELEFONE_CLIENTE,
  });
});

test("LID sem telefone resolvível continua identificado pelo LID (telefone null)", () => {
  const resolvedor = criarResolvedorLid();
  assert.deepEqual(resolvedor.completarIdentidade({ jid: LID_CLIENTE, lid: LID_CLIENTE, telefone: null }), {
    jid: LID_CLIENTE,
    lid: LID_CLIENTE,
    telefone: null,
  });
});

test("consultarLidDoTelefone usa o onWhatsApp uma vez e guarda o resultado (positivo e negativo)", async () => {
  const resolvedor = criarResolvedorLid();
  /** @type {string[]} */
  const consultas = [];
  /** @param {string} jid */
  const onWhatsApp = async (jid) => {
    consultas.push(jid);
    if (jid === JID_CLIENTE) return [{ jid: JID_CLIENTE, exists: true, lid: LID_CLIENTE }];
    return [{ jid, exists: true, lid: "123:4@lid" }]; // LID com sufixo de dispositivo não é aceito
  };
  assert.equal(await resolvedor.consultarLidDoTelefone(TELEFONE_CLIENTE, onWhatsApp), LID_CLIENTE);
  assert.equal(await resolvedor.consultarLidDoTelefone(TELEFONE_CLIENTE, onWhatsApp), LID_CLIENTE);
  assert.equal(resolvedor.telefoneDoLid(LID_CLIENTE), TELEFONE_CLIENTE);

  assert.equal(await resolvedor.consultarLidDoTelefone(TELEFONE_PARTICIPANTE, onWhatsApp), null);
  assert.equal(await resolvedor.consultarLidDoTelefone(TELEFONE_PARTICIPANTE, onWhatsApp), null);
  assert.deepEqual(consultas, [JID_CLIENTE, JID_PARTICIPANTE]);
});

test("consultarLidDoTelefone devolve null se o onWhatsApp falhar ou demorar além do prazo", async () => {
  const resolvedor = criarResolvedorLid({ prazoConsultaMs: 20 });
  assert.equal(
    await resolvedor.consultarLidDoTelefone(TELEFONE_CLIENTE, async () => {
      throw new Error("falha de rede 5511900000001");
    }),
    null
  );
  const lento = () => new Promise((resolve) => setTimeout(() => resolve([{ jid: JID_PARTICIPANTE, exists: true, lid: LID_PARTICIPANTE }]), 200).unref());
  assert.equal(await resolvedor.consultarLidDoTelefone(TELEFONE_PARTICIPANTE, /** @type {any} */ (lento)), null);
});

test("o cache de pares tem tamanho máximo (FIFO)", () => {
  const resolvedor = criarResolvedorLid({ maxPares: 1 });
  resolvedor.aprenderPar(LID_CLIENTE, JID_CLIENTE);
  resolvedor.aprenderPar(LID_PARTICIPANTE, JID_PARTICIPANTE);
  assert.equal(resolvedor.telefoneDoLid(LID_CLIENTE), null);
  assert.equal(resolvedor.telefoneDoLid(LID_PARTICIPANTE), TELEFONE_PARTICIPANTE);
});
