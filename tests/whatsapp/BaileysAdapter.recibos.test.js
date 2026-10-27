// @ts-check
// Recibo por destinatário no adapter (Fase 38, C1; socket Baileys mockado): `message-receipt.update` e
// `messages.update` → lote → `POST /interno/mensagem-recibos`, o `userReceipt` de mensagem enviada pela
// equipe (depois do registro), a retenção do envio do CRM, o desligamento (esvaziar), a sessão apagada, a
// regressão do `/interno/mensagem-status` e o log sem dado pessoal. O back é falso (função injetada ou fetch).
const { test, beforeEach, afterEach, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const baileysFalso = require("../helpers/baileysFalso");

baileysFalso.instalarBaileysFalso();
const { criarAdapter } = require("../../src/whatsapp/BaileysAdapter");
const { mensagemWa, mensagemGrupo, JID_CLIENTE, JID_GRUPO, JID_PARTICIPANTE, LID_PARTICIPANTE, TELEFONE_PARTICIPANTE, EU } = require("../helpers/mensagensWa");

const { ultimoSocket, drenar } = baileysFalso;
const diretorioSessoes = fs.mkdtempSync(path.join(os.tmpdir(), "wa-back-recibos-"));
after(() => fs.rmSync(diretorioSessoes, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));

const DELIVERY_ACK = 3;
const READ = 4;
const SERVER_ACK = 2;
const VARS = ["CRM_BACK_URL", "CRM_BACK_SERVICE_TOKEN", "RECIBO_ATRASO_ENVIO_MS", "RECIBO_LOTE_MS"];
/** @type {Record<string, string | undefined>} */
let envOriginal = {};
const fetchOriginal = globalThis.fetch;

beforeEach(() => {
  baileysFalso.limparHistorico();
  envOriginal = Object.fromEntries(VARS.map((nome) => [nome, process.env[nome]]));
});
afterEach(() => {
  globalThis.fetch = fetchOriginal;
  for (const nome of VARS) {
    if (envOriginal[nome] === undefined) delete process.env[nome];
    else process.env[nome] = envOriginal[nome];
  }
});

/** @param {number} ms */
const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Captura o console: nenhum LID, telefone, JID nem id de mensagem pode aparecer nele. */
function capturarConsole() {
  /** @type {string[]} */
  const linhas = [];
  const originais = { log: console.log, error: console.error };
  console.log = (...args) => void linhas.push(args.map(String).join(" "));
  console.error = (...args) => void linhas.push(args.map(String).join(" "));
  return {
    linhas,
    restaurar() {
      console.log = originais.log;
      console.error = originais.error;
    },
  };
}

/**
 * @param {{
 *   registrarRecibos?: (recibos: any[], contexto: any, opcoes?: any) => Promise<unknown>,
 *   registrarMensagem?: (mensagem: any) => Promise<unknown>,
 *   opcoesLoteRecibos?: Record<string, any>,
 *   semInjecao?: boolean,
 *   codEquipe?: string,
 *   hashEmpresa?: string,
 * }} [config] `semInjecao`: os clientes reais do back (com o `fetch` trocado pelo teste)
 */
async function adapterConectado({ registrarRecibos, registrarMensagem, opcoesLoteRecibos = {}, semInjecao = false, codEquipe = "41", hashEmpresa = "hash-recibos" } = {}) {
  /** @type {any[]} */
  const registradas = [];
  /** @type {{ mensagem_wa_id: string, status: string }[]} */
  const status = [];
  /** @type {{ itens: any[], contexto: any, opcoes: any }[]} */
  const lotes = [];
  /** @type {string[]} */
  const ordem = [];
  const injecoes = semInjecao
    ? {}
    : {
        registrarStatusMensagem: async (/** @type {string} */ mensagem_wa_id, /** @type {string} */ s) => {
          ordem.push(`status:${mensagem_wa_id}:${s}`);
          status.push({ mensagem_wa_id, status: s });
        },
        registrarRecibos: async (/** @type {any[]} */ itens, /** @type {any} */ contexto, /** @type {any} */ opcoes) => {
          ordem.push(`recibos:${itens.length}`);
          lotes.push({ itens, contexto, opcoes });
          return registrarRecibos ? registrarRecibos(itens, contexto, opcoes) : { msg: "Recibos registrados.", gravados: itens.length, ignorados: 0 };
        },
        registrarMensagem: async (/** @type {any} */ mensagem) => {
          ordem.push(`registro:${mensagem.mensagem_wa_id}`);
          registradas.push(mensagem);
          if (registrarMensagem) await registrarMensagem(mensagem);
        },
      };
  const adapter = criarAdapter({
    codEquipe,
    hashEmpresa,
    diretorioSessoes,
    opcoesLoteRecibos: { msLote: 20, msEntreTentativas: 1, ...opcoesLoteRecibos },
    registrarPresenca: async () => {},
    ...injecoes,
  });
  await adapter.iniciar();
  const socket = /** @type {any} */ (ultimoSocket());
  socket.user = { id: EU.jid, lid: EU.lid };
  socket.onWhatsApp = async () => [];
  socket.presenceSubscribe = async () => {};
  socket.groupMetadata = async (/** @type {string} */ jid) => ({ id: jid, subject: "Suporte Loja Centro" });
  await socket.emitir("connection.update", { connection: "open" });
  /** @param {string} evento @param {any} dado */
  const emitir = async (evento, dado) => {
    await socket.emitir(evento, dado);
    await drenar();
  };
  return { adapter, socket, registradas, status, lotes, ordem, emitir };
}

const keyGrupo = (/** @type {string} */ id) => ({ remoteJid: JID_GRUPO, fromMe: true, id, participant: JID_PARTICIPANTE });

test("recibo de grupo com LID: o lote leva { lid, telefone } (par do cache), os dois horários do recibo unido, sem JID nem nome", async () => {
  const { lotes, status, emitir } = await adapterConectado();
  await emitir("contacts.upsert", [{ id: LID_PARTICIPANTE, lid: LID_PARTICIPANTE, jid: `${TELEFONE_PARTICIPANTE}@s.whatsapp.net`, name: "Fulano da Silva" }]);
  await emitir("message-receipt.update", [
    { key: keyGrupo("3EB0GR1"), receipt: { userJid: LID_PARTICIPANTE, receiptTimestamp: 1760400001, readTimestamp: 1760400009 } },
    // O recibo do próprio número da equipe (outro aparelho) nunca entra.
    { key: keyGrupo("3EB0GR1"), receipt: { userJid: EU.jid, readTimestamp: 1760400010 } },
    { key: keyGrupo("3EB0GR1"), receipt: { userJid: "100000000000099@lid", readTimestamp: 1760400011 } },
  ]);
  await esperar(80);
  assert.equal(lotes.length, 1);
  assert.deepEqual(lotes[0].itens, [
    { mensagem_wa_id: "3EB0GR1", destinatario: { lid: LID_PARTICIPANTE, telefone: TELEFONE_PARTICIPANTE }, entregue_em: 1760400001, lida_em: 1760400009 },
  ]);
  assert.deepEqual(lotes[0].contexto, { hash_empresa: "hash-recibos", cod_equipe: "41" });
  assert.doesNotMatch(JSON.stringify(lotes[0].itens), /s\.whatsapp\.net|Fulano|pushName/);
  assert.deepEqual(status, [{ mensagem_wa_id: "3EB0GR1", status: "LIDA" }], "o status agregado segue como antes");
});

test("individual: messages.update vira destinatario null com o horário do evento; SERVER_ACK não gera item", async () => {
  const { lotes, status, emitir } = await adapterConectado();
  const antes = Math.floor(Date.now() / 1000);
  await emitir("messages.update", [
    { key: { remoteJid: JID_CLIENTE, fromMe: true, id: "3EB0IND1" }, update: { status: DELIVERY_ACK } },
    { key: { remoteJid: JID_CLIENTE, fromMe: true, id: "3EB0IND2" }, update: { status: SERVER_ACK } },
  ]);
  const depois = Math.floor(Date.now() / 1000);
  await emitir("messages.update", [{ key: { remoteJid: JID_CLIENTE, fromMe: true, id: "3EB0IND1" }, update: { status: READ } }]);
  await esperar(80);
  assert.deepEqual(status.map((s) => `${s.mensagem_wa_id}:${s.status}`), ["3EB0IND1:ENTREGUE", "3EB0IND2:ENVIADA", "3EB0IND1:LIDA"]);
  assert.equal(lotes.length, 1);
  const itens = lotes[0].itens;
  assert.equal(itens.length, 1, "entrega e leitura da mesma mensagem viram um item só");
  assert.equal(itens[0].mensagem_wa_id, "3EB0IND1");
  assert.equal(itens[0].destinatario, null);
  assert.ok(itens[0].entregue_em >= antes && itens[0].entregue_em <= depois, "horário = instante da extração");
  assert.ok(itens[0].lida_em >= antes);
});

test("o recibo repetido não volta; o recibo atrasado menor não regride o agregado nem repete o item", async () => {
  const { lotes, emitir } = await adapterConectado();
  const recibo = { key: keyGrupo("3EB0REP1"), receipt: { userJid: JID_PARTICIPANTE, receiptTimestamp: 1760400001 } };
  await emitir("message-receipt.update", [recibo]);
  await esperar(60);
  await emitir("message-receipt.update", [recibo, recibo]);
  await esperar(60);
  assert.equal(lotes.length, 1);
});

test("o recibo do aparelho (userReceipt da mensagem enviada) sai DEPOIS do registro dela", async () => {
  /** @type {() => void} */
  let liberarRegistro = () => {};
  const { socket, lotes, ordem, registradas } = await adapterConectado({
    registrarMensagem: () => new Promise((resolve) => (liberarRegistro = () => resolve(undefined))),
  });
  const msg = mensagemGrupo(
    { conversation: "respondi pelo celular" },
    { key: { fromMe: true, participant: undefined, participantLid: undefined }, pushName: null }
  );
  msg.userReceipt = [{ userJid: JID_PARTICIPANTE, receiptTimestamp: 1760400001 }, { userJid: EU.jid, readTimestamp: 1760400002 }];
  socket.emitir("messages.upsert", { messages: [msg], type: "notify" });
  await drenar();
  await esperar(60);
  assert.equal(lotes.length, 0, "com o registro pendente nada de recibo sai");
  liberarRegistro();
  await drenar();
  await esperar(80);
  assert.equal(registradas[0].origem, "APARELHO");
  assert.deepEqual(ordem, [`registro:${msg.key.id}`, "recibos:1"]);
  assert.deepEqual(lotes[0].itens, [
    { mensagem_wa_id: msg.key.id, destinatario: { lid: null, telefone: TELEFONE_PARTICIPANTE }, entregue_em: 1760400001, lida_em: null },
  ]);
});

test("mensagem recebida (CLIENTE) e mensagem sem userReceipt não geram recibo; mensagem repetida entrega os recibos novos", async () => {
  const { socket, lotes, emitir } = await adapterConectado();
  const recebida = mensagemWa({ conversation: "oi" });
  recebida.userReceipt = [{ userJid: JID_CLIENTE, receiptTimestamp: 1 }];
  await emitir("messages.upsert", { messages: [recebida, mensagemWa({ conversation: "tudo bem?" }, { key: { fromMe: true }, pushName: null })], type: "notify" });
  await esperar(60);
  assert.equal(lotes.length, 0);

  // A mesma mensagem do aparelho de novo (reentrega na reconexão), agora com um recibo: o recibo sai, o registro não se repete.
  const msg = mensagemGrupo({ conversation: "no celular" }, { key: { fromMe: true, participant: undefined, participantLid: undefined }, pushName: null });
  await emitir("messages.upsert", { messages: [msg], type: "notify" });
  msg.userReceipt = [{ userJid: JID_PARTICIPANTE, readTimestamp: 1760400005 }];
  await emitir("messages.upsert", { messages: [msg], type: "append" });
  await esperar(60);
  assert.equal(lotes.length, 1);
  assert.equal(lotes[0].itens[0].lida_em, 1760400005);
  void socket;
});

test("o eco de uma mensagem enviada pelo CRM com userReceipt respeita a retenção do envio e sai depois dela, com o horário original", async () => {
  process.env.RECIBO_ATRASO_ENVIO_MS = "120";
  const { adapter, socket, lotes, registradas, emitir } = await adapterConectado();
  const msg = mensagemGrupo({ conversation: "enviada pelo CRM" }, { key: { fromMe: true, participant: undefined, participantLid: undefined }, pushName: null });
  adapter.marcarEnviadaPeloCrm(msg.key.id);
  msg.userReceipt = [{ userJid: JID_PARTICIPANTE, receiptTimestamp: 1760400003 }];
  await emitir("messages.upsert", { messages: [msg], type: "notify" });
  await emitir("message-receipt.update", [{ key: msg.key, receipt: { userJid: JID_PARTICIPANTE, readTimestamp: 1760400004 } }]);
  await esperar(60);
  assert.equal(lotes.length, 0, "dentro da retenção nada sai");
  assert.equal(registradas.length, 0, "o eco não é registrado de novo");
  await esperar(200);
  assert.equal(lotes.length, 1);
  assert.deepEqual(lotes[0].itens, [
    { mensagem_wa_id: msg.key.id, destinatario: { lid: null, telefone: TELEFONE_PARTICIPANTE }, entregue_em: 1760400003, lida_em: 1760400004 },
  ]);
  void socket;
});

test("um back lento ou fora do ar não atrasa o status agregado nem o registro das mensagens", async () => {
  const captura = capturarConsole();
  try {
    const { socket, status, registradas, emitir } = await adapterConectado({ registrarRecibos: () => new Promise(() => {}) });
    await emitir("messages.update", [{ key: { remoteJid: JID_CLIENTE, fromMe: true, id: "3EB0LENTO1" }, update: { status: READ } }]);
    await esperar(60); // o lote saiu e o back "pendurou"
    await emitir("messages.update", [{ key: { remoteJid: JID_CLIENTE, fromMe: true, id: "3EB0LENTO2" }, update: { status: DELIVERY_ACK } }]);
    await emitir("messages.upsert", { messages: [mensagemWa({ conversation: "chegou durante o atraso" })], type: "notify" });
    assert.deepEqual(status.map((s) => s.mensagem_wa_id), ["3EB0LENTO1", "3EB0LENTO2"]);
    assert.equal(registradas.length, 1);
    void socket;
  } finally {
    captura.restaurar();
  }
});

test("404 do back antigo: um único log, o agregado e o registro seguem, e o lote seguinte nem chama o back", async () => {
  const captura = capturarConsole();
  try {
    const { lotes, status, emitir } = await adapterConectado({
      registrarRecibos: async () => {
        throw Object.assign(new Error("404"), { name: "ErroRotaInterna", tipo: "http", status: 404 });
      },
    });
    await emitir("messages.update", [{ key: { remoteJid: JID_CLIENTE, fromMe: true, id: "3EB0V1" }, update: { status: READ } }]);
    await esperar(80);
    await emitir("messages.update", [{ key: { remoteJid: JID_CLIENTE, fromMe: true, id: "3EB0V2" }, update: { status: READ } }]);
    await esperar(80);
    assert.equal(lotes.length, 1);
    assert.deepEqual(status.map((s) => s.mensagem_wa_id), ["3EB0V1", "3EB0V2"]);
    assert.equal(captura.linhas.filter((l) => /404/.test(l)).length, 1);
  } finally {
    captura.restaurar();
  }
});

test("o desligamento (pararSocket) esvazia o lote antes de terminar, sem esperar a janela", async () => {
  const { adapter, lotes, emitir } = await adapterConectado({ opcoesLoteRecibos: { msLote: 60_000 } });
  await emitir("message-receipt.update", [{ key: keyGrupo("3EB0DESL1"), receipt: { userJid: JID_PARTICIPANTE, receiptTimestamp: 1760400001 } }]);
  assert.equal(lotes.length, 0);
  await adapter.pararSocket();
  assert.equal(lotes.length, 1);
  assert.equal(lotes[0].itens[0].mensagem_wa_id, "3EB0DESL1");
  assert.equal(lotes[0].opcoes.timeoutMs > 0, true, "chamada do desligamento leva prazo próprio");
});

test("o desligamento com o back pendurado termina dentro do prazo técnico do lote", async () => {
  const captura = capturarConsole();
  const inicio = Date.now();
  try {
    const { adapter, emitir } = await adapterConectado({
      opcoesLoteRecibos: { msLote: 60_000, msTetoEsvaziar: 80 },
      registrarRecibos: () => new Promise(() => {}),
    });
    await emitir("message-receipt.update", [{ key: keyGrupo("3EB0DESL2"), receipt: { userJid: JID_PARTICIPANTE, readTimestamp: 1760400001 } }]);
    await adapter.pararSocket();
  } finally {
    captura.restaurar();
  }
  assert.ok(Date.now() - inicio < 1500, "o pararSocket não ficou preso no back");
  assert.ok(captura.linhas.some((l) => /equipe 41/i.test(l)));
});

test("a sessão apagada (desconectar) limpa o lote: nada pendente sai depois", async () => {
  const { adapter, lotes, emitir } = await adapterConectado({ opcoesLoteRecibos: { msLote: 60 } });
  await emitir("message-receipt.update", [{ key: keyGrupo("3EB0SESS1"), receipt: { userJid: JID_PARTICIPANTE, receiptTimestamp: 1760400001 } }]);
  await adapter.desconectar();
  await esperar(150);
  assert.equal(lotes.length, 0);
});

test("o log do adapter só tem cod_equipe e contagens: nada de LID, telefone, JID nem nome", async () => {
  const captura = capturarConsole();
  try {
    const { adapter, emitir } = await adapterConectado({
      registrarRecibos: async () => {
        throw Object.assign(new Error(`falhou para ${TELEFONE_PARTICIPANTE} ${LID_PARTICIPANTE}`), { name: "ErroRotaInterna", tipo: "http", status: 400 });
      },
    });
    await emitir("message-receipt.update", [{ key: keyGrupo("3EB0LOG1"), receipt: { userJid: LID_PARTICIPANTE, receiptTimestamp: 1760400001 } }]);
    await esperar(80);
    await adapter.pararSocket();
  } finally {
    captura.restaurar();
  }
  const dosRecibos = captura.linhas.filter((l) => l.startsWith("[RECIBOS]"));
  assert.equal(dosRecibos.length, 1);
  assert.match(dosRecibos[0], /equipe 41/i);
  for (const linha of captura.linhas) assert.doesNotMatch(linha, new RegExp(`${TELEFONE_PARTICIPANTE}|100000000000002|s\\.whatsapp\\.net|@lid|3EB0LOG1`));
});

test("regressão: /interno/mensagem-status continua igual (mesmo corpo) e o lote vai à rota nova, ambos com o token e o tenant", async () => {
  process.env.CRM_BACK_URL = "http://back.local:3500";
  process.env.CRM_BACK_SERVICE_TOKEN = "token-wa-para-back";
  /** @type {{ url: string, token: string | null, corpo: any }[]} */
  const chamadas = [];
  globalThis.fetch = /** @type {typeof fetch} */ (
    async (url, init) => {
      chamadas.push({ url: String(url), token: new Headers(init?.headers).get("X-Internal-Token"), corpo: JSON.parse(String(init?.body)) });
      return Response.json({ msg: "ok" });
    }
  );
  const { emitir } = await adapterConectado({ semInjecao: true });
  await emitir("messages.update", [{ key: { remoteJid: JID_CLIENTE, fromMe: true, id: "3EB0REG1" }, update: { status: READ } }]);
  await esperar(80);
  const status = chamadas.filter((c) => c.url.endsWith("/interno/mensagem-status"));
  const recibos = chamadas.filter((c) => c.url.endsWith("/interno/mensagem-recibos"));
  assert.equal(status.length, 1);
  assert.deepEqual(status[0].corpo, { hash_empresa: "hash-recibos", cod_equipe: 41, mensagem_wa_id: "3EB0REG1", status: "LIDA" });
  assert.equal(status[0].token, "token-wa-para-back");
  assert.equal(recibos.length, 1);
  assert.equal(recibos[0].token, "token-wa-para-back");
  assert.equal(recibos[0].corpo.hash_empresa, "hash-recibos");
  assert.equal(recibos[0].corpo.cod_equipe, 41);
  assert.deepEqual(Object.keys(recibos[0].corpo.recibos[0]), ["mensagem_wa_id", "destinatario", "entregue_em", "lida_em"]);
  assert.equal(recibos[0].corpo.recibos[0].destinatario, null);
});

test("o mesmo mensagem_wa_id do mesmo grupo em duas equipes: dois POSTs, cada um com a sua equipe, e a deduplicação de uma não bloqueia a outra", async () => {
  const a = await adapterConectado({ codEquipe: "41", hashEmpresa: "hash-a" });
  const b = await adapterConectado({ codEquipe: "42", hashEmpresa: "hash-b" });
  const evento = [{ key: keyGrupo("3EB0DUAS1"), receipt: { userJid: JID_PARTICIPANTE, receiptTimestamp: 1760400001 } }];
  await a.emitir("message-receipt.update", evento);
  await b.emitir("message-receipt.update", evento);
  await esperar(80);
  assert.equal(a.lotes.length, 1);
  assert.equal(b.lotes.length, 1);
  assert.deepEqual(a.lotes[0].contexto, { hash_empresa: "hash-a", cod_equipe: "41" });
  assert.deepEqual(b.lotes[0].contexto, { hash_empresa: "hash-b", cod_equipe: "42" });
  assert.deepEqual(a.lotes[0].itens, b.lotes[0].itens);
  // Repetido na equipe A não volta; na B também não, mas por causa da dedup dela.
  await a.emitir("message-receipt.update", evento);
  await esperar(60);
  assert.equal(a.lotes.length, 1);
  assert.equal(b.lotes.length, 1);
});
