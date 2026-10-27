// @ts-check
// Remover a equipe (Fase 26, Task 26.5): instanciaManager.remover com o adapter real e o socket Baileys
// mockado. Sessões, registro e atividade em diretório temporário; o reportarStatus é injetado.
// Nenhum número real, nenhuma conexão real.
const { test, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const baileysFalso = require("../helpers/baileysFalso");

baileysFalso.instalarBaileysFalso();
const { criarInstanciaManager, ErroConexaoEquipe } = require("../../src/whatsapp/instanciaManager");
const { criarInstanciaHealth } = require("../../src/whatsapp/instanciaHealth");

const { sockets, drenar } = baileysFalso;
const JID_FALSO = "5500000000001:7@s.whatsapp.net";
const QR_FALSO = "2@qr-falso-nao-vazar";
const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "wa-back-remover-"));
after(() => fs.rmSync(raiz, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));

let contador = 0;
beforeEach(() => baileysFalso.limparHistorico());

/** @param {{ msPrazoLogout?: number, travaGrupo?: import("../../src/whatsapp/travaGrupo").TravaGrupo, reportarStatus?: (cod: string, status: any) => Promise<unknown> }} [extra] */
function novoManager(extra = {}) {
  contador += 1;
  const diretorioSessoes = path.join(raiz, `sessoes-${contador}`);
  const caminhoRegistro = path.join(raiz, `cache-${contador}`, "equipes-wa.json");
  const caminhoAtividade = path.join(raiz, `cache-${contador}`, "atividade-wa.json");
  /** @type {{ codEquipe: string, status: any }[]} */
  const reportados = [];
  const manager = criarInstanciaManager({
    diretorioSessoes,
    caminhoRegistro,
    caminhoAtividade,
    msPrazoLogout: extra.msPrazoLogout,
    ...(extra.travaGrupo ? { travaGrupo: extra.travaGrupo } : {}),
    reportarStatus:
      extra.reportarStatus ??
      (async (codEquipe, status) => {
        reportados.push({ codEquipe: String(codEquipe), status });
      }),
  });
  return { manager, reportados, diretorioSessoes, caminhoRegistro, caminhoAtividade };
}

/** @param {string} caminho */
const lerJson = (caminho) => (fs.existsSync(caminho) ? JSON.parse(fs.readFileSync(caminho, "utf8")) : {});

async function conectarPareada(
  /** @type {ReturnType<typeof novoManager>} */ ctx,
  /** @type {string} */ cod,
  hash = "hash-a"
) {
  const instancia = await ctx.manager.conectar(cod, hash);
  const pasta = path.join(ctx.diretorioSessoes, cod);
  fs.writeFileSync(path.join(pasta, "creds.json"), "{}");
  const socket = baileysFalso.ultimoSocket();
  /** @type {any} */ (socket).user = { id: JID_FALSO };
  await socket.emitir("connection.update", { connection: "open" });
  assert.equal(instancia.obterStatusConexao().status_conexao, "CONECTADO");
  return { instancia, socket, pasta };
}

/** Manager novo sobre o mesmo disco, sem instância (simula o processo depois de um reinício). */
function managerSemInstancia(/** @type {ReturnType<typeof novoManager>} */ ctx) {
  return criarInstanciaManager({
    diretorioSessoes: ctx.diretorioSessoes,
    caminhoRegistro: ctx.caminhoRegistro,
    caminhoAtividade: ctx.caminhoAtividade,
    reportarStatus: async (cod, status) => {
      ctx.reportados.push({ codEquipe: String(cod), status });
    },
  });
}

