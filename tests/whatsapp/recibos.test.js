// @ts-check
// Recibos do Baileys 6.7.24 (`messages.update` / `message-receipt.update`) → status ENVIADA,
// ENTREGUE ou LIDA no back. O envio ao back é uma função falsa injetada.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { extrairDeAtualizacoes, extrairDeRecibos, statusDoCodigo, criarRecibos } = require("../../src/whatsapp/recibos");
const { JID_CLIENTE, JID_GRUPO, JID_PARTICIPANTE, EU } = require("../helpers/mensagensWa");

// WAMessageStatus do Baileys 6.7.24 (proto.WebMessageInfo.Status).
const ERROR = 0;
const PENDING = 1;
const SERVER_ACK = 2;
const DELIVERY_ACK = 3;
const READ = 4;
const PLAYED = 5;

const CONTEXTO = { hash_empresa: "hash-a", cod_equipe: "21" };

/** @param {string} id @param {number} status @param {Record<string, any>} [key] */
const atualizacao = (id, status, key = {}) => ({ key: { remoteJid: JID_CLIENTE, fromMe: true, id, ...key }, update: { status } });

/** Recibos com o envio ao back trocado por um falso que guarda as chamadas. */
function recibosFalsos(/** @type {(id: string, status: string) => Promise<unknown>} */ responder = async () => ({ msg: "ok" })) {
  /** @type {{ mensagem_wa_id: string, status: string, contexto: any }[]} */
  const enviados = [];
  const recibos = criarRecibos({
    contexto: CONTEXTO,
    registrarStatusMensagem: async (mensagem_wa_id, status, contexto) => {
      enviados.push({ mensagem_wa_id, status, contexto });
      return responder(mensagem_wa_id, status);
    },
  });
  return { recibos, enviados };
}

test("os códigos do WAMessageStatus viram ENVIADA, ENTREGUE e LIDA; ERROR, PENDING e desconhecidos não viram nada", () => {
  assert.equal(statusDoCodigo(SERVER_ACK), "ENVIADA");
  assert.equal(statusDoCodigo(DELIVERY_ACK), "ENTREGUE");
  assert.equal(statusDoCodigo(READ), "LIDA");
  assert.equal(statusDoCodigo(PLAYED), "LIDA");
  for (const codigo of [ERROR, PENDING, 9, -1, "4", null, undefined]) assert.equal(statusDoCodigo(codigo), null);
});

test("um recibo de leitura vira LIDA para o mensagem_wa_id certo", async () => {
  const { recibos, enviados } = recibosFalsos();
  const itens = extrairDeAtualizacoes([atualizacao("3EB0LIDA1", READ), atualizacao("3EB0OUTRA", DELIVERY_ACK)]);
  assert.deepEqual(itens, [
    { mensagem_wa_id: "3EB0LIDA1", status: "LIDA" },
    { mensagem_wa_id: "3EB0OUTRA", status: "ENTREGUE" },
  ]);
  await recibos.processar(itens);
  assert.deepEqual(enviados, [
    { mensagem_wa_id: "3EB0LIDA1", status: "LIDA", contexto: CONTEXTO },
    { mensagem_wa_id: "3EB0OUTRA", status: "ENTREGUE", contexto: CONTEXTO },
  ]);
});

test("um recibo de mensagem desconhecida é ignorado sem erro (sem status mapeável, sem id, ou o back não conhece o id)", async () => {
  // Sem status mapeável ou sem id: nada chega ao back.
  const semEfeito = extrairDeAtualizacoes(
    /** @type {any} */ ([
      atualizacao("3EB0ERRO", ERROR),
      atualizacao("3EB0PEND", PENDING),
      { key: { remoteJid: JID_CLIENTE, fromMe: true, id: "3EB0ESTRELA" }, update: { starred: true } },
      { key: { remoteJid: JID_CLIENTE, fromMe: true }, update: { status: READ } },
      { key: { remoteJid: JID_CLIENTE, fromMe: true, id: "" }, update: { status: READ } },
      { key: { remoteJid: JID_CLIENTE, fromMe: true, id: "id com espaço" }, update: { status: READ } },
      { update: { status: READ } },
      null,
      "lixo",
    ])
  );
  assert.deepEqual(semEfeito, []);
  assert.deepEqual(extrairDeAtualizacoes(/** @type {any} */ (undefined)), []);
  assert.deepEqual(extrairDeRecibos(/** @type {any} */ ([{ key: { id: "3EB0X", fromMe: true }, receipt: {} }, { receipt: { readTimestamp: 1 } }, null]), EU), []);

  // Um id que o back não conhece: o back responde 200 sem efeito, e o wa-back segue sem erro.
  const { recibos, enviados } = recibosFalsos(async () => ({ msg: "Mensagem não encontrada.", atualizada: false }));
  await recibos.processar(extrairDeAtualizacoes([atualizacao("3EB0DESCONHECIDA", READ)]));
  assert.equal(enviados.length, 1);

  // Uma falha do back (rede, 4xx/5xx) também não rejeita nem interrompe os demais recibos.
  const falhando = recibosFalsos(async (id) => {
    if (id === "3EB0FALHA") throw Object.assign(new Error("HTTP 500"), { name: "ErroRotaInterna", status: 500 });
    return null;
  });
  await falhando.recibos.processar([
    { mensagem_wa_id: "3EB0FALHA", status: "LIDA" },
    { mensagem_wa_id: "3EB0SEGUE", status: "ENTREGUE" },
  ]);
  assert.deepEqual(falhando.enviados.map((e) => e.mensagem_wa_id), ["3EB0FALHA", "3EB0SEGUE"]);
});

