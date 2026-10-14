// @ts-check
// "Digitando..." do cliente: `presence.update` do Baileys 6.7.24 → `/interno/presenca` (função
// falsa injetada), só quando o estado muda, e a inscrição de presença por chat com cache.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { criarPresenca, estadoDaPresenca } = require("../../src/whatsapp/presenca");
const { JID_CLIENTE, LID_CLIENTE, JID_GRUPO, JID_PARTICIPANTE, EU } = require("../helpers/mensagensWa");

const CONTEXTO = { hash_empresa: "hash-a", cod_equipe: "21" };

function presencaFalsa() {
  /** @type {{ dados: any, contexto: any }[]} */
  const enviados = [];
  const presenca = criarPresenca({
    contexto: CONTEXTO,
    registrarPresenca: async (dados, contexto) => {
      enviados.push({ dados, contexto });
    },
  });
  return { presenca, enviados };
}

/** @param {string} id @param {string} participante @param {string} estado */
const evento = (id, participante, estado) => ({ id, presences: { [participante]: { lastKnownPresence: estado } } });

test("composing vira DIGITANDO, recording vira GRAVANDO, paused/available/unavailable viram PARADO", () => {
  assert.equal(estadoDaPresenca("composing"), "DIGITANDO");
  assert.equal(estadoDaPresenca("recording"), "GRAVANDO");
  for (const e of ["paused", "available", "unavailable"]) assert.equal(estadoDaPresenca(e), "PARADO");
  assert.equal(estadoDaPresenca("outro"), null);
  assert.equal(estadoDaPresenca(undefined), null);
});

test("o cliente digitando no privado vai ao back com participante_jid null, e o PARADO quando ele para", async () => {
  const { presenca, enviados } = presencaFalsa();
  await presenca.tratarAtualizacao(evento(JID_CLIENTE, JID_CLIENTE, "composing"), EU);
  // O Baileys converte o `paused` em `available`.
  await presenca.tratarAtualizacao(evento(JID_CLIENTE, JID_CLIENTE, "available"), EU);
  assert.deepEqual(enviados, [
    { dados: { chat_jid: JID_CLIENTE, participante_jid: null, estado: "DIGITANDO" }, contexto: CONTEXTO },
    { dados: { chat_jid: JID_CLIENTE, participante_jid: null, estado: "PARADO" }, contexto: CONTEXTO },
  ]);
});

test("em grupo vai o participante que está digitando ou gravando", async () => {
  const { presenca, enviados } = presencaFalsa();
  await presenca.tratarAtualizacao(evento(JID_GRUPO, JID_PARTICIPANTE, "recording"), EU);
  assert.deepEqual(enviados[0].dados, { chat_jid: JID_GRUPO, participante_jid: JID_PARTICIPANTE, estado: "GRAVANDO" });
});

test("só envia quando o estado muda: composing repetido e available sem digitação antes não chamam o back", async () => {
  const { presenca, enviados } = presencaFalsa();
  await presenca.tratarAtualizacao(evento(LID_CLIENTE, LID_CLIENTE, "available"), EU); // só online
  await presenca.tratarAtualizacao(evento(LID_CLIENTE, LID_CLIENTE, "composing"), EU);
  await presenca.tratarAtualizacao(evento(LID_CLIENTE, LID_CLIENTE, "composing"), EU);
  await presenca.tratarAtualizacao(evento(LID_CLIENTE, LID_CLIENTE, "composing"), EU);
  await presenca.tratarAtualizacao(evento(LID_CLIENTE, LID_CLIENTE, "unavailable"), EU);
  await presenca.tratarAtualizacao(evento(LID_CLIENTE, LID_CLIENTE, "available"), EU);
  assert.deepEqual(enviados.map((e) => e.dados.estado), ["DIGITANDO", "PARADO"]);
});

test("a presença da própria equipe (outro aparelho dela) nunca vai ao back, nem eventos inválidos", async () => {
  const { presenca, enviados } = presencaFalsa();
  await presenca.tratarAtualizacao(evento(JID_GRUPO, "5511900000099@s.whatsapp.net", "composing"), EU);
  await presenca.tratarAtualizacao(evento(JID_GRUPO, "100000000000099@lid", "composing"), EU);
  await presenca.tratarAtualizacao(evento(JID_CLIENTE, JID_CLIENTE, "desconhecido"), EU);
  await presenca.tratarAtualizacao(/** @type {any} */ ({ id: JID_CLIENTE }), EU);
  await presenca.tratarAtualizacao(/** @type {any} */ (null), EU);
  assert.equal(enviados.length, 0);
});

test("uma falha do back (rota da Task 7.1 ainda inexistente) só loga e não rejeita", async () => {
  const presenca = criarPresenca({
    contexto: CONTEXTO,
    registrarPresenca: async () => {
      throw Object.assign(new Error("HTTP 404"), { name: "ErroRotaInterna", status: 404 });
    },
  });
  await presenca.tratarAtualizacao(evento(JID_CLIENTE, JID_CLIENTE, "composing"), EU);
});

test("inscreve a presença de um chat uma vez só (cache); após limpar (socket novo) inscreve de novo; falha não rejeita", async () => {
  const { presenca } = presencaFalsa();
  /** @type {string[]} */
  const inscritos = [];
  const socket = { presenceSubscribe: async (/** @type {string} */ jid) => void inscritos.push(jid) };
  await presenca.inscrever(socket, JID_CLIENTE);
  await presenca.inscrever(socket, JID_CLIENTE);
  await presenca.inscrever(socket, JID_GRUPO);
  assert.deepEqual(inscritos, [JID_CLIENTE, JID_GRUPO]);

  presenca.limparInscricoes();
  await presenca.inscrever(socket, JID_CLIENTE);
  assert.deepEqual(inscritos, [JID_CLIENTE, JID_GRUPO, JID_CLIENTE]);

  // Falha na inscrição: não rejeita, e a próxima mensagem do chat tenta de novo.
  let falhas = 0;
  const falho = {
    presenceSubscribe: async () => {
      falhas += 1;
      throw new Error("socket fechado");
    },
  };
  await presenca.inscrever(falho, "5511900000003@s.whatsapp.net");
  await presenca.inscrever(falho, "5511900000003@s.whatsapp.net");
  assert.equal(falhas, 2);
  // Socket sem presenceSubscribe ou jid inválido: no-op.
  await presenca.inscrever(/** @type {any} */ ({}), JID_CLIENTE + "x");
  await presenca.inscrever(socket, /** @type {any} */ (null));
});