test("CONECTADO e pareado: logout 1 vez, pasta apagada, registro e atividade removidos, reporte DESCONECTADO sem erro, instância fora do Map", async () => {
  const ctx = novoManager();
  const { socket, pasta } = await conectarPareada(ctx, "1");
  await ctx.manager.encerrarTodas(); // grava a atividade e esvazia o Map
  fs.writeFileSync(ctx.caminhoAtividade, JSON.stringify({ 1: 1760000000, 2: 1760000001 }));
  const manager = managerSemInstancia(ctx);
  await manager.conectar(1, "hash-a"); // instância nova no Map, com o registro e a pasta de antes
  fs.writeFileSync(path.join(pasta, "creds.json"), "{}");
  const socketNovo = baileysFalso.ultimoSocket();
  /** @type {any} */ (socketNovo).user = { id: JID_FALSO };
  await socketNovo.emitir("connection.update", { connection: "open" });
  assert.notEqual(socketNovo, socket);
  ctx.reportados.length = 0;

  const resultado = await manager.remover(1, "hash-a");

  assert.deepEqual(resultado, { havia_sessao: true, remocao_aparelho: "CONFIRMADA", instancia_descartada: true });
  assert.equal(socketNovo.chamadasLogout, 1);
  assert.equal(fs.existsSync(pasta), false);
  assert.deepEqual(lerJson(ctx.caminhoRegistro), {});
  assert.equal("1" in lerJson(ctx.caminhoAtividade), false, "atividade da equipe removida");
  assert.equal("2" in lerJson(ctx.caminhoAtividade), true, "a de outra equipe fica");
  assert.equal(manager.obter(1), null);
  assert.deepEqual(manager.listarStatus(), []);
  assert.deepEqual(ctx.reportados, [
    { codEquipe: "1", status: { hash_empresa: "hash-a", status_conexao: "DESCONECTADO", ultimo_erro_conexao: null } },
  ]);
});

test("atividade de equipe sem instância (pós-reinício) também é removida, e só a dela", async () => {
  const ctx = novoManager();
  await conectarPareada(ctx, "3");
  await ctx.manager.encerrarTodas();
  fs.writeFileSync(ctx.caminhoAtividade, JSON.stringify({ 3: 1760000000, 4: 1760000001 }));

  const resultado = await managerSemInstancia(ctx).remover(3, "hash-a");

  assert.deepEqual(resultado, { havia_sessao: true, remocao_aparelho: "NAO_CONFIRMADA", instancia_descartada: false });
  assert.deepEqual(lerJson(ctx.caminhoAtividade), { 4: 1760000001 });
  assert.deepEqual(lerJson(ctx.caminhoRegistro), {});
});

test("instância em DESCONECTADO no Map (depois de um desconectar): havia_sessao false, descartada, sem logout nem reporte", async () => {
  const ctx = novoManager();
  const { socket } = await conectarPareada(ctx, "5");
  await ctx.manager.desconectar(5, "hash-a");
  assert.ok(ctx.manager.obter(5), "a instância ficou no Map");
  ctx.reportados.length = 0;
  const logouts = socket.chamadasLogout;
  const abertos = sockets.length;

  const resultado = await ctx.manager.remover(5, "hash-a");

  assert.deepEqual(resultado, { havia_sessao: false, remocao_aparelho: "SEM_PAREAMENTO", instancia_descartada: true });
  assert.equal(ctx.manager.obter(5), null);
  assert.deepEqual(ctx.manager.listarStatus(), []);
  assert.equal(socket.chamadasLogout, logouts);
  assert.equal(ctx.reportados.length, 0);
  assert.equal(sockets.length, abertos);
});

test("sem instância, registro nem sessão: nada é tocado e a segunda chamada responde igual", async () => {
  const ctx = novoManager();

  const primeira = await ctx.manager.remover(6, "hash-a");
  const segunda = await ctx.manager.remover(6, "hash-a");

  assert.deepEqual(primeira, { havia_sessao: false, remocao_aparelho: "SEM_PAREAMENTO", instancia_descartada: false });
  assert.deepEqual(segunda, primeira);
  assert.equal(ctx.reportados.length, 0);
  assert.equal(sockets.length, 0);
  assert.equal(fs.existsSync(path.dirname(ctx.caminhoRegistro)), false, "nenhum arquivo de estado criado");
  assert.equal(fs.existsSync(ctx.diretorioSessoes), false);
});

