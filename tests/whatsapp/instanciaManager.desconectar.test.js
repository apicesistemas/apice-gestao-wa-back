// @ts-check
// Desconectar WhatsApp da equipe: logout voluntário da equipe (instanciaManager.desconectar) com o adapter real e o socket
// Baileys mockado. Sessões, registro e atividade em diretório temporário; o reportarStatus é injetado.
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
const { MS_RECONEXAO } = require("../../src/whatsapp/BaileysAdapter");

const { sockets, drenar, DisconnectReason } = baileysFalso;
const JID_FALSO = "5500000000001:7@s.whatsapp.net";
const QR_FALSO = "2@qr-falso-nao-vazar";
const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "wa-back-desconectar-"));
after(() => fs.rmSync(raiz, { recursive: true, force: true }));

let contador = 0;
beforeEach(() => baileysFalso.limparHistorico());

/** @param {{ msPrazoLogout?: number, msPrazoCredenciais?: number, msPrazoReporte?: number, msReconexao?: number, travaGrupo?: import("../../src/whatsapp/travaGrupo").TravaGrupo, reportarStatus?: (cod: string, status: any) => Promise<unknown> }} [extra] */
function novoManager(extra = {}) {
  contador += 1;
  const diretorioSessoes = path.join(raiz, `sessoes-${contador}`);
  const caminhoRegistro = path.join(raiz, `cache-${contador}`, "equipes-wa.json");
  /** @type {{ codEquipe: string, status: any }[]} */
  const reportados = [];
  const manager = criarInstanciaManager({
    diretorioSessoes,
    caminhoRegistro,
    msPrazoLogout: extra.msPrazoLogout,
    msPrazoCredenciais: extra.msPrazoCredenciais,
    msPrazoReporte: extra.msPrazoReporte,
    msReconexao: extra.msReconexao,
    ...(extra.travaGrupo ? { travaGrupo: extra.travaGrupo } : {}),
    reportarStatus:
      extra.reportarStatus ??
      (async (codEquipe, status) => {
        reportados.push({ codEquipe: String(codEquipe), status });
      }),
  });
  return { manager, reportados, diretorioSessoes, caminhoRegistro };
}

/** @param {string} caminho */
const lerRegistro = (caminho) => (fs.existsSync(caminho) ? JSON.parse(fs.readFileSync(caminho, "utf8")) : {});

/** Conecta a equipe e a deixa pareada (creds.json, user.id, open): CONECTADO e no registro. */
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

test("CONECTADO e pareado: logout 1 vez, pasta apagada, registro removido, reporte DESCONECTADO sem erro e CONFIRMADA", async () => {
  const ctx = novoManager();
  const { instancia, socket, pasta } = await conectarPareada(ctx, "1");
  assert.deepEqual(Object.keys(lerRegistro(ctx.caminhoRegistro)), ["1"]);
  ctx.reportados.length = 0;

  const resultado = await ctx.manager.desconectar(1, "hash-a");

  assert.deepEqual(resultado, { havia_sessao: true, remocao_aparelho: "CONFIRMADA" });
  assert.equal(socket.chamadasLogout, 1);
  assert.ok(socket.chamadasEnd >= 1, "end() como reserva");
  assert.equal(fs.existsSync(pasta), false);
  assert.deepEqual(lerRegistro(ctx.caminhoRegistro), {});
  assert.equal(ctx.manager.obter(1), instancia, "o adapter fica no Map");
  assert.deepEqual(instancia.obterStatusConexao(), { status_conexao: "DESCONECTADO", ultimo_erro_conexao: null });
  assert.deepEqual(ctx.reportados, [
    { codEquipe: "1", status: { hash_empresa: "hash-a", status_conexao: "DESCONECTADO", ultimo_erro_conexao: null } },
  ]);
  assert.deepEqual(ctx.manager.listarStatus().map((e) => [e.cod_equipe, e.status]), [[1, "DESCONECTADO"]]);
});

