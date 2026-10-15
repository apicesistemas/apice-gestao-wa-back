// @ts-check
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const baileysFalso = require("./helpers/baileysFalso");

baileysFalso.instalarBaileysFalso();
const { validarVariaveisDeAmbiente, criarEncerrador } = require("../src/index");
const { criarInstanciaManager } = require("../src/whatsapp/instanciaManager");
const { criarDesligamento } = require("../src/utils/desligamento");
const { EU } = require("./helpers/mensagensWa");

const pastaTeste = fs.mkdtempSync(path.join(os.tmpdir(), "wa-back-index-"));
after(() => fs.rmSync(pastaTeste, { recursive: true, force: true }));

test("validarVariaveisDeAmbiente lista as variáveis obrigatórias ausentes", () => {
  assert.deepEqual(validarVariaveisDeAmbiente({}), [
    "CRM_BACK_URL",
    "CRM_BACK_SERVICE_TOKEN",
    "WA_BACK_ADMIN_TOKEN",
  ]);
  assert.deepEqual(
    validarVariaveisDeAmbiente({
      CRM_BACK_URL: "http://127.0.0.1:3500",
      CRM_BACK_SERVICE_TOKEN: "a",
      WA_BACK_ADMIN_TOKEN: "b",
    }),
    []
  );
});

test("importar src/index.js não valida env nem sobe servidor (só o boot real faz isso)", () => {
  // Se o require acima tivesse validado o env sem as variáveis, o processo já teria saído.
  assert.equal(process.exitCode ?? 0, 0);
});

test("o encerrador fecha o HTTP e sai com 0, uma única vez mesmo com dois sinais", async () => {
  /** @type {number[]} */
  const saidas = [];
  let fechamentos = 0;
  const httpServer = /** @type {any} */ ({
    /** @param {() => void} cb */
    close(cb) {
      fechamentos += 1;
      setImmediate(cb);
    },
  });

  const encerrar = criarEncerrador(httpServer, { sair: (codigo) => saidas.push(codigo), tetoMs: 1000 });
  encerrar("SIGTERM");
  encerrar("SIGINT");
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(fechamentos, 1);
  assert.deepEqual(saidas, [0]);
});

