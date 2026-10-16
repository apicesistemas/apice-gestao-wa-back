// @ts-check
// Adapter Baileys com o socket mockado (tests/helpers/baileysFalso.js via require.cache): nenhum
// teste abre conexão real com o WhatsApp. As sessões ficam num diretório temporário (os.tmpdir),
// nunca no ./sessoes-baileys real.
const { test, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const baileysFalso = require("../helpers/baileysFalso");

baileysFalso.instalarBaileysFalso();
const { criarAdapter, MS_RECONEXAO } = require("../../src/whatsapp/BaileysAdapter");

const { sockets, ultimoSocket, drenar, DisconnectReason } = baileysFalso;
const ASSINATURA_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const diretorioSessoes = fs.mkdtempSync(path.join(os.tmpdir(), "wa-back-adapter-"));
after(() => fs.rmSync(diretorioSessoes, { recursive: true, force: true }));

beforeEach(() => baileysFalso.limparHistorico());

/**
 * @param {string} codEquipe
 * @param {{ msReconexao?: number }} [opcoes]
 */
function novoAdapter(codEquipe, opcoes = {}) {
  /** @type {any[]} */
  const status = [];
  let sessoesRemovidas = 0;
  const adapter = criarAdapter({
    codEquipe,
    hashEmpresa: "hash-empresa-teste",
    diretorioSessoes,
    onStatusChange: (estado) => status.push(estado),
    onSessaoRemovida: () => {
      sessoesRemovidas += 1;
    },
    ...opcoes,
  });
  return { adapter, status, sessoesRemovidas: () => sessoesRemovidas };
}

/** @param {number} statusCode */
const fechamento = (statusCode) => ({
  connection: "close",
  lastDisconnect: { error: Object.assign(new Error("Connection Failure 5511999998888"), { output: { statusCode } }) },
});

test("connection.update com qr gera o status QR_PENDENTE e o PNG fica disponível", async () => {
  const { adapter, status } = novoAdapter("11");
  await adapter.iniciar();
  assert.equal(await adapter.obterQrPng(), null, "sem QR ainda, não há PNG");

  await ultimoSocket().emitir("connection.update", { qr: "2@qr-de-teste,abc,def" });

  assert.equal(adapter.obterStatusConexao().status_conexao, "QR_PENDENTE");
  assert.equal(status.at(-1).status_conexao, "QR_PENDENTE");
  assert.equal(adapter.obterQr(), "2@qr-de-teste,abc,def");
  const png = await adapter.obterQrPng();
  assert.ok(Buffer.isBuffer(png));
  assert.deepEqual(png.subarray(0, 8), ASSINATURA_PNG);
});

test("connection open marca CONECTADO e o QR antigo some", async () => {
  const { adapter } = novoAdapter("12");
  await adapter.iniciar();
  await ultimoSocket().emitir("connection.update", { qr: "2@qr" });
  await ultimoSocket().emitir("connection.update", { connection: "open" });

  assert.deepEqual(adapter.obterStatusConexao(), { status_conexao: "CONECTADO", ultimo_erro_conexao: null });
  assert.equal(adapter.obterQr(), null);
  assert.equal(await adapter.obterQrPng(), null);
});

test("a sessão fica em <diretorioSessoes>/<cod_equipe> (useMultiFileAuthState)", async () => {
  const { adapter } = novoAdapter("13");
  await adapter.iniciar();
  assert.deepEqual(baileysFalso.pastasAuthState, [path.join(diretorioSessoes, "13")]);
});

test("loggedOut apaga a sessão da equipe e reporta DESCONECTADO", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { adapter, status, sessoesRemovidas } = novoAdapter("14");
  await adapter.iniciar();
  const pastaSessao = path.join(diretorioSessoes, "14");
  fs.writeFileSync(path.join(pastaSessao, "creds.json"), "{}");
  // Sessão de outra equipe no mesmo diretório base: não pode ser tocada.
  const pastaOutra = path.join(diretorioSessoes, "99");
  fs.mkdirSync(pastaOutra, { recursive: true });
  fs.writeFileSync(path.join(pastaOutra, "creds.json"), "{}");
  const socket = ultimoSocket();

  await socket.emitir("connection.update", fechamento(DisconnectReason.loggedOut));

  assert.equal(fs.existsSync(pastaSessao), false, "a sessão da equipe foi apagada");
  assert.equal(fs.existsSync(path.join(pastaOutra, "creds.json")), true, "a sessão de outra equipe ficou");
  assert.equal(adapter.obterStatusConexao().status_conexao, "DESCONECTADO");
  assert.equal(status.at(-1).status_conexao, "DESCONECTADO");
  assert.equal(sessoesRemovidas(), 1);
  assert.ok(socket.removidos.includes("creds.update"), "creds.update tardio não recria a sessão apagada");
  assert.ok(!String(status.at(-1).ultimo_erro_conexao).includes("5511999998888"), "o erro reportado não leva telefone");

  // Logout exige QR novo: nenhuma reconexão automática.
  t.mock.timers.tick(MS_RECONEXAO * 3);
  await drenar();
  assert.equal(sockets.length, 1);
});