test("o reporte é aguardado antes de liberar a trava da equipe (falha só vai ao log)", async () => {
  /** @type {(() => void) | null} */
  let liberar = null;
  const ctx = novoManager({ reportarStatus: () => new Promise((resolve) => (liberar = () => resolve(undefined))) });
  // O status do conectar/open também é reportado (fire-and-forget): o foco é o reporte do desconectar.
  await conectarPareada(ctx, "2");
  liberar = null;

  let terminou = false;
  const promessa = ctx.manager.desconectar(2, "hash-a").then((r) => {
    terminou = true;
    return r;
  });
  for (let i = 0; i < 100 && !liberar; i += 1) await new Promise((r) => setTimeout(r, 10));
  assert.equal(terminou, false, "ainda esperando o reporte");
  assert.ok(liberar, "o reporte do desconectar foi pedido");
  /** @type {() => void} */ (liberar)();
  assert.equal((await promessa).remocao_aparelho, "CONFIRMADA");
});

test("falha ao reportar só vai ao log: o desconectar conclui", async () => {
  const ctx = novoManager();
  await conectarPareada(ctx, "3");
  const manager = criarInstanciaManager({
    diretorioSessoes: ctx.diretorioSessoes,
    caminhoRegistro: ctx.caminhoRegistro,
    reportarStatus: async () => {
      throw new Error("back fora");
    },
  });
  // Mesmo registro e mesma pasta, mas sem instância neste manager: caminho sem instância.
  const resultado = await manager.desconectar(3, "hash-a");
  assert.deepEqual(resultado, { havia_sessao: true, remocao_aparelho: "NAO_CONFIRMADA" });
});

test("depois do desconectar, heartbeat e reconectarTodas (mesmo com o registro restaurado à mão) não abrem socket", async () => {
  const ctx = novoManager();
  await conectarPareada(ctx, "4");
  await ctx.manager.desconectar(4, "hash-a");
  const abertos = sockets.length;
  // Registro velho de volta, sem sessão em disco: a reconexão precisa conferir a sessão.
  fs.writeFileSync(ctx.caminhoRegistro, JSON.stringify({ 4: { hash_empresa: "hash-a" } }));

  await criarInstanciaHealth({ manager: ctx.manager, reportarStatus: async () => {} }).verificarTodas();
  assert.deepEqual(await ctx.manager.reconectarTodas(), []);
  await drenar();

  assert.equal(sockets.length, abertos);
});

test("reconectarTodas do boot que chega na equipe com um desconectar pendente não abre socket nem QR", async () => {
  const ctx = novoManager({ msPrazoLogout: 300 });
  const { instancia } = await conectarPareada(ctx, "30");
  baileysFalso.definirLogout("pendurado");
  const abertos = sockets.length;

  const desconexao = ctx.manager.desconectar(30, "hash-a"); // logout pendurado: registro e creds ainda existem
  await drenar();
  assert.ok(fs.existsSync(path.join(ctx.diretorioSessoes, "30", "creds.json")));
  const boot = ctx.manager.reconectarTodas();
  await Promise.all([desconexao, boot]);

  assert.deepEqual(await boot, []);
  assert.equal(sockets.length, abertos, "nenhum makeWASocket novo");
  assert.equal(instancia.obterQr(), null);
  assert.equal(instancia.obterStatusConexao().status_conexao, "DESCONECTADO");
});

test("reconectarTodas ainda limpa do registro a equipe sem sessão em disco", async () => {
  const ctx = novoManager();
  fs.mkdirSync(path.dirname(ctx.caminhoRegistro), { recursive: true });
  fs.writeFileSync(ctx.caminhoRegistro, JSON.stringify({ 31: { hash_empresa: "hash-a" } }));
  assert.deepEqual(await ctx.manager.reconectarTodas(), []);
  assert.deepEqual(lerRegistro(ctx.caminhoRegistro), {});
  assert.equal(sockets.length, 0);
});

