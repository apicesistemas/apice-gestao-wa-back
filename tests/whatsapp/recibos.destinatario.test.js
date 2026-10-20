// @ts-check
// Recibo por destinatário (Fase 38, contrato C1): extração dos eventos do Baileys 6.7.24, D2 (PLAYED conta
// como lida), D3 (horário individual = instante da extração), o próprio número fora, a retenção do envio do
// CRM e a separação do status agregado (que não muda). O lote e o back são falsos.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { extrairDeAtualizacoes, extrairDeRecibos, criarRecibos, ehPorDestinatario } = require("../../src/whatsapp/recibos");
const { criarResolvedorLid } = require("../../src/whatsapp/resolverLid");
const { JID_CLIENTE, JID_GRUPO, JID_PARTICIPANTE, TELEFONE_PARTICIPANTE, LID_PARTICIPANTE, EU, long } = require("../helpers/mensagensWa");

const DELIVERY_ACK = 3;
const READ = 4;
const PLAYED = 5;
const SERVER_ACK = 2;
const CONTEXTO = { hash_empresa: "hash-a", cod_equipe: "21" };
/** 2026-10-20T15:00:00Z em ms. */
const AGORA_MS = Date.UTC(2026, 9, 20, 15, 0, 0);
const AGORA_S = AGORA_MS / 1000;

const keyGrupo = (/** @type {string} */ id) => ({ remoteJid: JID_GRUPO, fromMe: true, id, participant: JID_PARTICIPANTE });
const porDestinatario = (/** @type {any[]} */ itens) => itens.filter(ehPorDestinatario);
const agregados = (/** @type {any[]} */ itens) => itens.filter((i) => !ehPorDestinatario(i));

test("recibo de grupo com LID vira { lid, telefone } (par do resolvedor), sem JID nem nome no item", () => {
  const resolvedor = criarResolvedorLid();
  resolvedor.aprenderPar(LID_PARTICIPANTE, TELEFONE_PARTICIPANTE);
  const itens = extrairDeRecibos(
    [{ key: keyGrupo("3EB0G1"), receipt: { userJid: LID_PARTICIPANTE, receiptTimestamp: 1760400001 } }],
    EU,
    resolvedor
  );
  assert.deepEqual(porDestinatario(itens), [
    { mensagem_wa_id: "3EB0G1", destinatario: { lid: LID_PARTICIPANTE, telefone: TELEFONE_PARTICIPANTE }, entregue_em: 1760400001, lida_em: null },
  ]);
  assert.deepEqual(agregados(itens), [{ mensagem_wa_id: "3EB0G1", status: "ENTREGUE" }]);
  const texto = JSON.stringify(porDestinatario(itens));
  assert.doesNotMatch(texto, /s\.whatsapp\.net|pushName|nome/);
});

test("recibo de grupo com o telefone completa o LID pelo resolvedor; sem par conhecido vai só o telefone", () => {
  const resolvedor = criarResolvedorLid();
  const recibo = [{ key: keyGrupo("3EB0G2"), receipt: { userJid: JID_PARTICIPANTE, readTimestamp: 1760400002 } }];
  assert.deepEqual(porDestinatario(extrairDeRecibos(recibo, EU, resolvedor))[0].destinatario, { lid: null, telefone: TELEFONE_PARTICIPANTE });
  resolvedor.aprenderPar(LID_PARTICIPANTE, TELEFONE_PARTICIPANTE);
  assert.deepEqual(porDestinatario(extrairDeRecibos(recibo, EU, resolvedor))[0].destinatario, { lid: LID_PARTICIPANTE, telefone: TELEFONE_PARTICIPANTE });
  // Sem resolvedor (uso isolado): o que o userJid traz.
  assert.deepEqual(porDestinatario(extrairDeRecibos(recibo, EU))[0].destinatario, { lid: null, telefone: TELEFONE_PARTICIPANTE });
  // Só LID sem par: o LID basta.
  const soLid = [{ key: keyGrupo("3EB0G3"), receipt: { userJid: "100000000000077@lid", readTimestamp: 5 } }];
  assert.deepEqual(porDestinatario(extrairDeRecibos(soLid, EU, resolvedor))[0].destinatario, { lid: "100000000000077@lid", telefone: null });
});