test("outro motivo de close agenda uma única reconexão, sem abrir dois sockets", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { adapter, status } = novoAdapter("15");
  await adapter.iniciar();
  await ultimoSocket().emitir("connection.update", { connection: "open" });
  const primeiro = ultimoSocket();

  // A mesma queda costuma chegar duas vezes (erro do ws + fechamento do ws).
  await primeiro.emitir("connection.update", fechamento(DisconnectReason.connectionClosed));
  await primeiro.emitir("connection.update", fechamento(DisconnectReason.connectionClosed));
  assert.equal(adapter.obterStatusConexao().status_conexao, "ERRO");
  assert.equal(status.at(-1).status_conexao, "ERRO");
  assert.ok(!String(status.at(-1).ultimo_erro_conexao).includes("5511999998888"), "o erro reportado não leva telefone");

  t.mock.timers.tick(MS_RECONEXAO - 1);
  await drenar();
  assert.equal(sockets.length, 1, "não reconecta antes do prazo");

  t.mock.timers.tick(1);
  await drenar();
  assert.equal(sockets.length, 2, "uma única reconexão");

  t.mock.timers.tick(MS_RECONEXAO * 3);
  await drenar();
  assert.equal(sockets.length, 2, "nenhuma reconexão extra");

  // Um evento atrasado do socket antigo é ignorado (não agenda outra reconexão nem muda o status).
  await primeiro.emitir("connection.update", fechamento(DisconnectReason.connectionClosed));
  await ultimoSocket().emitir("connection.update", { connection: "open" });
  t.mock.timers.tick(MS_RECONEXAO * 3);
  await drenar();
  assert.equal(sockets.length, 2);
  assert.equal(adapter.obterStatusConexao().status_conexao, "CONECTADO");
});

test("iniciar() é reentrante: duas chamadas simultâneas abrem um único socket", async () => {
  const { adapter } = novoAdapter("16");
  await Promise.all([adapter.iniciar(), adapter.iniciar()]);
  assert.equal(sockets.length, 1);
});

test("iniciar() durante uma reconexão pendente cancela o timer e fecha o socket anterior", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { adapter } = novoAdapter("17");
  await adapter.iniciar();
  const primeiro = ultimoSocket();
  await primeiro.emitir("connection.update", fechamento(DisconnectReason.connectionLost));

  await adapter.iniciar(); // clique em "Conectar" dentro da janela do timer
  assert.equal(sockets.length, 2);
  assert.equal(primeiro.chamadasEnd, 1, "o socket anterior foi encerrado antes de abrir o novo");

  t.mock.timers.tick(MS_RECONEXAO * 3);
  await drenar();
  assert.equal(sockets.length, 2, "o timer antigo não abriu um terceiro socket");
});

test("pararSocket() encerra o socket, cancela a reconexão e reporta DESCONECTADO sem apagar a sessão", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { adapter, status } = novoAdapter("18");
  await adapter.iniciar();
  const pastaSessao = path.join(diretorioSessoes, "18");
  fs.writeFileSync(path.join(pastaSessao, "creds.json"), "{}");
  const socket = ultimoSocket();
  await socket.emitir("connection.update", fechamento(DisconnectReason.connectionClosed));

  await adapter.pararSocket();

  assert.equal(socket.chamadasEnd, 1);
  assert.ok(socket.removidos.includes("connection.update"));
  assert.equal(adapter.obterStatusConexao().status_conexao, "DESCONECTADO");
  assert.equal(status.at(-1).status_conexao, "DESCONECTADO");
  assert.equal(fs.existsSync(path.join(pastaSessao, "creds.json")), true, "a sessão continua em disco");
  t.mock.timers.tick(MS_RECONEXAO * 3);
  await drenar();
  assert.equal(sockets.length, 1);
});

test("QR expirado sem leitura não reconecta sozinho (não gera QR à toa)", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { adapter } = novoAdapter("19");
  await adapter.iniciar();
  await ultimoSocket().emitir("connection.update", { qr: "2@qr" });
  await ultimoSocket().emitir("connection.update", fechamento(DisconnectReason.timedOut));

  assert.equal(adapter.obterStatusConexao().status_conexao, "DESCONECTADO");
  assert.equal(adapter.obterQr(), null);
  t.mock.timers.tick(MS_RECONEXAO * 3);
  await drenar();
  assert.equal(sockets.length, 1);
});

test("cod_equipe inválido é recusado (sem caminho fora do diretório de sessões)", () => {
  for (const invalido of ["../1", "0", "abc", "1/2", ""]) {
    assert.throws(() => novoAdapter(invalido), /cod_equipe/);
  }
});

test("loggedOut pelo aparelho espera a gravação de credenciais em andamento antes de apagar a pasta", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { adapter } = novoAdapter("16");
  await adapter.iniciar();
  const pastaSessao = path.join(diretorioSessoes, "16");
  const socket = ultimoSocket();
  /** @type {() => void} */
  let concluir = () => {};
  baileysFalso.definirSaveCreds(
    () =>
      new Promise((resolve) => {
        concluir = () => {
          fs.mkdirSync(pastaSessao, { recursive: true });
          fs.writeFileSync(path.join(pastaSessao, "creds.json"), "{}");
          resolve();
        };
      })
  );
  await socket.emitir("creds.update", {});

  let terminou = false;
  const queda = socket.emitir("connection.update", fechamento(DisconnectReason.loggedOut)).then(() => (terminou = true));
  await drenar();
  assert.equal(terminou, false, "espera a fila de credenciais");
  concluir();
  await queda;

  assert.equal(fs.existsSync(pastaSessao), false, "a gravação terminou antes do rm");
  assert.equal(adapter.obterStatusConexao().ultimo_erro_conexao, "Sessão encerrada pelo aparelho.");
});