test("o heartbeat pula a equipe com o desconectar em andamento (não reporta CONECTADO depois do DESCONECTADO)", async () => {
  const ctx = novoManager({ msPrazoLogout: 200 });
  await conectarPareada(ctx, "32");
  baileysFalso.definirLogout("pendurado");
  /** @type {any[]} */
  const doHeartbeat = [];
  const health = criarInstanciaHealth({
    manager: ctx.manager,
    reportarStatus: async (cod, status) => void doHeartbeat.push({ cod, status }),
  });

  const desconexao = ctx.manager.desconectar(32, "hash-a");
  await drenar();
  await health.verificarTodas(); // durante o logout o estado ainda é CONECTADO
  await desconexao;

  assert.deepEqual(doHeartbeat, []);
  await health.verificarTodas();
  assert.deepEqual(doHeartbeat, [], "e depois o registro já não tem a equipe");
});

test("encerramento gracioso durante um desconectar com logout pendurado: cabe no teto, rm e registro antes do reporte, outras equipes sem logout", async () => {
  const { criarEncerrador, MS_TETO_ENCERRAMENTO } = require("../../src/index");
  const { MS_PRAZO_LOGOUT, MS_PRAZO_CREDENCIAIS } = require("../../src/whatsapp/BaileysAdapter");
  const { MS_PRAZO_REPORTE } = require("../../src/whatsapp/instanciaManager");
  const { criarDesligamento } = require("../../src/utils/desligamento");
  assert.ok(
    MS_PRAZO_LOGOUT + MS_PRAZO_CREDENCIAIS + MS_PRAZO_REPORTE <= MS_TETO_ENCERRAMENTO * 0.75,
    "o desconectar no pior caso cabe folgado no teto do encerramento"
  );

  /** @type {string[]} */
  const ordem = [];
  /** @type {ReturnType<typeof novoManager>} */
  let ctx;
  ctx = novoManager({
    msPrazoLogout: 150,
    reportarStatus: async (cod, status) => {
      if (status.status_conexao === "DESCONECTADO" && String(cod) === "33") {
        ordem.push(
          `reporte:pasta=${fs.existsSync(path.join(ctx.diretorioSessoes, "33"))}:registro=${"33" in lerRegistro(ctx.caminhoRegistro)}`
        );
      }
    },
  });
  await conectarPareada(ctx, "33");
  const b = await conectarPareada(ctx, "34", "hash-b");
  baileysFalso.definirLogout("pendurado"); // só vale para o logout seguinte: o da equipe 33
  const desligamento = criarDesligamento();
  /** @type {number | null} */
  let saiu = null;
  const encerrar = criarEncerrador(/** @type {any} */ ({ close: (/** @type {() => void} */ cb) => cb() }), {
    sair: (codigo) => (saiu = codigo),
    tetoMs: 2000,
    encerrarInstancias: () => ctx.manager.encerrarTodas(),
    limparTemporarios: () => {},
    desligamento,
  });

  // Requisição rastreada como a do controller: o encerrador a espera.
  const res = Object.assign(new (require("node:events").EventEmitter)(), { set: () => res, status: () => res, json: () => res });
  desligamento.recusarDuranteEncerramento(/** @type {any} */ ({}), /** @type {any} */ (res), () => {});
  const desconexao = ctx.manager.desconectar(33, "hash-a").finally(() => res.emit("close"));
  await drenar();

  const inicio = Date.now();
  encerrar("SIGINT");
  await desconexao;
  for (let i = 0; i < 100 && saiu === null; i += 1) await new Promise((r) => setTimeout(r, 20));

  assert.equal(saiu, 0, "saída limpa, sem estourar o teto");
  assert.ok(Date.now() - inicio < 2000);
  // O pararSocket da própria equipe 33 (encerrarTodas) ainda reporta DESCONECTADO depois: o que importa é o primeiro.
  assert.equal(ordem[0], "reporte:pasta=false:registro=false");
  assert.equal(b.socket.chamadasLogout, 0, "a outra equipe fecha sem logout");
  assert.equal(fs.existsSync(path.join(b.pasta, "creds.json")), true);
  assert.deepEqual(Object.keys(lerRegistro(ctx.caminhoRegistro)), ["34"]);
});

