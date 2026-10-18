// @ts-check
// Nome (subject) do grupo para o `nome_chat` do registro: `groupMetadata` com cache, prazo curto
// e nunca rejeita. O socket é um objeto falso.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { criarCacheNomeGrupo } = require("../../src/whatsapp/nomeGrupo");
const { JID_GRUPO } = require("../helpers/mensagensWa");

test("busca o subject uma vez e devolve do cache nas mensagens seguintes (chamadas simultâneas compartilham a busca)", async () => {
  const cache = criarCacheNomeGrupo();
  let chamadas = 0;
  const socket = {
    groupMetadata: async (/** @type {string} */ jid) => {
      chamadas += 1;
      return { id: jid, subject: "  Suporte Loja Centro  " };
    },
  };
  const [a, b] = await Promise.all([cache.obterNome(socket, JID_GRUPO), cache.obterNome(socket, JID_GRUPO)]);
  assert.equal(a, "Suporte Loja Centro");
  assert.equal(b, "Suporte Loja Centro");
  assert.equal(await cache.obterNome(socket, JID_GRUPO), "Suporte Loja Centro");
  assert.equal(chamadas, 1);
});

test("o cache expira pelo TTL", async () => {
  let agora = 1000;
  const cache = criarCacheNomeGrupo({ msTtl: 100, agora: () => agora });
  let n = 0;
  const socket = { groupMetadata: async () => ({ subject: `Grupo ${++n}` }) };
  assert.equal(await cache.obterNome(socket, JID_GRUPO), "Grupo 1");
  agora += 50;
  assert.equal(await cache.obterNome(socket, JID_GRUPO), "Grupo 1");
  agora += 100;
  assert.equal(await cache.obterNome(socket, JID_GRUPO), "Grupo 2");
});

test("falha, prazo esgotado ou subject vazio devolvem null sem rejeitar, e a falha não é repetida a cada mensagem", async () => {
  const cache = criarCacheNomeGrupo({ msPrazo: 20 });
  let chamadas = 0;
  const falho = {
    groupMetadata: async () => {
      chamadas += 1;
      throw new Error("rate-overlimit");
    },
  };
  assert.equal(await cache.obterNome(falho, JID_GRUPO), null);
  assert.equal(await cache.obterNome(falho, JID_GRUPO), null);
  assert.equal(chamadas, 1);

  const inicio = Date.now();
  const lento = { groupMetadata: () => new Promise(() => {}) };
  assert.equal(await cache.obterNome(lento, "120363000000000077@g.us"), null);
  assert.ok(Date.now() - inicio < 1000, "o prazo curto limita a espera");

  const vazio = { groupMetadata: async () => ({ subject: "   " }) };
  assert.equal(await cache.obterNome(vazio, "120363000000000078@g.us"), null);
  assert.equal(await cache.obterNome(/** @type {any} */ ({}), "120363000000000079@g.us"), null);
  assert.equal(await cache.obterNome(vazio, "5511900000001@s.whatsapp.net"), null, "só grupos");
});

test("groups.update com subject novo atualiza o cache sem nova consulta", async () => {
  const cache = criarCacheNomeGrupo();
  let chamadas = 0;
  const socket = {
    groupMetadata: async () => {
      chamadas += 1;
      return { subject: "Nome antigo" };
    },
  };
  assert.equal(await cache.obterNome(socket, JID_GRUPO), "Nome antigo");
  cache.aprender([{ id: JID_GRUPO, subject: "Nome novo" }, { id: JID_GRUPO, announce: true }, /** @type {any} */ (null)]);
  assert.equal(await cache.obterNome(socket, JID_GRUPO), "Nome novo");
  assert.equal(chamadas, 1);
});

// ---- Task 17.1: participantes na mesma consulta ----

const { ErroConsultaGrupo } = require("../../src/whatsapp/nomeGrupo");
const LID_A = "10000000000001@lid";
const FONE_A = "5511900000003";

/** @param {() => void} [aoConsultar] */
function socketComParticipantes(aoConsultar) {
  const socket = {
    consultas: 0,
    groupMetadata: async (/** @type {string} */ jid) => {
      socket.consultas += 1;
      aoConsultar?.();
      return {
        id: jid,
        subject: "Suporte",
        addressingMode: "lid",
        participants: [
          { id: LID_A, lid: LID_A, jid: `${FONE_A}@s.whatsapp.net`, admin: "admin" },
          { id: "100000000000004@lid", admin: null },
          { id: "5511900000005@s.whatsapp.net", admin: "superadmin" },
          { id: "sem-arroba" },
        ],
      };
    },
  };
  return socket;
}