test("o encerrador encerra as instâncias do WhatsApp antes de fechar o HTTP", async () => {
  /** @type {string[]} */
  const ordem = [];
  const httpServer = /** @type {any} */ ({
    /** @param {() => void} cb */
    close(cb) {
      ordem.push("http");
      setImmediate(cb);
    },
  });
  const encerrarInstancias = async () => {
    await new Promise((resolve) => setImmediate(resolve));
    ordem.push("instancias");
  };

  const encerrar = criarEncerrador(httpServer, { sair: (codigo) => ordem.push(`sair:${codigo}`), tetoMs: 1000, encerrarInstancias });
  encerrar("SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.deepEqual(ordem, ["instancias", "http", "sair:0"]);
});

test("uma falha ao encerrar as instâncias não impede o fechamento do HTTP", async () => {
  /** @type {number[]} */
  const saidas = [];
  let fechou = false;
  const httpServer = /** @type {any} */ ({
    /** @param {() => void} cb */
    close(cb) {
      fechou = true;
      setImmediate(cb);
    },
  });
  const encerrarInstancias = async () => {
    throw new Error("falha ao encerrar");
  };

  const encerrar = criarEncerrador(httpServer, { sair: (codigo) => saidas.push(codigo), tetoMs: 1000, encerrarInstancias });
  encerrar("SIGINT");
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(fechou, true);
  assert.deepEqual(saidas, [0]);
});

test("se o encerramento travar, o teto força a saída com 1", async () => {
  /** @type {number[]} */
  const saidas = [];
  const httpServer = /** @type {any} */ ({ close() {} }); // nunca chama o callback

  const encerrar = criarEncerrador(httpServer, { sair: (codigo) => saidas.push(codigo), tetoMs: 20 });
  encerrar("SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, 60));

  assert.deepEqual(saidas, [1]);
});

// Task 14.3: desligamento gracioso com envios recusados, saveCreds aguardado e sessão preservada.

/** HTTP falso que registra o fechamento. */
function httpFalso() {
  const registro = { fechou: false };
  const httpServer = /** @type {any} */ ({
    /** @param {() => void} cb */
    close(cb) {
      registro.fechou = true;
      setImmediate(cb);
    },
  });
  return { httpServer, registro };
}

test("o encerrador marca o processo como encerrando ANTES de tudo e espera os envios em andamento", async () => {
  /** @type {string[]} */
  const ordem = [];
  const desligamento = criarDesligamento();
  /** @type {() => void} */
  let terminarEnvio = () => {};
  const enviosEmAndamento = new Promise((resolve) => (terminarEnvio = () => resolve(undefined)));
  const desligamentoEspiado = {
    ...desligamento,
    marcarEncerrando: () => {
      ordem.push("encerrando");
      desligamento.marcarEncerrando();
    },
    aguardarEmAndamento: async () => {
      await enviosEmAndamento;
      ordem.push("envios");
    },
  };
  const { httpServer } = httpFalso();
  const encerrarInstancias = async () => void ordem.push("instancias");

  const encerrar = criarEncerrador(httpServer, {
    sair: (codigo) => ordem.push(`sair:${codigo}`),
    tetoMs: 1000,
    encerrarInstancias,
    desligamento: desligamentoEspiado,
  });
  encerrar("SIGTERM");
  assert.deepEqual(ordem, ["encerrando"], "a recusa de envios vale já no sinal (síncrono)");
  assert.equal(desligamento.estaEncerrando(), true);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(ordem, ["encerrando"], "as instâncias só fecham depois dos envios em andamento");

  terminarEnvio();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(ordem, ["encerrando", "envios", "instancias", "sair:0"]);
});

test("SIGTERM durante um saveCreds aguarda a gravação antes de encerrar (sem logout, sessão intacta)", async () => {
  baileysFalso.limparHistorico();
  /** @type {() => void} */
  let concluirGravacao = () => {};
  baileysFalso.definirSaveCreds(() => new Promise((resolve) => (concluirGravacao = () => resolve(undefined))));

  const diretorioSessoes = path.join(pastaTeste, "sessoes");
  const manager = criarInstanciaManager({
    diretorioSessoes,
    caminhoRegistro: path.join(pastaTeste, "cache", "equipes-wa.json"),
    reportarStatus: async () => {},
  });
  await manager.conectar("51", "hash-a");
  const socket = /** @type {any} */ (baileysFalso.ultimoSocket());
  socket.user = { id: EU.jid, lid: EU.lid };
  await socket.emitir("connection.update", { connection: "open" });
  fs.writeFileSync(path.join(diretorioSessoes, "51", "creds.json"), "{}");
  socket.emitir("creds.update", {}); // gravação em andamento
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(baileysFalso.contagem.saveCreds, 1);

  /** @type {number[]} */
  const saidas = [];
  const { httpServer, registro } = httpFalso();
  const encerrar = criarEncerrador(httpServer, {
    sair: (codigo) => saidas.push(codigo),
    tetoMs: 2000,
    encerrarInstancias: () => manager.encerrarTodas(),
    desligamento: criarDesligamento(),
  });
  encerrar("SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(saidas, [], "não sai com a gravação das credenciais pela metade");
  assert.equal(registro.fechou, false);

  concluirGravacao();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(saidas, [0]);
  assert.equal(registro.fechou, true);
  assert.equal(socket.chamadasLogout, 0, "desligamento nunca faz logout");
  assert.equal(fs.existsSync(path.join(diretorioSessoes, "51", "creds.json")), true, "a sessão sobrevive para reconectar sem QR");
  // O registro de pareadas continua com a equipe: o próximo boot reconecta sem QR.
  assert.deepEqual(manager.listarRegistradas(), [{ cod_equipe: "51", hash_empresa: "hash-a" }]);
});

test("um saveCreds que nunca termina não segura o processo além do teto (sai com 1)", async () => {
  baileysFalso.limparHistorico();
  baileysFalso.definirSaveCreds(() => new Promise(() => {}));
  const manager = criarInstanciaManager({
    diretorioSessoes: path.join(pastaTeste, "sessoes-teto"),
    caminhoRegistro: path.join(pastaTeste, "cache-teto", "equipes-wa.json"),
    reportarStatus: async () => {},
  });
  await manager.conectar("52", "hash-a");
  const socket = /** @type {any} */ (baileysFalso.ultimoSocket());
  await socket.emitir("connection.update", { connection: "open" });
  socket.emitir("creds.update", {});

  /** @type {number[]} */
  const saidas = [];
  const { httpServer } = httpFalso();
  criarEncerrador(httpServer, {
    sair: (codigo) => saidas.push(codigo),
    tetoMs: 30,
    encerrarInstancias: () => manager.encerrarTodas(),
    desligamento: criarDesligamento(),
  })("SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.deepEqual(saidas, [1]);
});

// Exceção 14b: o temporário cifrado do upload de mídia do Baileys (pasta dedicada) é apagado no
// desligamento, depois de as instâncias fecharem, e também quando o teto força a saída.

test("o encerrador limpa a pasta temporária de mídia depois das instâncias e antes de fechar o HTTP", async () => {
  /** @type {string[]} */
  const ordem = [];
  const httpServer = /** @type {any} */ ({
    /** @param {() => void} cb */
    close(cb) {
      ordem.push("http");
      setImmediate(cb);
    },
  });
  const encerrar = criarEncerrador(httpServer, {
    sair: (codigo) => ordem.push(`sair:${codigo}`),
    tetoMs: 1000,
    encerrarInstancias: async () => void ordem.push("instancias"),
    limparTemporarios: () => void ordem.push("temporarios"),
    desligamento: criarDesligamento(),
  });
  encerrar("SIGTERM");
  encerrar("SIGINT");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(ordem, ["instancias", "temporarios", "http", "sair:0"]);
});

test("se o teto força a saída, a pasta temporária de mídia é limpa antes de sair com 1", async () => {
  /** @type {string[]} */
  const ordem = [];
  const httpServer = /** @type {any} */ ({ close() {} }); // nunca chama o callback
  criarEncerrador(httpServer, {
    sair: (codigo) => ordem.push(`sair:${codigo}`),
    tetoMs: 20,
    encerrarInstancias: () => new Promise(() => {}), // instância travada
    limparTemporarios: () => void ordem.push("temporarios"),
    desligamento: criarDesligamento(),
  })("SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.deepEqual(ordem, ["temporarios", "sair:1"]);
});

test("uma falha ao limpar a pasta temporária de mídia não impede o encerramento", async () => {
  /** @type {number[]} */
  const saidas = [];
  const { httpServer, registro } = httpFalso();
  criarEncerrador(httpServer, {
    sair: (codigo) => saidas.push(codigo),
    tetoMs: 1000,
    encerrarInstancias: async () => {},
    limparTemporarios: () => {
      throw new Error("EBUSY");
    },
    desligamento: criarDesligamento(),
  })("SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(registro.fechou, true);
  assert.deepEqual(saidas, [0]);
});