test("o timer de reconexão que rejeita durante o desconectar não agenda outra reconexão", async () => {
  const ctx = novoManager({ msReconexao: 15 });
  const { socket } = await conectarPareada(ctx, "35");
  /** @type {(erro: Error) => void} */
  let falhar = () => {};
  baileysFalso.definirPortaAuthState(new Promise((_, rejeitar) => (falhar = rejeitar)));
  await socket.emitir("connection.update", {
    connection: "close",
    lastDisconnect: { error: { output: { statusCode: DisconnectReason.connectionClosed } } },
  });
  await new Promise((r) => setTimeout(r, 40)); // o timer disparou: iniciar() preso na porta
  const abertos = sockets.length;

  const desconexao = ctx.manager.desconectar(35, "hash-a");
  await drenar();
  falhar(new Error("falha ao abrir"));
  await desconexao;
  baileysFalso.definirPortaAuthState(null);
  await new Promise((r) => setTimeout(r, 80)); // mais que vários msReconexao

  assert.equal(sockets.length, abertos);
  assert.equal(ctx.manager.obter(35)?.obterStatusConexao().status_conexao, "DESCONECTADO");
});

test("saveCreds pendurado não trava a equipe: o prazo da fila de credenciais libera o desconectar", async () => {
  const ctx = novoManager({ msPrazoCredenciais: 40 });
  const { socket, pasta } = await conectarPareada(ctx, "36");
  baileysFalso.definirSaveCreds(() => new Promise(() => {}));
  await socket.emitir("creds.update", {});

  const resultado = await ctx.manager.desconectar(36, "hash-a");

  assert.equal(resultado.havia_sessao, true);
  assert.equal(fs.existsSync(pasta), false);
  assert.deepEqual(lerRegistro(ctx.caminhoRegistro), {});
});

test("reporte que não responde é cortado pelo prazo e a trava é liberada", async () => {
  const ctx = novoManager({ msPrazoReporte: 40, reportarStatus: () => new Promise(() => {}) });
  await conectarPareada(ctx, "37");
  const resultado = await ctx.manager.desconectar(37, "hash-a");
  assert.equal(resultado.remocao_aparelho, "CONFIRMADA");
});

test("código de equipe inválido rejeita a Promise (não lança de forma síncrona)", async () => {
  const ctx = novoManager();
  /** @type {(() => Promise<unknown>)[]} */
  const chamadas = [
    () => ctx.manager.conectar("abc", "hash-a"),
    () => ctx.manager.desconectar("abc", "hash-a"),
    () => ctx.manager.reconectarSePareada("abc", "hash-a"),
  ];
  for (const chamar of chamadas) {
    /** @type {Promise<unknown> | undefined} */
    let promessa;
    assert.doesNotThrow(() => (promessa = chamar()));
    await assert.rejects(/** @type {Promise<unknown>} */ (promessa), TypeError);
  }
});

test("heartbeat que leu o registro antes do desconectar e reconecta depois não abre socket", async () => {
  const ctx = novoManager();
  await conectarPareada(ctx, "5");
  const abertos = sockets.length;

  const desconexao = ctx.manager.desconectar(5, "hash-a");
  const reconexao = ctx.manager.reconectarSePareada(5, "hash-a"); // chega com a leitura antiga do registro
  await desconexao;

  assert.equal(await reconexao, null);
  assert.equal(sockets.length, abertos);
  assert.equal(await ctx.manager.reconectarSePareada(5, "hash-a"), null, "nem depois");
});

test("reconectarSePareada reconecta quem consta no registro com sessão em disco e ignora hash diferente", async () => {
  const ctx = novoManager();
  const { pasta } = await conectarPareada(ctx, "6");
  await ctx.manager.encerrarTodas(); // simula o reinício: registro e creds ficam
  assert.ok(fs.existsSync(path.join(pasta, "creds.json")));
  baileysFalso.limparHistorico();

  assert.equal(await ctx.manager.reconectarSePareada(6, "hash-b"), null);
  assert.equal(sockets.length, 0);
  assert.ok(await ctx.manager.reconectarSePareada(6, "hash-a"));
  assert.equal(sockets.length, 1);
});

