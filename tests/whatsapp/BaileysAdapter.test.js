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
const { mensagemWa, EU } = require("../helpers/mensagensWa");

baileysFalso.instalarBaileysFalso();
const { criarAdapter, MS_RECONEXAO, MS_TIQUE_BUFFER, TIQUES_RETIDO } = require("../../src/whatsapp/BaileysAdapter");

const { sockets, ultimoSocket, drenar, DisconnectReason } = baileysFalso;
const ASSINATURA_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const diretorioSessoes = fs.mkdtempSync(path.join(os.tmpdir(), "wa-back-adapter-"));
after(() => fs.rmSync(diretorioSessoes, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));

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


// ---- Vigia do buffer de eventos do Baileys (0.35.2) ----

/**
 * Instala `isBuffering`/`flush` no `ev` do socket falso. O buffer continua retido depois do flush
 * (`liberaNoFlush: false`), como a fila offline presa que religa o buffer a cada mensagem.
 * @param {any} socket
 */
function instalarBuffer(socket, { retido = true, liberaNoFlush = false } = {}) {
  const buffer = { retido, flushes: 0, aoFlush: /** @type {(() => void) | null} */ (null) };
  socket.ev.isBuffering = () => buffer.retido;
  socket.ev.flush = () => {
    buffer.flushes += 1;
    buffer.aoFlush?.();
    if (liberaNoFlush) buffer.retido = false;
    return true;
  };
  return buffer;
}

/** @param {any} t @param {number} tiques */
const passar = (t, tiques) => {
  for (let i = 0; i < tiques; i += 1) t.mock.timers.tick(MS_TIQUE_BUFFER);
};

test("buffer retido em 2 tiques seguidos chama o flush; flushes repetidos logam uma vez só", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const log = t.mock.method(console, "log", () => {});
  const { adapter } = novoAdapter("30");
  await adapter.iniciar();
  const socket = /** @type {any} */ (ultimoSocket());
  const buffer = instalarBuffer(socket);
  await socket.emitir("connection.update", { connection: "open" });
  const logsDoBuffer = () => log.mock.calls.filter((c) => String(c.arguments[0]).includes("buffer de eventos"));

  passar(t, TIQUES_RETIDO - 1);
  assert.equal(buffer.flushes, 0, "1 tique só não libera");
  passar(t, 1);
  assert.equal(buffer.flushes, 1);
  assert.equal(logsDoBuffer().length, 1);
  assert.equal(
    logsDoBuffer()[0].arguments[0],
    "[BAILEYS] Equipe 30: buffer de eventos do Baileys retido; liberado à força (só o 1º flush deste socket é logado; após envio sem tráfego é normal, mensagens só chegando assim = fila offline presa)."
  );

  passar(t, TIQUES_RETIDO * 3); // a fila presa religa o buffer: mais 3 flushes, sem novo log
  assert.equal(buffer.flushes, 4);
  assert.equal(logsDoBuffer().length, 1);
});

test("buffer liberado antes do 2º tique zera a contagem e não faz nada", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const log = t.mock.method(console, "log", () => {});
  const { adapter } = novoAdapter("31");
  await adapter.iniciar();
  const socket = /** @type {any} */ (ultimoSocket());
  const buffer = instalarBuffer(socket);
  await socket.emitir("connection.update", { connection: "open" });

  passar(t, 1);
  buffer.retido = false;
  passar(t, 1); // liberou sozinho: zera
  buffer.retido = true;
  passar(t, 1); // 1 tique de novo: ainda abaixo
  assert.equal(buffer.flushes, 0);
  assert.equal(log.mock.callCount(), 0);
});

test("ev sem isBuffering não quebra o vigia", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const log = t.mock.method(console, "log", () => {});
  const erro = t.mock.method(console, "error", () => {});
  const { adapter } = novoAdapter("32");
  await adapter.iniciar();
  await ultimoSocket().emitir("connection.update", { connection: "open" });

  passar(t, TIQUES_RETIDO * 3);
  assert.equal(log.mock.callCount(), 0);
  assert.equal(erro.mock.callCount(), 0);
});

test("exceção no tique só loga o nome do erro e o vigia continua", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  t.mock.method(console, "log", () => {});
  const erro = t.mock.method(console, "error", () => {});
  const { adapter } = novoAdapter("33");
  await adapter.iniciar();
  const socket = /** @type {any} */ (ultimoSocket());
  const buffer = instalarBuffer(socket);
  buffer.aoFlush = () => {
    throw new Error("falha com 5511999998888");
  };
  await socket.emitir("connection.update", { connection: "open" });

  passar(t, TIQUES_RETIDO * 2);
  assert.equal(buffer.flushes, 2, "continua vigiando depois da exceção");
  assert.equal(erro.mock.callCount(), 2);
  assert.ok(!JSON.stringify(erro.mock.calls[0].arguments).includes("5511999998888"));
});

