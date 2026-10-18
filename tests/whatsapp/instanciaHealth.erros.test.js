// @ts-check
// Heartbeat: ramos de falha e de parada no meio da rodada (manager falso, sem Baileys).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { criarInstanciaHealth } = require("../../src/whatsapp/instanciaHealth");

/** Silencia console.error e devolve as linhas. */
function capturarErros() {
  const original = console.error;
  /** @type {string[]} */
  const linhas = [];
  console.error = (...args) => void linhas.push(args.join(" "));
  return { linhas, restaurar: () => void (console.error = original) };
}

/**
 * @param {Record<string, string>} equipes
 * @param {Record<string, any>} [sobrescritas]
 */
function criarManager(equipes, sobrescritas = {}) {
  /** @type {string[]} */
  const reconectadas = [];
  return {
    reconectadas,
    manager: /** @type {any} */ ({
      listarRegistradas: () => Object.entries(equipes).map(([cod_equipe, hash_empresa]) => ({ cod_equipe, hash_empresa })),
      obter: () => null,
      temSessaoSalva: () => true,
      reconectarSePareada: async (/** @type {string} */ cod) => void reconectadas.push(String(cod)),
      ...sobrescritas,
    }),
  };
}

test("falha ao reportar o status de uma instância em memória é logada e não impede as outras equipes", async () => {
  const instancia = { hashEmpresa: "hash-a", obterStatusConexao: () => ({ status_conexao: "CONECTADO", ultimo_erro_conexao: null }) };
  const { manager } = criarManager({ 1: "hash-a", 2: "hash-b" }, { obter: (/** @type {string} */ cod) => (String(cod) === "1" ? instancia : null) });
  /** @type {string[]} */
  const reportadas = [];
  const log = capturarErros();
  try {
    await criarInstanciaHealth({
      manager,
      reportarStatus: async (cod) => {
        reportadas.push(String(cod));
        if (String(cod) === "1") throw new Error("back fora");
      },
    }).verificarTodas();
  } finally {
    log.restaurar();
  }
  assert.deepEqual(reportadas, ["1", "2"]);
  assert.ok(log.linhas.some((l) => /status da equipe 1/.test(l) && /back fora/.test(l)));
});

test("falha ao listar as equipes pareadas é logada e a rodada termina sem rejeitar nem reportar", async () => {
  const { manager } = criarManager(
    {},
    {
      listarRegistradas: () => {
        throw new Error("registro corrompido");
      },
    }
  );
  let reportou = false;
  const log = capturarErros();
  try {
    await criarInstanciaHealth({ manager, reportarStatus: async () => void (reportou = true) }).verificarTodas();
  } finally {
    log.restaurar();
  }
  assert.equal(reportou, false);
  assert.ok(log.linhas.some((l) => /listar as equipes/.test(l) && /registro corrompido/.test(l)));
});

test("exceção inesperada ao verificar uma equipe é isolada: a próxima equipe ainda é verificada", async () => {
  const { manager } = criarManager(
    { 1: "hash-a", 2: "hash-b" },
    {
      temSessaoSalva: (/** @type {string} */ cod) => {
        if (String(cod) === "1") throw "disco indisponível"; // valor que não é Error
        return false;
      },
    }
  );
  /** @type {string[]} */
  const reportadas = [];
  const log = capturarErros();
  try {
    await criarInstanciaHealth({ manager, reportarStatus: async (cod) => void reportadas.push(String(cod)) }).verificarTodas();
  } finally {
    log.restaurar();
  }
  assert.deepEqual(reportadas, ["2"]);
  assert.ok(log.linhas.some((l) => /equipe 1/.test(l) && /disco indisponível/.test(l)));
});

test("equipe com conexão ou desconexão em andamento é pulada: nada é lido, reportado nem reconectado", async () => {
  const { manager, reconectadas } = criarManager({ 1: "hash-a", 2: "hash-b" }, { equipeOcupada: (/** @type {string} */ cod) => String(cod) === "1" });
  /** @type {string[]} */
  const reportadas = [];
  await criarInstanciaHealth({ manager, reportarStatus: async (cod) => void reportadas.push(String(cod)) }).verificarTodas();
  assert.deepEqual(reportadas, ["2"]);
  assert.deepEqual(reconectadas, ["2"]);
});

test("parar durante a rodada impede a reconexão pendente e as equipes seguintes", async () => {
  const { manager, reconectadas } = criarManager({ 1: "hash-a", 2: "hash-b" });
  /** @type {string[]} */
  const reportadas = [];
  /** @type {ReturnType<typeof criarInstanciaHealth>} */
  const health = criarInstanciaHealth({
    manager,
    reportarStatus: async (cod) => {
      reportadas.push(String(cod));
      health.parar(); // o desligamento começa enquanto o DESCONECTADO da equipe 1 é reportado
    },
  });
  await health.verificarTodas();
  assert.deepEqual(reportadas, ["1"]);
  assert.deepEqual(reconectadas, []);
});

test("iniciar duas vezes agenda um único timer, parar o cancela e nenhuma rodada acontece depois", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  let listagens = 0;
  const { manager } = criarManager({}, { listarRegistradas: () => (listagens += 1, []) });
  const ms = 60_000;
  const health = criarInstanciaHealth({ manager, reportarStatus: async () => {}, msIntervalo: ms });
  const proximaVolta = () => new Promise((resolve) => setImmediate(resolve));

  health.iniciar();
  health.iniciar();
  t.mock.timers.tick(ms);
  await proximaVolta();
  assert.equal(listagens, 1, "dois iniciar() não podem duplicar o agendamento");

  health.parar();
  t.mock.timers.tick(ms * 5);
  await proximaVolta();
  assert.equal(listagens, 1, "depois do parar() não há mais rodada");

  health.parar(); // parar de novo é inofensivo
  health.iniciar(); // e o heartbeat pode ser religado
  t.mock.timers.tick(ms);
  await proximaVolta();
  assert.equal(listagens, 2);
  health.parar();
});