test("desconectar durante uma abertura em andamento espera a abertura e não deixa socket nem QR", async () => {
  const ctx = novoManager();
  /** @type {() => void} */
  let abrir = () => {};
  baileysFalso.definirPortaAuthState(new Promise((resolve) => (abrir = () => resolve())));

  const conexao = ctx.manager.conectar(7, "hash-a");
  await drenar();
  assert.equal(sockets.length, 0, "a abertura ainda não terminou");
  const desconexao = ctx.manager.desconectar(7, "hash-a");
  await drenar();
  abrir();
  const instancia = await conexao;
  const resultado = await desconexao;

  assert.equal(sockets.length, 1);
  const socket = sockets[0];
  assert.ok(socket.chamadasEnd >= 1, "o socket aberto foi fechado");
  assert.equal(socket.listeners["connection.update"], undefined);
  await socket.emitir("connection.update", { qr: QR_FALSO }); // sem listener: nada acontece
  assert.equal(instancia.obterQr(), null);
  assert.equal(instancia.obterStatusConexao().status_conexao, "DESCONECTADO");
  assert.equal(resultado.havia_sessao, true);
  assert.equal(fs.existsSync(path.join(ctx.diretorioSessoes, "7")), false);
});

test("o adapter também espera uma abertura em andamento (reconexão por timer)", async () => {
  const ctx = novoManager();
  const { instancia } = await conectarPareada(ctx, "8");
  /** @type {() => void} */
  let abrir = () => {};
  baileysFalso.definirPortaAuthState(new Promise((resolve) => (abrir = () => resolve())));
  const abertura = instancia.iniciar(); // o que o timer de reconexão faz
  await drenar();

  const desconexao = instancia.desconectar();
  abrir();
  await abertura;
  await desconexao;

  assert.equal(instancia.temSocket(), false);
  assert.equal(instancia.obterStatusConexao().status_conexao, "DESCONECTADO");
  assert.ok(sockets.at(-1)?.chamadasEnd);
});

test("conectar logo depois do desconectar gera QR novo no mesmo adapter, e os dois nunca se intercalam", async () => {
  const ctx = novoManager();
  const { instancia, socket: antigo } = await conectarPareada(ctx, "9");

  const desconexao = ctx.manager.desconectar(9, "hash-a");
  const conexao = ctx.manager.conectar(9, "hash-a");
  const [resultado, nova] = await Promise.all([desconexao, conexao]);

  assert.equal(nova, instancia, "adapter reaproveitado");
  assert.equal(resultado.remocao_aparelho, "CONFIRMADA");
  assert.equal(antigo.chamadasLogout, 1);
  assert.equal(sockets.length, 2, "um socket novo, aberto depois do logout");
  assert.equal(fs.existsSync(path.join(ctx.diretorioSessoes, "9")), true, "a pasta nova é do socket novo");
  assert.equal(fs.existsSync(path.join(ctx.diretorioSessoes, "9", "creds.json")), false, "sem credencial antiga");

  await sockets[1].emitir("connection.update", { qr: QR_FALSO });
  assert.equal(instancia.obterStatusConexao().status_conexao, "QR_PENDENTE");
  assert.equal(instancia.obterQr(), QR_FALSO);
});

test("QR_PENDENTE (nunca pareado) vira SEM_PAREAMENTO, sem logout", async () => {
  const ctx = novoManager();
  const instancia = await ctx.manager.conectar(10, "hash-a");
  const socket = baileysFalso.ultimoSocket();
  await socket.emitir("connection.update", { qr: QR_FALSO });

  const resultado = await ctx.manager.desconectar(10, "hash-a");

  assert.deepEqual(resultado, { havia_sessao: true, remocao_aparelho: "SEM_PAREAMENTO" });
  assert.equal(socket.chamadasLogout, 0);
  assert.ok(socket.chamadasEnd >= 1);
  assert.equal(instancia.obterQr(), null);
  assert.equal(fs.existsSync(path.join(ctx.diretorioSessoes, "10")), false);
});