test("o próprio número nunca entra: nem pelo JID, nem pelo LID, nem quando o par do resolvedor aponta para ele", () => {
  const resolvedor = criarResolvedorLid();
  resolvedor.aprenderPar("100000000000055@lid", "5511900000099"); // um LID que, no cache, é o telefone da equipe
  const itens = extrairDeRecibos(
    [
      { key: keyGrupo("3EB0P1"), receipt: { userJid: "5511900000099@s.whatsapp.net", readTimestamp: 1 } },
      { key: keyGrupo("3EB0P2"), receipt: { userJid: "5511900000099:3@s.whatsapp.net", readTimestamp: 1 } },
      { key: keyGrupo("3EB0P3"), receipt: { userJid: "100000000000099@lid", receiptTimestamp: 1 } },
      { key: keyGrupo("3EB0P4"), receipt: { userJid: "100000000000055@lid", receiptTimestamp: 1 } },
    ],
    EU,
    resolvedor
  );
  // Nenhum item por destinatário. O status agregado fica como sempre foi: só o P4, que só o par do resolvedor
  // revela como o próprio número, ainda conta nele (a regra do agregado não muda na Fase 38).
  assert.deepEqual(porDestinatario(itens), []);
  assert.deepEqual(agregados(itens).map((i) => i.mensagem_wa_id), ["3EB0P4"]);
  // O LID da equipe sem JID (só `lid`) também é reconhecido.
  assert.deepEqual(
    extrairDeRecibos([{ key: keyGrupo("3EB0P5"), receipt: { userJid: "100000000000099@lid", readTimestamp: 1 } }], { lid: "100000000000099:7@lid" }, resolvedor),
    []
  );
});

test("o recibo unido (entrega e leitura juntas) gera UM item por destinatário com os dois horários; PLAYED conta como lida (D2)", () => {
  const unido = extrairDeRecibos(
    [{ key: keyGrupo("3EB0U1"), receipt: { userJid: JID_PARTICIPANTE, receiptTimestamp: 1760400001, readTimestamp: 1760400009 } }],
    EU
  );
  assert.deepEqual(porDestinatario(unido), [
    { mensagem_wa_id: "3EB0U1", destinatario: { lid: null, telefone: TELEFONE_PARTICIPANTE }, entregue_em: 1760400001, lida_em: 1760400009 },
  ]);
  assert.deepEqual(agregados(unido), [{ mensagem_wa_id: "3EB0U1", status: "LIDA" }], "o agregado segue o maior status");

  const tocado = extrairDeRecibos([{ key: keyGrupo("3EB0U2"), receipt: { userJid: JID_PARTICIPANTE, playedTimestamp: 1760400005 } }], EU);
  assert.deepEqual(porDestinatario(tocado)[0], {
    mensagem_wa_id: "3EB0U2",
    destinatario: { lid: null, telefone: TELEFONE_PARTICIPANTE },
    entregue_em: null,
    lida_em: 1760400005,
  });
  // Lida e tocada: o menor horário.
  const dois = extrairDeRecibos([{ key: keyGrupo("3EB0U3"), receipt: { userJid: JID_PARTICIPANTE, readTimestamp: 10, playedTimestamp: 7 } }], EU);
  assert.equal(porDestinatario(dois)[0].lida_em, 7);
});

test("timestamps em Long do protobufjs viram epoch em segundos; zero, negativo ou sem valor não geram item por destinatário", () => {
  const itens = extrairDeRecibos(
    [
      { key: keyGrupo("3EB0L1"), receipt: { userJid: JID_PARTICIPANTE, receiptTimestamp: long(1760400001) } },
      { key: keyGrupo("3EB0L2"), receipt: { userJid: JID_PARTICIPANTE, receiptTimestamp: 0 } },
      { key: keyGrupo("3EB0L3"), receipt: { userJid: JID_PARTICIPANTE, receiptTimestamp: -4 } },
      { key: keyGrupo("3EB0L4"), receipt: { userJid: JID_PARTICIPANTE, receiptTimestamp: { low: 1, high: 0 } } },
    ],
    EU
  );
  assert.deepEqual(porDestinatario(itens).map((i) => [i.mensagem_wa_id, i.entregue_em]), [["3EB0L1", 1760400001]]);
});