test("remover duas vezes seguidas numa equipe pareada: a segunda é idempotente e não reporta", async () => {
  const ctx = novoManager();
  await conectarPareada(ctx, "7");
  await ctx.manager.remover(7, "hash-a");
  const reportes = ctx.reportados.length;

  const segunda = await ctx.manager.remover(7, "hash-a");

  assert.deepEqual(segunda, { havia_sessao: false, remocao_aparelho: "SEM_PAREAMENTO", instancia_descartada: false });
  assert.equal(ctx.reportados.length, reportes);
});

test("depois de remover, o /ping não lista a equipe e heartbeat e reconectarTodas não abrem socket nem QR", async () => {
  const ctx = novoManager();
  await conectarPareada(ctx, "8");
  await ctx.manager.remover(8, "hash-a");
  const abertos = sockets.length;
  fs.writeFileSync(ctx.caminhoRegistro, JSON.stringify({ 8: { hash_empresa: "hash-a" } })); // registro velho de volta, sem sessão em disco

  await criarInstanciaHealth({ manager: ctx.manager, reportarStatus: async () => {} }).verificarTodas();
  assert.deepEqual(await ctx.manager.reconectarTodas(), []);
  assert.equal(await ctx.manager.reconectarSePareada(8, "hash-a"), null);
  await drenar();

  assert.equal(sockets.length, abertos);
  assert.equal(ctx.manager.obter(8), null);
  assert.deepEqual(ctx.manager.listarStatus(), [], "o registro velho foi limpo pelo boot e a equipe não aparece");
});

test("remover durante um conectar em andamento espera a abertura e não deixa socket nem QR", async () => {
  const ctx = novoManager();
  /** @type {() => void} */
  let abrir = () => {};
  baileysFalso.definirPortaAuthState(new Promise((resolve) => (abrir = () => resolve())));

  const conexao = ctx.manager.conectar(9, "hash-a");
  await drenar();
  const remocao = ctx.manager.remover(9, "hash-a");
  await drenar();
  abrir();
  const instancia = await conexao;
  const resultado = await remocao;
  baileysFalso.definirPortaAuthState(null);

  assert.equal(sockets.length, 1);
  assert.ok(sockets[0].chamadasEnd >= 1, "o socket aberto foi fechado");
  await sockets[0].emitir("connection.update", { qr: QR_FALSO }); // sem listener: nada acontece
  assert.equal(instancia.obterQr(), null);
  assert.equal(resultado.havia_sessao, true);
  assert.equal(resultado.instancia_descartada, true);
  assert.equal(ctx.manager.obter(9), null);
  assert.equal(fs.existsSync(path.join(ctx.diretorioSessoes, "9")), false);
});

test("remover durante um desconectar em andamento espera a trava e não deixa socket novo", async () => {
  const ctx = novoManager({ msPrazoLogout: 200 });
  const { socket } = await conectarPareada(ctx, "10");
  baileysFalso.definirLogout("pendurado");

  const desconexao = ctx.manager.desconectar(10, "hash-a");
  const remocao = ctx.manager.remover(10, "hash-a");
  const [primeira, segunda] = await Promise.all([desconexao, remocao]);

  assert.equal(primeira.havia_sessao, true);
  assert.deepEqual(segunda, { havia_sessao: false, remocao_aparelho: "SEM_PAREAMENTO", instancia_descartada: true });
  assert.equal(socket.chamadasLogout, 1, "um logout só");
  assert.equal(ctx.manager.obter(10), null);
  assert.equal(sockets.length, 1, "nenhum socket novo");
});