test("ERRO com timer de reconexão pendente: timer cancelado, NAO_CONFIRMADA e sessão local apagada", async (t) => {
  const ctx = novoManager();
  const { socket, pasta } = await conectarPareada(ctx, "11");
  t.mock.timers.enable({ apis: ["setTimeout"] });
  await socket.emitir("connection.update", {
    connection: "close",
    lastDisconnect: { error: { output: { statusCode: DisconnectReason.connectionClosed } } },
  });
  assert.equal(ctx.manager.obter(11)?.obterStatusConexao().status_conexao, "ERRO");

  const resultado = await ctx.manager.desconectar(11, "hash-a");
  const abertos = sockets.length;
  t.mock.timers.tick(MS_RECONEXAO * 3);
  await drenar();

  assert.deepEqual(resultado, { havia_sessao: true, remocao_aparelho: "NAO_CONFIRMADA" });
  assert.equal(socket.chamadasLogout, 0, "socket já fechado: sem logout");
  assert.equal(sockets.length, abertos, "o timer não reabriu o socket");
  assert.equal(fs.existsSync(pasta), false);
  assert.deepEqual(lerRegistro(ctx.caminhoRegistro), {});
});

test("logout que rejeita ou estoura o prazo vira NAO_CONFIRMADA e a sessão é apagada mesmo assim", async () => {
  for (const modo of /** @type {const} */ (["falha", "pendurado"])) {
    baileysFalso.limparHistorico();
    const ctx = novoManager({ msPrazoLogout: 30 });
    const { pasta } = await conectarPareada(ctx, "12");
    baileysFalso.definirLogout(modo);

    const resultado = await ctx.manager.desconectar(12, "hash-a");

    assert.deepEqual(resultado, { havia_sessao: true, remocao_aparelho: "NAO_CONFIRMADA" }, modo);
    assert.equal(baileysFalso.ultimoSocket().chamadasLogout, 1, modo);
    assert.equal(fs.existsSync(pasta), false, modo);
    assert.deepEqual(lerRegistro(ctx.caminhoRegistro), {}, modo);
    assert.equal(ctx.manager.obter(12)?.obterStatusConexao().status_conexao, "DESCONECTADO", modo);
  }
});

test("o handler de 'Sessão encerrada pelo aparelho.' não roda na desconexão voluntária", async () => {
  const ctx = novoManager();
  await conectarPareada(ctx, "13");
  baileysFalso.definirLogout("loggedOut"); // o logout real termina emitindo o close com loggedOut
  ctx.reportados.length = 0;

  const resultado = await ctx.manager.desconectar(13, "hash-a");
  await drenar();

  assert.equal(resultado.remocao_aparelho, "CONFIRMADA");
  assert.ok(ctx.reportados.length >= 1);
  assert.ok(ctx.reportados.every((r) => r.status.ultimo_erro_conexao === null), "nenhum erro reportado");
  assert.ok(!JSON.stringify(ctx.reportados).includes("encerrada pelo aparelho"));
});

test("creds.update em andamento é esperado antes de apagar a pasta, e o tardio não recria a sessão", async () => {
  const ctx = novoManager();
  const { socket, pasta } = await conectarPareada(ctx, "14");
  /** @type {() => void} */
  let concluir = () => {};
  baileysFalso.definirSaveCreds(
    () =>
      new Promise((resolve) => {
        concluir = () => {
          fs.mkdirSync(pasta, { recursive: true });
          fs.writeFileSync(path.join(pasta, "creds.json"), "{}");
          resolve();
        };
      })
  );
  await socket.emitir("creds.update", {}); // gravação em andamento
  const gravacoes = baileysFalso.contagem.saveCreds;

  let terminou = false;
  const desconexao = ctx.manager.desconectar(14, "hash-a").then(() => (terminou = true));
  await drenar();
  assert.equal(terminou, false, "espera a fila de credenciais");
  concluir();
  await desconexao;
  assert.equal(fs.existsSync(pasta), false, "a gravação terminou antes do rm");

  await socket.emitir("creds.update", {}); // listener já removido
  await drenar();
  assert.equal(baileysFalso.contagem.saveCreds, gravacoes);
  assert.equal(fs.existsSync(pasta), false);
});