test("obterParticipantes mapeia id/lid/telefone/admin do groupMetadata e descarta item sem JID", async () => {
  const cache = criarCacheNomeGrupo();
  const participantes = await cache.obterParticipantes(socketComParticipantes(), JID_GRUPO);
  assert.deepEqual(participantes, [
    { jid: LID_A, lid: LID_A, telefone: FONE_A, admin: true },
    { jid: "100000000000004@lid", lid: "100000000000004@lid", telefone: null, admin: false },
    { jid: "5511900000005@s.whatsapp.net", lid: null, telefone: "5511900000005", admin: true },
  ]);
});

test("duas chamadas simultâneas (nome e participantes) fazem uma única consulta ao groupMetadata", async () => {
  const cache = criarCacheNomeGrupo();
  const socket = socketComParticipantes();
  const [nome, a, b] = await Promise.all([cache.obterNome(socket, JID_GRUPO), cache.obterParticipantes(socket, JID_GRUPO), cache.obterParticipantes(socket, JID_GRUPO)]);
  assert.equal(nome, "Suporte");
  assert.equal(a.length, 3);
  assert.deepEqual(a, b);
  await cache.obterParticipantes(socket, JID_GRUPO);
  assert.equal(socket.consultas, 1);
});

test("group-participants.update (esquecer) invalida o cache; groups.update invalida só os participantes e mantém o nome", async () => {
  const cache = criarCacheNomeGrupo();
  const socket = socketComParticipantes();
  await cache.obterParticipantes(socket, JID_GRUPO);
  cache.esquecer(JID_GRUPO);
  await cache.obterParticipantes(socket, JID_GRUPO);
  assert.equal(socket.consultas, 2);

  cache.aprender([{ id: JID_GRUPO, subject: "Suporte Novo" }]);
  assert.equal(await cache.obterNome(socket, JID_GRUPO), "Suporte Novo");
  assert.equal(socket.consultas, 2, "o nome não precisa de nova consulta");
  await cache.obterParticipantes(socket, JID_GRUPO);
  assert.equal(socket.consultas, 3, "os participantes são buscados de novo");
});

test("uma consulta iniciada antes do esquecer não grava o resultado velho", async () => {
  const cache = criarCacheNomeGrupo();
  const socket = socketComParticipantes();
  const primeira = cache.obterParticipantes(socket, JID_GRUPO);
  cache.esquecer(JID_GRUPO);
  await primeira;
  await cache.obterParticipantes(socket, JID_GRUPO);
  assert.equal(socket.consultas, 2);
});

test("obterParticipantes rejeita com código: prazo, grupo não encontrado (403/404) e falha; a falha fica em cache curto", async () => {
  const cache = criarCacheNomeGrupo({ msPrazo: 20 });
  const lento = { groupMetadata: () => new Promise(() => {}) };
  await assert.rejects(cache.obterParticipantes(lento, JID_GRUPO), (e) => e instanceof ErroConsultaGrupo && e.codigo === "PRAZO_ESGOTADO");

  let chamadas = 0;
  const fora = {
    groupMetadata: async () => {
      chamadas += 1;
      throw Object.assign(new Error("forbidden"), { output: { statusCode: 403 } });
    },
  };
  const outro = "120363000000000055@g.us";
  await assert.rejects(cache.obterParticipantes(fora, outro), (e) => e instanceof ErroConsultaGrupo && e.codigo === "GRUPO_NAO_ENCONTRADO");
  await assert.rejects(cache.obterParticipantes(fora, outro), (e) => e instanceof ErroConsultaGrupo && e.codigo === "GRUPO_NAO_ENCONTRADO");
  assert.equal(chamadas, 1);

  const quebrado = { groupMetadata: async () => { throw new Error("rate-overlimit"); } };
  await assert.rejects(cache.obterParticipantes(quebrado, "120363000000000056@g.us"), (e) => e instanceof ErroConsultaGrupo && e.codigo === "FALHA");
  await assert.rejects(cache.obterParticipantes(socketComParticipantes(), "5511900000001@s.whatsapp.net"), (e) => e instanceof ErroConsultaGrupo);
});