test("outro hash_empresa (instância ou registro) é recusado sem desconectar nem descartar nada", async () => {
  const ctx = novoManager();
  const { instancia, socket, pasta } = await conectarPareada(ctx, "11");
  await ctx.manager.encerrarTodas(); // grava a atividade e esvazia o Map
  const manager = managerSemInstancia(ctx);
  const instanciaNova = await manager.conectar(11, "hash-a");
  fs.writeFileSync(path.join(pasta, "creds.json"), "{}");
  const socketNovo = baileysFalso.ultimoSocket();
  /** @type {any} */ (socketNovo).user = { id: JID_FALSO };
  await socketNovo.emitir("connection.update", { connection: "open" });
  assert.notEqual(instancia, instanciaNova);
  fs.writeFileSync(ctx.caminhoAtividade, JSON.stringify({ 11: 1760000000 }));
  const atividade = fs.readFileSync(ctx.caminhoAtividade, "utf8");
  const registro = fs.readFileSync(ctx.caminhoRegistro, "utf8");
  ctx.reportados.length = 0;

  // Com instância no Map.
  await assert.rejects(manager.remover(11, "hash-b"), (erro) => erro instanceof ErroConexaoEquipe && erro.codigo === "EQUIPE_OUTRA_EMPRESA");
  assert.equal(socketNovo.chamadasLogout, 0);
  assert.equal(socket.chamadasLogout, 0);
  assert.equal(fs.existsSync(path.join(pasta, "creds.json")), true);
  assert.equal(manager.obter(11), instanciaNova);
  assert.equal(fs.readFileSync(ctx.caminhoRegistro, "utf8"), registro);
  assert.equal(fs.readFileSync(ctx.caminhoAtividade, "utf8"), atividade);
  assert.equal(ctx.reportados.length, 0, "nenhum reporte DESCONECTADO");

  // Só pelo registro (sem instância neste processo).
  await assert.rejects(managerSemInstancia(ctx).remover(11, "hash-b"), (erro) => erro instanceof ErroConexaoEquipe);
  assert.equal(fs.existsSync(path.join(pasta, "creds.json")), true);
  assert.equal(fs.readFileSync(ctx.caminhoRegistro, "utf8"), registro);
  assert.equal(fs.readFileSync(ctx.caminhoAtividade, "utf8"), atividade);
  assert.equal(ctx.reportados.length, 0, "nenhum reporte DESCONECTADO");
});

test("o desde do /ping não sobrevive ao remover: conectar de novo não herda o instante antigo", async (t) => {
  const ctx = novoManager();
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-17T10:00:00Z") });
  await conectarPareada(ctx, "15");
  t.mock.timers.tick(60_000);
  await ctx.manager.desconectar(15, "hash-a"); // marca DESCONECTADO às 10:01
  t.mock.timers.tick(60_000);
  await ctx.manager.remover(15, "hash-a"); // 10:02
  t.mock.timers.tick(60_000);

  await ctx.manager.conectar(15, "hash-a"); // 10:03, ainda DESCONECTADO antes do QR

  const [item] = ctx.manager.listarStatus();
  assert.equal(item.cod_equipe, 15);
  assert.ok(!item.desde || item.desde > "2026-10-17T10:02:00", `desde herdado do ciclo anterior: ${item.desde}`);
});

test("remover só afeta a equipe pedida", async () => {
  const ctx = novoManager();
  await conectarPareada(ctx, "12");
  const b = await conectarPareada(ctx, "13", "hash-b");

  await ctx.manager.remover(12, "hash-a");

  assert.equal(fs.existsSync(path.join(b.pasta, "creds.json")), true);
  assert.equal(b.socket.chamadasLogout, 0);
  assert.equal(ctx.manager.obter(13), b.instancia);
  assert.deepEqual(ctx.manager.listarStatus().map((e) => [e.cod_equipe, e.status]), [[13, "CONECTADO"]]);
  assert.deepEqual(lerJson(ctx.caminhoRegistro), { 13: { hash_empresa: "hash-b" } });
});

test("código inválido ou hash_empresa vazio rejeita a Promise", async () => {
  const ctx = novoManager();
  await assert.rejects(ctx.manager.remover("abc", "hash-a"), TypeError);
  await assert.rejects(ctx.manager.remover(1, ""), TypeError);
});