test("sem instância, sem registro e sem sessão: havia_sessao false sem tocar em nada, e a segunda chamada idem", async () => {
  const ctx = novoManager();

  const primeira = await ctx.manager.desconectar(15, "hash-a");
  const segunda = await ctx.manager.desconectar(15, "hash-a");

  assert.equal(primeira.havia_sessao, false);
  assert.deepEqual(segunda, primeira);
  assert.equal(ctx.reportados.length, 0);
  assert.equal(sockets.length, 0);
  assert.equal(fs.existsSync(path.dirname(ctx.caminhoRegistro)), false, "nenhum arquivo de estado criado");
  assert.equal(fs.existsSync(ctx.diretorioSessoes), false);
});

test("desconectar duas vezes seguidas: a segunda responde havia_sessao false e não reporta de novo", async () => {
  const ctx = novoManager();
  await conectarPareada(ctx, "16");
  await ctx.manager.desconectar(16, "hash-a");
  const reportes = ctx.reportados.length;

  const segunda = await ctx.manager.desconectar(16, "hash-a");

  assert.equal(segunda.havia_sessao, false);
  assert.equal(ctx.reportados.length, reportes);
});

test("sem instância mas com registro e sessão em disco (pós-reinício): NAO_CONFIRMADA, pasta e registro apagados, reporte", async () => {
  const ctx = novoManager();
  const { pasta } = await conectarPareada(ctx, "17");
  await ctx.manager.encerrarTodas();
  const outro = criarInstanciaManager({
    diretorioSessoes: ctx.diretorioSessoes,
    caminhoRegistro: ctx.caminhoRegistro,
    reportarStatus: async (cod, status) => {
      ctx.reportados.push({ codEquipe: String(cod), status });
    },
  });
  ctx.reportados.length = 0;
  baileysFalso.limparHistorico();

  const resultado = await outro.desconectar(17, "hash-a");

  assert.deepEqual(resultado, { havia_sessao: true, remocao_aparelho: "NAO_CONFIRMADA" });
  assert.equal(fs.existsSync(pasta), false);
  assert.deepEqual(lerRegistro(ctx.caminhoRegistro), {});
  assert.equal(sockets.length, 0);
  assert.deepEqual(ctx.reportados, [
    { codEquipe: "17", status: { hash_empresa: "hash-a", status_conexao: "DESCONECTADO", ultimo_erro_conexao: null } },
  ]);
});

test("outro hash_empresa (instância ou registro) é recusado e nada é desconectado", async () => {
  const ctx = novoManager();
  const { socket, pasta } = await conectarPareada(ctx, "18");

  await assert.rejects(ctx.manager.desconectar(18, "hash-b"), (erro) => erro instanceof ErroConexaoEquipe && erro.codigo === "EQUIPE_OUTRA_EMPRESA");
  assert.equal(socket.chamadasLogout, 0);
  assert.equal(fs.existsSync(path.join(pasta, "creds.json")), true);
  assert.deepEqual(lerRegistro(ctx.caminhoRegistro), { 18: { hash_empresa: "hash-a" } });

  // Só pelo registro (sem instância neste processo).
  const outro = criarInstanciaManager({
    diretorioSessoes: ctx.diretorioSessoes,
    caminhoRegistro: ctx.caminhoRegistro,
    reportarStatus: async () => {},
  });
  await assert.rejects(outro.desconectar(18, "hash-b"), (erro) => erro instanceof ErroConexaoEquipe);
  assert.equal(fs.existsSync(path.join(pasta, "creds.json")), true);
});

