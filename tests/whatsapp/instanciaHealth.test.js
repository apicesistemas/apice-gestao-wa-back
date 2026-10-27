// @ts-check
// Heartbeat por equipe (a cada 60 s): instância em memória → reporta o status atual; sem instância
// → reporta DESCONECTADO e só reconecta se houver sessão salva. Primeiro com um manager falso, depois
// com o instanciaManager real (Baileys mockado, sessões em diretório temporário).
const { test, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const baileysFalso = require("../helpers/baileysFalso");

baileysFalso.instalarBaileysFalso();
const { criarInstanciaHealth, MS_INTERVALO_HEARTBEAT } = require("../../src/whatsapp/instanciaHealth");
const { criarInstanciaManager } = require("../../src/whatsapp/instanciaManager");

const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "wa-back-health-"));
after(() => fs.rmSync(raiz, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
beforeEach(() => baileysFalso.limparHistorico());

/**
 * Manager falso: `equipes` é o registro; `emMemoria` as instâncias; `comSessao` quem tem creds.json.
 * @param {{ equipes: Record<string, string>, emMemoria?: Record<string, { status_conexao: string, ultimo_erro_conexao: string | null }>, comSessao?: string[] }} dados
 */
function managerFalso({ equipes, emMemoria = {}, comSessao = [] }) {
  /** @type {{ cod: string, hash: string }[]} */
  const conectadas = [];
  const manager = {
    listarRegistradas: () => Object.entries(equipes).map(([cod_equipe, hash_empresa]) => ({ cod_equipe, hash_empresa })),
    obter: (/** @type {string | number} */ cod) => {
      const estado = emMemoria[String(cod)];
      return estado ? /** @type {any} */ ({ codEquipe: String(cod), hashEmpresa: equipes[String(cod)], obterStatusConexao: () => ({ ...estado }) }) : null;
    },
    temSessaoSalva: (/** @type {string | number} */ cod) => comSessao.includes(String(cod)),
    reconectarSePareada: async (/** @type {string | number} */ cod, /** @type {string} */ hash) => {
      conectadas.push({ cod: String(cod), hash });
      return /** @type {any} */ ({});
    },
  };
  return { manager, conectadas };
}

function reportador() {
  /** @type {{ cod: string, status: any }[]} */
  const reportados = [];
  /** @param {string | number} cod @param {any} status */
  const reportarStatus = async (cod, status) => {
    reportados.push({ cod: String(cod), status });
  };
  return { reportados, reportarStatus };
}

test("o heartbeat roda a cada 60 s", () => {
  assert.equal(MS_INTERVALO_HEARTBEAT, 60 * 1000);
});

test("uma equipe sem instância em memória reporta DESCONECTADO e só tenta reconectar se houver sessão salva", async () => {
  const { manager, conectadas } = managerFalso({ equipes: { 1: "hash-a", 2: "hash-b" }, comSessao: ["1"] });
  const { reportados, reportarStatus } = reportador();
  const health = criarInstanciaHealth({ manager, reportarStatus });

  await health.verificarTodas();

  assert.deepEqual(
    reportados.map((r) => [r.cod, r.status.hash_empresa, r.status.status_conexao]),
    [
      ["1", "hash-a", "DESCONECTADO"],
      ["2", "hash-b", "DESCONECTADO"],
    ]
  );
  assert.match(reportados[0].status.ultimo_erro_conexao, /reconectando/i);
  assert.match(reportados[1].status.ultimo_erro_conexao, /QR Code/);
  // Só a equipe 1 (com sessão) reconecta; a 2 não gera QR à toa.
  assert.deepEqual(conectadas, [{ cod: "1", hash: "hash-a" }]);
});

test("uma equipe com instância em memória reporta o status atual dela, sem reconectar", async () => {
  const { manager, conectadas } = managerFalso({
    equipes: { 3: "hash-c", 4: "hash-d" },
    emMemoria: { 3: { status_conexao: "CONECTADO", ultimo_erro_conexao: null }, 4: { status_conexao: "ERRO", ultimo_erro_conexao: "Conexão encerrada (código 428)." } },
    comSessao: ["3", "4"],
  });
  const { reportados, reportarStatus } = reportador();
  await criarInstanciaHealth({ manager, reportarStatus }).verificarTodas();
  assert.deepEqual(reportados, [
    { cod: "3", status: { hash_empresa: "hash-c", status_conexao: "CONECTADO", ultimo_erro_conexao: null } },
    { cod: "4", status: { hash_empresa: "hash-d", status_conexao: "ERRO", ultimo_erro_conexao: "Conexão encerrada (código 428)." } },
  ]);
  assert.equal(conectadas.length, 0);
});

test("falha ao reportar ou ao reconectar uma equipe não impede as demais nem rejeita", async () => {
  const { manager } = managerFalso({ equipes: { 5: "hash-e", 6: "hash-f" }, comSessao: ["5", "6"] });
  manager.reconectarSePareada = async () => {
    throw new Error("falha ao abrir");
  };
  /** @type {string[]} */
  const reportados = [];
  const health = criarInstanciaHealth({
    manager,
    reportarStatus: async (cod) => {
      reportados.push(String(cod));
      if (String(cod) === "5") throw new Error("back fora do ar");
    },
  });
  await health.verificarTodas();
  assert.deepEqual(reportados, ["5", "6"]);
});

test("iniciar agenda a verificação no intervalo, nunca sobrepõe duas rodadas, e parar cancela", async () => {
  const { manager } = managerFalso({ equipes: { 7: "hash-g" } });
  let rodadas = 0;
  /** @type {() => void} */
  let liberar = () => {};
  const health = criarInstanciaHealth({
    manager,
    msIntervalo: 5,
    reportarStatus: () => {
      rodadas += 1;
      return new Promise((resolve) => {
        liberar = () => resolve(undefined);
      });
    },
  });
  health.iniciar();
  health.iniciar(); // idempotente: um timer só
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(rodadas, 1, "a rodada travada não deixa outra começar");
  liberar();
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.ok(rodadas >= 2);
  health.parar();
  liberar();
  await new Promise((resolve) => setTimeout(resolve, 10));
  const depois = rodadas;
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(rodadas, depois, "parado, não roda mais");
});

test("com o instanciaManager real: sem instância e com sessão salva reabre o socket; sem sessão não abre nenhum", async () => {
  const diretorioSessoes = path.join(raiz, "sessoes");
  const caminhoRegistro = path.join(raiz, "cache", "equipes-wa.json");
  fs.mkdirSync(path.dirname(caminhoRegistro), { recursive: true });
  fs.writeFileSync(caminhoRegistro, JSON.stringify({ 11: { hash_empresa: "hash-k" }, 12: { hash_empresa: "hash-l" } }));
  fs.mkdirSync(path.join(diretorioSessoes, "11"), { recursive: true });
  fs.writeFileSync(path.join(diretorioSessoes, "11", "creds.json"), "{}");

  /** @type {{ cod: string, status: any }[]} */
  const reportados = [];
  /** @param {string | number} cod @param {any} status */
  const reportarStatus = async (cod, status) => void reportados.push({ cod: String(cod), status });
  const manager = criarInstanciaManager({ diretorioSessoes, caminhoRegistro, reportarStatus });

  assert.deepEqual(manager.listarRegistradas(), [
    { cod_equipe: "11", hash_empresa: "hash-k" },
    { cod_equipe: "12", hash_empresa: "hash-l" },
  ]);
  assert.equal(manager.temSessaoSalva("11"), true);
  assert.equal(manager.temSessaoSalva("12"), false);

  await criarInstanciaHealth({ manager, reportarStatus }).verificarTodas();

  assert.deepEqual(baileysFalso.pastasAuthState, [path.join(diretorioSessoes, "11")]);
  assert.ok(manager.obter("11"));
  assert.equal(manager.obter("12"), null);
  assert.ok(reportados.some((r) => r.cod === "12" && r.status.status_conexao === "DESCONECTADO" && r.status.hash_empresa === "hash-l"));
  assert.equal(fs.existsSync(path.join(diretorioSessoes, "12")), false, "sem sessão, nenhuma pasta nem QR é criado");

  // Na rodada seguinte a equipe 11 já está em memória: reporta o status dela e não abre outro socket.
  reportados.length = 0;
  await criarInstanciaHealth({ manager, reportarStatus }).verificarTodas();
  assert.equal(baileysFalso.sockets.length, 1);
  assert.deepEqual(reportados.find((r) => r.cod === "11")?.status, { hash_empresa: "hash-k", status_conexao: "DESCONECTADO", ultimo_erro_conexao: null });
  await manager.encerrarTodas();
});

test("com o manager real, a rodada reconecta a equipe pareada e, depois do desconectar, não reabre nada", async () => {
  const diretorioSessoes = path.join(raiz, "sessoes-19");
  const caminhoRegistro = path.join(raiz, "cache-19", "equipes-wa.json");
  fs.mkdirSync(path.join(diretorioSessoes, "3"), { recursive: true });
  fs.writeFileSync(path.join(diretorioSessoes, "3", "creds.json"), "{}");
  fs.mkdirSync(path.dirname(caminhoRegistro), { recursive: true });
  fs.writeFileSync(caminhoRegistro, JSON.stringify({ 3: { hash_empresa: "hash-a" } }));
  const manager = criarInstanciaManager({ diretorioSessoes, caminhoRegistro, reportarStatus: async () => {} });
  const health = criarInstanciaHealth({ manager, reportarStatus: async () => {} });

  await health.verificarTodas();
  assert.equal(baileysFalso.sockets.length, 1, "pareada e sem instância: reconecta");

  await manager.desconectar(3, "hash-a");
  baileysFalso.limparHistorico();
  await health.verificarTodas();
  assert.equal(baileysFalso.sockets.length, 0, "desconectada: o heartbeat não reabre");
  assert.deepEqual(manager.listarRegistradas(), []);
});