test("a invalidação do grupo A não afeta a consulta em andamento do grupo B (que continua única e é gravada)", async () => {
  const cache = criarCacheNomeGrupo();
  const grupoA = "120363000000000091@g.us";
  const grupoB = "120363000000000092@g.us";
  /** @type {(() => void) | null} */
  let liberarB = null;
  let consultasB = 0;
  const socket = {
    groupMetadata: (/** @type {string} */ jid) => {
      if (jid === grupoB) {
        consultasB += 1;
        return new Promise((resolve) => (liberarB = () => resolve({ subject: "B", participants: [] })));
      }
      return Promise.resolve({ subject: "A", participants: [] });
    },
  };
  const emAndamentoB = cache.obterParticipantes(socket, grupoB);
  const outraB = cache.obterParticipantes(socket, grupoB);
  await new Promise((resolve) => setImmediate(resolve));
  cache.esquecer(grupoA);
  cache.aprender([{ id: grupoA, subject: "A2" }]);
  /** @type {() => void} */ (/** @type {unknown} */ (liberarB))();
  await Promise.all([emAndamentoB, outraB]);
  await cache.obterParticipantes(socket, grupoB);
  assert.equal(consultasB, 1, "uma consulta só, e o resultado de B foi para o cache");
});

// ---------- podeAdicionar (Fase 28, Task 28.1) ----------

const EU_ID = { jid: "5511900000099:7@s.whatsapp.net", lid: "100000000000099:7@lid" };
const EU_NO_GRUPO = { id: "100000000000099@lid", lid: "100000000000099@lid", jid: "5511900000099@s.whatsapp.net" };

/** @param {any[]} participants @param {boolean | undefined} memberAddMode */
const socketComGrupo = (participants, memberAddMode) => {
  const estado = { consultas: 0 };
  return {
    estado,
    groupMetadata: async (/** @type {string} */ jid) => {
      estado.consultas += 1;
      return { id: jid, subject: "Suporte", participants, ...(memberAddMode === undefined ? {} : { memberAddMode }) };
    },
  };
};

test("podeAdicionar: admin pode; participante comum só com memberAddMode; usa uma consulta e o cache", async () => {
  const cache = criarCacheNomeGrupo();
  const admin = socketComGrupo([{ ...EU_NO_GRUPO, admin: "admin" }], false);
  assert.equal(await cache.podeAdicionar(admin, JID_GRUPO, EU_ID), true);
  assert.equal(await cache.podeAdicionar(admin, JID_GRUPO, EU_ID), true);
  assert.equal(admin.estado.consultas, 1);

  const superadmin = socketComGrupo([{ ...EU_NO_GRUPO, admin: "superadmin" }], false);
  assert.equal(await criarCacheNomeGrupo().podeAdicionar(superadmin, JID_GRUPO, EU_ID), true);

  const comum = socketComGrupo([{ ...EU_NO_GRUPO, admin: null }], false);
  assert.equal(await criarCacheNomeGrupo().podeAdicionar(comum, JID_GRUPO, EU_ID), false);
  const semCampo = socketComGrupo([{ ...EU_NO_GRUPO, admin: null }], undefined);
  assert.equal(await criarCacheNomeGrupo().podeAdicionar(semCampo, JID_GRUPO, EU_ID), false, "sem memberAddMode vale só admin");
  const todosAdicionam = socketComGrupo([{ ...EU_NO_GRUPO, admin: null }], true);
  assert.equal(await criarCacheNomeGrupo().podeAdicionar(todosAdicionam, JID_GRUPO, EU_ID), true);
});

test("podeAdicionar: número da equipe fora do grupo, grupo inválido e falha da consulta rejeitam com ErroConsultaGrupo", async () => {
  const cache = criarCacheNomeGrupo({ msPrazo: 20 });
  const fora = socketComGrupo([{ id: "100000000000004@lid", lid: "100000000000004@lid", admin: "admin" }], true);
  await assert.rejects(cache.podeAdicionar(fora, JID_GRUPO, EU_ID), (e) => e instanceof ErroConsultaGrupo && e.codigo === "GRUPO_NAO_ENCONTRADO");
  await assert.rejects(cache.podeAdicionar(fora, "5511900000001@s.whatsapp.net", EU_ID), (e) => e instanceof ErroConsultaGrupo && e.codigo === "GRUPO_NAO_ENCONTRADO");
  await assert.rejects(cache.podeAdicionar({}, JID_GRUPO, EU_ID), (e) => e instanceof ErroConsultaGrupo && e.codigo === "FALHA");
  const lento = { groupMetadata: () => new Promise(() => {}) };
  await assert.rejects(cache.podeAdicionar(lento, "120363000000000090@g.us", EU_ID), (e) => e instanceof ErroConsultaGrupo && e.codigo === "PRAZO_ESGOTADO");
});