test("nenhum log nem reporte leva JID, telefone, LID ou QR", async () => {
  const ctx = novoManager({ msPrazoLogout: 20 });
  await conectarPareada(ctx, "14");
  /** @type {string[]} */
  const saidas = [];
  const originais = { log: console.log, error: console.error };
  console.log = (...a) => void saidas.push(a.map(String).join(" "));
  console.error = (...a) => void saidas.push(a.map(String).join(" "));
  try {
    baileysFalso.definirLogout("falha");
    await ctx.manager.remover(14, "hash-a");
  } finally {
    console.log = originais.log;
    console.error = originais.error;
  }
  const tudo = JSON.stringify([saidas, ctx.reportados]);
  assert.ok(!tudo.includes("5500000000001"));
  assert.ok(!tudo.includes(QR_FALSO));
  assert.ok(!tudo.includes("s.whatsapp.net"));
});

test("GET /ping real (HealthController) não lista a equipe removida e mantém as outras", async () => {
  const express = require("express");
  const { registrarControllers } = require("../../src/http");
  const { criarHealthController } = require("../../src/http/HealthController");
  const { criarDesligamento } = require("../../src/utils/desligamento");
  const ctx = novoManager();
  await conectarPareada(ctx, "16");
  await conectarPareada(ctx, "17");
  const server = express();
  registrarControllers(server, [criarHealthController({ manager: ctx.manager, desligamento: criarDesligamento() })]);
  /** @type {any} */
  const httpServer = await new Promise((resolve) => {
    const s = server.listen(0, () => resolve(s));
  });
  const url = `http://127.0.0.1:${httpServer.address().port}/ping`;
  try {
    /** @type {any} */
    const antes = await (await fetch(url)).json();
    assert.deepEqual(antes.equipes.map((/** @type {any} */ e) => e.cod_equipe), [16, 17]);

    await ctx.manager.remover(16, "hash-a");

    /** @type {any} */
    const depois = await (await fetch(url)).json();
    assert.deepEqual(depois.equipes.map((/** @type {any} */ e) => [e.cod_equipe, e.status]), [[17, "CONECTADO"]]);
  } finally {
    await new Promise((resolve) => httpServer.close(resolve));
  }
});

test("remover durante uma operação de grupo aborta o sinal ANTES do logout, libera a trava e a equipe sai do Map (a seguinte vê a equipe desconectada)", async () => {
  const { criarTravaGrupo } = require("../../src/whatsapp/travaGrupo");
  const trava = criarTravaGrupo();
  const ctx = novoManager({ travaGrupo: trava });
  const { socket } = await conectarPareada(ctx, "40");
  const sinal = /** @type {AbortSignal} */ (trava.entrar("40"));
  /** @type {boolean[]} */
  const abortadoNoLogout = [];
  const socketAny = /** @type {any} */ (socket);
  const logoutOriginal = socketAny.logout;
  socketAny.logout = async () => {
    abortadoNoLogout.push(sinal.aborted);
    return logoutOriginal.call(socket);
  };

  await ctx.manager.remover(40, "hash-a");

  assert.deepEqual(abortadoNoLogout, [true]);
  assert.equal(trava.ocupada("40"), false);
  assert.equal(ctx.manager.obter(40), null);
  await drenar(); // a trava da equipe cai um microtask depois da resposta
  assert.equal(ctx.manager.equipeOcupada(40), false);
});

test("remover de equipe sem sessão também libera uma operação de grupo pendente, e remover de outra empresa não", async () => {
  const { criarTravaGrupo } = require("../../src/whatsapp/travaGrupo");
  const trava = criarTravaGrupo();
  const ctx = novoManager({ travaGrupo: trava });
  await conectarPareada(ctx, "41");
  const sinal = /** @type {AbortSignal} */ (trava.entrar("41"));
  await assert.rejects(ctx.manager.remover(41, "hash-b"), (erro) => erro instanceof ErroConexaoEquipe);
  assert.equal(sinal.aborted, false);
  await ctx.manager.remover(41, "hash-a");
  assert.equal(sinal.aborted, true);
});