test("desconectar só mexe na equipe pedida", async () => {
  const ctx = novoManager();
  const a = await conectarPareada(ctx, "19");
  const b = await conectarPareada(ctx, "20", "hash-b");

  await ctx.manager.desconectar(19, "hash-a");

  assert.equal(fs.existsSync(a.pasta), false);
  assert.equal(fs.existsSync(path.join(b.pasta, "creds.json")), true);
  assert.equal(b.socket.chamadasLogout, 0);
  assert.equal(ctx.manager.obter(20)?.obterStatusConexao().status_conexao, "CONECTADO");
  assert.deepEqual(lerRegistro(ctx.caminhoRegistro), { 20: { hash_empresa: "hash-b" } });
});

test("o desligamento gracioso (encerrarTodas) continua sem logout e preserva a sessão e o registro", async () => {
  const ctx = novoManager();
  const { socket, pasta } = await conectarPareada(ctx, "21");

  await ctx.manager.encerrarTodas();

  assert.equal(socket.chamadasLogout, 0);
  assert.equal(fs.existsSync(path.join(pasta, "creds.json")), true);
  assert.deepEqual(Object.keys(lerRegistro(ctx.caminhoRegistro)), ["21"]);
});

test("nenhum log nem reporte leva JID, telefone, LID ou QR", async () => {
  const ctx = novoManager({ msPrazoLogout: 20 });
  const { socket } = await conectarPareada(ctx, "22");
  /** @type {string[]} */
  const saidas = [];
  const originais = { log: console.log, error: console.error };
  console.log = (...a) => void saidas.push(a.map(String).join(" "));
  console.error = (...a) => void saidas.push(a.map(String).join(" "));
  try {
    baileysFalso.definirLogout("falha");
    await ctx.manager.desconectar(22, "hash-a");
  } finally {
    console.log = originais.log;
    console.error = originais.error;
  }
  const tudo = JSON.stringify([saidas, ctx.reportados]);
  assert.ok(!tudo.includes("5500000000001"));
  assert.ok(!tudo.includes(QR_FALSO));
  assert.ok(!tudo.includes("s.whatsapp.net"));
});

test("desconectar durante uma operação de grupo aborta o sinal ANTES do logout e libera a trava (a seguinte não fica OCUPADA)", async () => {
  const { criarTravaGrupo } = require("../../src/whatsapp/travaGrupo");
  const trava = criarTravaGrupo();
  const ctx = novoManager({ travaGrupo: trava });
  const { socket } = await conectarPareada(ctx, "30");
  const sinal = /** @type {AbortSignal} */ (trava.entrar("30"));
  /** @type {boolean[]} */
  const abortadoNoLogout = [];
  const socketAny = /** @type {any} */ (socket);
  const logoutOriginal = socketAny.logout;
  socketAny.logout = async () => {
    abortadoNoLogout.push(sinal.aborted);
    return logoutOriginal.call(socket);
  };

  await ctx.manager.desconectar(30, "hash-a");

  assert.deepEqual(abortadoNoLogout, [true], "o laço de grupo já estava abortado quando o logout começou");
  assert.equal(trava.ocupada("30"), false);
  assert.ok(trava.entrar("30"), "uma operação nova entra (e vai encontrar a equipe desconectada)");
});

test("desconectar de outra empresa não aborta a operação de grupo da equipe", async () => {
  const { criarTravaGrupo } = require("../../src/whatsapp/travaGrupo");
  const trava = criarTravaGrupo();
  const ctx = novoManager({ travaGrupo: trava });
  await conectarPareada(ctx, "31");
  const sinal = /** @type {AbortSignal} */ (trava.entrar("31"));
  await assert.rejects(ctx.manager.desconectar(31, "hash-b"), (erro) => erro instanceof ErroConexaoEquipe);
  assert.equal(sinal.aborted, false);
  assert.equal(trava.ocupada("31"), true);
});

test("a operação de grupo de OUTRA equipe não é afetada pelo desconectar", async () => {
  const { criarTravaGrupo } = require("../../src/whatsapp/travaGrupo");
  const trava = criarTravaGrupo();
  const ctx = novoManager({ travaGrupo: trava });
  await conectarPareada(ctx, "32");
  const outra = /** @type {AbortSignal} */ (trava.entrar("33"));
  await ctx.manager.desconectar(32, "hash-a");
  assert.equal(outra.aborted, false);
});