test("fechar o socket limpa o vigia: um buffer retido depois não é liberado", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const log = t.mock.method(console, "log", () => {});
  const { adapter } = novoAdapter("34");
  await adapter.iniciar();
  const socket = /** @type {any} */ (ultimoSocket());
  const buffer = instalarBuffer(socket);
  await socket.emitir("connection.update", { connection: "open" });

  await adapter.pararSocket();
  const flushesDoDesligamento = buffer.flushes;
  passar(t, TIQUES_RETIDO * 3);
  assert.equal(buffer.flushes, flushesDoDesligamento, "nenhum flush do vigia depois do fechamento");
  assert.equal(log.mock.callCount(), 0);
});

test("pararSocket faz o flush antes de fechar o socket, com os listeners ainda ligados", async () => {
  const { adapter } = novoAdapter("36");
  await adapter.iniciar();
  const socket = /** @type {any} */ (ultimoSocket());
  const buffer = instalarBuffer(socket, { liberaNoFlush: true });
  /** @type {{ removidos: number, fechamentos: number } | null} */
  let noFlush = null;
  buffer.aoFlush = () => {
    noFlush = { removidos: socket.removidos.length, fechamentos: socket.chamadasEnd };
  };
  await socket.emitir("connection.update", { connection: "open" });

  await adapter.pararSocket();
  assert.equal(buffer.flushes, 1);
  assert.deepEqual(noFlush, { removidos: 0, fechamentos: 0 }, "flush antes de tirar os listeners e do end()");
  assert.equal(socket.chamadasEnd, 1);
});

test("pararSocket: exceção no flush só loga o nome do erro e o socket é fechado do mesmo jeito", async (t) => {
  const erro = t.mock.method(console, "error", () => {});
  const { adapter } = novoAdapter("37");
  await adapter.iniciar();
  const socket = /** @type {any} */ (ultimoSocket());
  const buffer = instalarBuffer(socket);
  buffer.aoFlush = () => {
    throw new Error("falha com 5511999998888");
  };

  await adapter.pararSocket();
  assert.equal(socket.chamadasEnd, 1);
  assert.equal(erro.mock.callCount(), 1);
  assert.ok(!JSON.stringify(erro.mock.calls[0].arguments).includes("5511999998888"));
});

test("o flush da vigia solta o messages.upsert retido e a mensagem chega ao registro pela filaEntrada", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  t.mock.method(console, "log", () => {});
  /** @type {any[]} */
  const registradas = [];
  const adapter = criarAdapter({
    codEquipe: "38",
    hashEmpresa: "hash-empresa-teste",
    diretorioSessoes,
    registrarMensagem: async (mensagem) => {
      registradas.push(mensagem);
    },
  });
  await adapter.iniciar();
  const socket = /** @type {any} */ (ultimoSocket());
  socket.user = { id: EU.jid, lid: EU.lid };
  socket.onWhatsApp = async () => [];
  const msg = mensagemWa({ conversation: "estava retida no buffer" });
  const buffer = instalarBuffer(socket, { liberaNoFlush: true });
  // Como o Baileys: o flush emite o messages.upsert que estava guardado.
  buffer.aoFlush = () => {
    void socket.emitir("messages.upsert", { messages: [msg], type: "notify" });
  };
  await socket.emitir("connection.update", { connection: "open" });

  passar(t, TIQUES_RETIDO);
  await drenar();
  assert.equal(buffer.flushes, 1);
  assert.equal(registradas.length, 1);
  assert.equal(registradas[0].mensagem_wa_id, msg.key.id);
  assert.equal(registradas[0].texto, "estava retida no buffer");
});

test("um novo open (socket novo) vigia só o socket novo, e um close tardio do antigo não para a vigia do novo", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  t.mock.method(console, "log", () => {});
  const { adapter } = novoAdapter("35");
  await adapter.iniciar();
  const primeiro = /** @type {any} */ (ultimoSocket());
  const bufferAntigo = instalarBuffer(primeiro);
  await primeiro.emitir("connection.update", { connection: "open" });
  const closeTardio = primeiro.listeners["connection.update"]; // guardado antes de o adapter tirar os listeners
  await primeiro.emitir("connection.update", fechamento(DisconnectReason.connectionClosed));
  t.mock.timers.tick(MS_RECONEXAO);
  await drenar();
  const segundo = /** @type {any} */ (ultimoSocket());
  assert.notEqual(segundo, primeiro);
  const bufferNovo = instalarBuffer(segundo);
  await segundo.emitir("connection.update", { connection: "open" });

  await closeTardio(fechamento(DisconnectReason.connectionClosed)); // chega depois do open do novo
  passar(t, TIQUES_RETIDO);
  assert.equal(bufferAntigo.flushes, 0);
  assert.equal(bufferNovo.flushes, 1, "a vigia do socket novo segue de pé");
  assert.equal(adapter.obterStatusConexao().status_conexao, "CONECTADO");
});

test("open repetido no mesmo socket não cria dois intervalos", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  t.mock.method(console, "log", () => {});
  const { adapter } = novoAdapter("39");
  await adapter.iniciar();
  const socket = /** @type {any} */ (ultimoSocket());
  const buffer = instalarBuffer(socket);
  await socket.emitir("connection.update", { connection: "open" });
  await socket.emitir("connection.update", { connection: "open" });

  passar(t, TIQUES_RETIDO * 2);
  assert.equal(buffer.flushes, 2, "um intervalo só: 1 flush a cada 2 tiques");
});