test("só mensagens enviadas pela equipe (fromMe) têm status; a leitura de uma recebida por outro aparelho é ignorada", () => {
  assert.deepEqual(extrairDeAtualizacoes([atualizacao("3EB0RECEBIDA", READ, { fromMe: false })]), []);
});

test("em grupo, o recibo do participante vira ENTREGUE (receiptTimestamp) ou LIDA (readTimestamp/playedTimestamp); o da própria equipe é ignorado", () => {
  const key = (/** @type {string} */ id) => ({ remoteJid: JID_GRUPO, fromMe: true, id, participant: JID_PARTICIPANTE });
  const itens = extrairDeRecibos(
    [
      { key: key("3EB0G1"), receipt: { userJid: JID_PARTICIPANTE, receiptTimestamp: 1760400001 } },
      { key: key("3EB0G2"), receipt: { userJid: JID_PARTICIPANTE, readTimestamp: 1760400002 } },
      { key: key("3EB0G3"), receipt: { userJid: JID_PARTICIPANTE, playedTimestamp: 1760400003 } },
      // Recibo "sender"/"read-self" de outro aparelho da própria equipe: não é leitura do cliente.
      { key: key("3EB0G4"), receipt: { userJid: "5511900000099@s.whatsapp.net", readTimestamp: 1760400004 } },
      { key: key("3EB0G5"), receipt: { userJid: "100000000000099@lid", readTimestamp: 1760400005 } },
      // Recibo de uma mensagem que não foi enviada pela equipe.
      { key: { ...key("3EB0G6"), fromMe: false }, receipt: { userJid: JID_PARTICIPANTE, readTimestamp: 1760400006 } },
    ],
    EU
  );
  assert.deepEqual(itens, [
    { mensagem_wa_id: "3EB0G1", status: "ENTREGUE" },
    { mensagem_wa_id: "3EB0G2", status: "LIDA" },
    { mensagem_wa_id: "3EB0G3", status: "LIDA" },
  ]);
});

test("vale o maior status recebido: repetido ou menor que o já enviado não chama o back de novo (grupo com vários participantes)", async () => {
  const { recibos, enviados } = recibosFalsos();
  await recibos.processar([
    { mensagem_wa_id: "3EB0M", status: "ENVIADA" },
    { mensagem_wa_id: "3EB0M", status: "ENTREGUE" },
    { mensagem_wa_id: "3EB0M", status: "ENTREGUE" }, // segundo participante recebeu
    { mensagem_wa_id: "3EB0M", status: "LIDA" }, // o primeiro participante leu: LIDA
    { mensagem_wa_id: "3EB0M", status: "LIDA" }, // os demais lendo depois não geram chamada
    { mensagem_wa_id: "3EB0M", status: "ENTREGUE" }, // recibo atrasado nunca regride
  ]);
  assert.deepEqual(enviados.map((e) => e.status), ["ENVIADA", "ENTREGUE", "LIDA"]);
});

test("um envio que falhou não conta como enviado: o próximo recibo com o mesmo status tenta de novo", async () => {
  let falhar = true;
  const { recibos, enviados } = recibosFalsos(async () => {
    if (falhar) throw new Error("rede");
    return null;
  });
  await recibos.processar([{ mensagem_wa_id: "3EB0R", status: "LIDA" }]);
  falhar = false;
  await recibos.processar([{ mensagem_wa_id: "3EB0R", status: "LIDA" }]);
  assert.equal(enviados.length, 2);
});