test("userJid inválido ou ausente em grupo: o agregado segue, mas não há destinatário para o item por destinatário", () => {
  const itens = extrairDeRecibos(
    [
      { key: keyGrupo("3EB0V1"), receipt: { userJid: "status@broadcast", readTimestamp: 1 } },
      { key: keyGrupo("3EB0V2"), receipt: { readTimestamp: 1 } },
    ],
    EU
  );
  assert.deepEqual(porDestinatario(itens), []);
  assert.deepEqual(agregados(itens).map((i) => i.mensagem_wa_id), ["3EB0V1", "3EB0V2"]);
});

test("recibo trazido por uma mensagem de conversa individual (userReceipt) vira destinatario null com os horários dele", () => {
  const key = { remoteJid: JID_CLIENTE, fromMe: true, id: "3EB0I1" };
  const itens = extrairDeRecibos([{ key, receipt: { userJid: JID_CLIENTE, receiptTimestamp: 1760400001, readTimestamp: 1760400004 } }], EU);
  assert.deepEqual(porDestinatario(itens), [{ mensagem_wa_id: "3EB0I1", destinatario: null, entregue_em: 1760400001, lida_em: 1760400004 }]);
});

test("individual: o horário é o instante da extração; entrega vira entregue_em e leitura (READ ou PLAYED) vira lida_em", () => {
  const atualizacao = (/** @type {string} */ id, /** @type {number} */ status, /** @type {any} */ key = {}) => ({
    key: { remoteJid: JID_CLIENTE, fromMe: true, id, ...key },
    update: { status },
  });
  const itens = extrairDeAtualizacoes(
    [atualizacao("3EB0D1", DELIVERY_ACK), atualizacao("3EB0D2", READ), atualizacao("3EB0D3", PLAYED)],
    () => AGORA_MS + 400 // 400 ms depois: o segundo é truncado
  );
  assert.deepEqual(porDestinatario(itens), [
    { mensagem_wa_id: "3EB0D1", destinatario: null, entregue_em: AGORA_S, lida_em: null },
    { mensagem_wa_id: "3EB0D2", destinatario: null, entregue_em: null, lida_em: AGORA_S },
    { mensagem_wa_id: "3EB0D3", destinatario: null, entregue_em: null, lida_em: AGORA_S },
  ]);
  assert.deepEqual(agregados(itens).map((i) => i.status), ["ENTREGUE", "LIDA", "LIDA"]);

  // LID como chat privado também é individual.
  const lid = extrairDeAtualizacoes([atualizacao("3EB0D4", READ, { remoteJid: LID_PARTICIPANTE })], () => AGORA_MS);
  assert.equal(porDestinatario(lid).length, 1);
});

test("SERVER_ACK não gera item por destinatário (só o agregado ENVIADA); mensagem recebida, grupo e status inválido também não", () => {
  const base = { remoteJid: JID_CLIENTE, fromMe: true };
  const itens = extrairDeAtualizacoes(
    [
      { key: { ...base, id: "3EB0S1" }, update: { status: SERVER_ACK } },
      { key: { ...base, id: "3EB0S2", fromMe: false }, update: { status: READ } },
      { key: { ...base, id: "3EB0S3", remoteJid: JID_GRUPO }, update: { status: READ } },
      { key: { ...base, id: "3EB0S4" }, update: { status: 1 } },
    ],
    () => AGORA_MS
  );
  assert.deepEqual(porDestinatario(itens), []);
  assert.deepEqual(agregados(itens), [
    { mensagem_wa_id: "3EB0S1", status: "ENVIADA" },
    { mensagem_wa_id: "3EB0S3", status: "LIDA" },
  ]);
});

/** Lote falso: guarda o que `processar` entregou a ele. */
function criarLoteFalso() {
  /** @type {any[]} */
  const itens = [];
  let limpou = 0;
  return { itens, adicionar: (/** @type {any} */ item) => void itens.push(item), limpar: () => void (limpou += 1), limpezas: () => limpou };
}

test("processar separa o agregado (back, inalterado) do item por destinatário (lote), na ordem dos eventos", async () => {
  const lote = criarLoteFalso();
  /** @type {string[]} */
  const status = [];
  const recibos = criarRecibos({
    contexto: CONTEXTO,
    lote,
    registrarStatusMensagem: async (id, s) => void status.push(`${id}:${s}`),
  });
  await recibos.processar(extrairDeAtualizacoes([{ key: { remoteJid: JID_CLIENTE, fromMe: true, id: "3EB0M1" }, update: { status: READ } }], () => AGORA_MS));
  assert.deepEqual(status, ["3EB0M1:LIDA"]);
  assert.deepEqual(lote.itens, [{ mensagem_wa_id: "3EB0M1", destinatario: null, entregue_em: null, lida_em: AGORA_S }]);
  // Repetido: o agregado não volta (maior status), e o item por destinatário vai ao lote, que deduplica.
  await recibos.processar([{ mensagem_wa_id: "3EB0M1", status: "LIDA" }]);
  assert.deepEqual(status, ["3EB0M1:LIDA"]);
  recibos.limpar();
  assert.equal(lote.limpezas(), 1);
});

test("sem lote o item por destinatário é descartado e o agregado segue; uma falha do lote não rejeita nem para os demais itens", async () => {
  /** @type {string[]} */
  const status = [];
  const semLote = criarRecibos({ contexto: CONTEXTO, registrarStatusMensagem: async (id, s) => void status.push(`${id}:${s}`) });
  await semLote.processar([
    { mensagem_wa_id: "3EB0N1", destinatario: null, entregue_em: 1, lida_em: null },
    { mensagem_wa_id: "3EB0N1", status: "ENTREGUE" },
  ]);
  assert.deepEqual(status, ["3EB0N1:ENTREGUE"]);

  const originalErro = console.error;
  /** @type {string[]} */
  const linhas = [];
  console.error = (...args) => void linhas.push(args.map(String).join(" "));
  try {
    const quebrado = criarRecibos({
      contexto: CONTEXTO,
      lote: {
        adicionar: () => {
          throw new Error("lote quebrou com 5511900000002");
        },
      },
      registrarStatusMensagem: async (id, s) => void status.push(`${id}:${s}`),
    });
    await quebrado.processar([
      { mensagem_wa_id: "3EB0N2", destinatario: { lid: null, telefone: TELEFONE_PARTICIPANTE }, entregue_em: 1, lida_em: null },
      { mensagem_wa_id: "3EB0N2", status: "ENTREGUE" },
    ]);
  } finally {
    console.error = originalErro;
  }
  assert.deepEqual(status, ["3EB0N1:ENTREGUE", "3EB0N2:ENTREGUE"]);
  assert.equal(linhas.length, 1);
  assert.match(linhas[0], /equipe 21/);
  assert.doesNotMatch(linhas[0], new RegExp(TELEFONE_PARTICIPANTE), "o log não leva o texto do erro");
});

/** @param {number} ms */
const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("a retenção do envio do CRM vale para o item por destinatário e preserva o horário original da extração", async () => {
  const lote = criarLoteFalso();
  /** @type {any} */
  const recibos = criarRecibos({
    contexto: CONTEXTO,
    lote,
    msAtrasoEnvio: 40,
    registrarStatusMensagem: async () => {},
    liberar: (itens) => recibos.processar(itens),
  });
  recibos.adiarRecibos("3EB0CRM1");
  // O horário é capturado na extração (AGORA_S), muito antes da liberação.
  const itens = extrairDeAtualizacoes([{ key: { remoteJid: JID_CLIENTE, fromMe: true, id: "3EB0CRM1" }, update: { status: DELIVERY_ACK } }], () => AGORA_MS);
  await recibos.processar(itens);
  await recibos.processar(extrairDeRecibos([{ key: { ...keyGrupo("3EB0CRM2") }, receipt: { userJid: JID_PARTICIPANTE, receiptTimestamp: 7 } }], EU));
  assert.deepEqual(lote.itens.map((i) => i.mensagem_wa_id), ["3EB0CRM2"], "o id retido não foi ao lote; o outro sai na hora");

  await esperar(90);
  assert.deepEqual(lote.itens[1], { mensagem_wa_id: "3EB0CRM1", destinatario: null, entregue_em: AGORA_S, lida_em: null });
  assert.equal(lote.itens.length, 2);
});

test("limpar descarta os itens por destinatário retidos (sessão apagada)", async () => {
  const lote = criarLoteFalso();
  const recibos = criarRecibos({ contexto: CONTEXTO, lote, msAtrasoEnvio: 30, registrarStatusMensagem: async () => {} });
  recibos.adiarRecibos("3EB0CRM3");
  await recibos.processar([{ mensagem_wa_id: "3EB0CRM3", destinatario: null, entregue_em: 1, lida_em: null }]);
  recibos.limpar();
  await esperar(70);
  assert.deepEqual(lote.itens, []);
});
