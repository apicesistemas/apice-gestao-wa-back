// @ts-check
// instanciaManager com o adapter Baileys real e o socket mockado via require.cache. Sessões e o
// registro de equipes pareadas ficam num diretório temporário; o reportarStatus é injetado.
const { test, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const baileysFalso = require("../helpers/baileysFalso");

baileysFalso.instalarBaileysFalso();
const { criarInstanciaManager } = require("../../src/whatsapp/instanciaManager");

const { sockets, DisconnectReason } = baileysFalso;
const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "wa-back-manager-"));
after(() => fs.rmSync(raiz, { recursive: true, force: true }));

let contador = 0;
beforeEach(() => baileysFalso.limparHistorico());

/** Cria um manager com diretórios próprios e captura os status reportados ao back. */
function novoManager() {
  contador += 1;
  const diretorioSessoes = path.join(raiz, `sessoes-${contador}`);
  const caminhoRegistro = path.join(raiz, `cache-${contador}`, "equipes-wa.json");
  /** @type {{ codEquipe: string, status: any }[]} */
  const reportados = [];
  const manager = criarInstanciaManager({
    diretorioSessoes,
    caminhoRegistro,
    reportarStatus: async (codEquipe, status) => {
      reportados.push({ codEquipe: String(codEquipe), status });
    },
  });
  return { manager, reportados, diretorioSessoes, caminhoRegistro };
}

/** @param {string} caminho */
const lerRegistro = (caminho) => JSON.parse(fs.readFileSync(caminho, "utf8"));

/** Socket criado para a pasta de sessão informada. */
/** @param {string} pasta */
function socketDaPasta(pasta) {
  const indice = baileysFalso.pastasAuthState.lastIndexOf(pasta);
  assert.ok(indice >= 0, `nenhum socket aberto para ${pasta}`);
  return sockets[indice];
}

test("duas equipes têm instâncias e caches isolados", async () => {
  const { manager, reportados, diretorioSessoes } = novoManager();
  const a = await manager.conectar(1, "hash-a");
  const b = await manager.conectar("2", "hash-b");

  assert.notEqual(a, b);
  assert.equal(manager.obter("1"), a);
  assert.equal(manager.obter(2), b);
  assert.equal(manager.obter(3), null);

  const socketA = socketDaPasta(path.join(diretorioSessoes, "1"));
  const socketB = socketDaPasta(path.join(diretorioSessoes, "2"));
  assert.notEqual(socketA, socketB);
  assert.notEqual(socketA.config.msgRetryCounterCache, socketB.config.msgRetryCounterCache);
  assert.notEqual(socketA.config.userDevicesCache, socketB.config.userDevicesCache);

  // O QR da equipe 1 não aparece na equipe 2, e o status de uma não muda o da outra.
  await socketA.emitir("connection.update", { qr: "2@qr-equipe-1" });
  assert.equal(a.obterQr(), "2@qr-equipe-1");
  assert.equal(b.obterQr(), null);
  assert.equal(a.obterStatusConexao().status_conexao, "QR_PENDENTE");
  assert.notEqual(b.obterStatusConexao().status_conexao, "QR_PENDENTE");

  // Cada status vai ao back com o hash_empresa da própria equipe.
  const doA = reportados.filter((r) => r.codEquipe === "1");
  assert.ok(doA.length > 0);
  assert.ok(doA.every((r) => r.status.hash_empresa === "hash-a"));
  assert.equal(doA.at(-1)?.status.status_conexao, "QR_PENDENTE");
  assert.ok(reportados.filter((r) => r.codEquipe === "2").every((r) => r.status.hash_empresa === "hash-b"));
});

test("conectar() de equipe saudável devolve a mesma instância sem abrir outro socket", async () => {
  const { manager, diretorioSessoes } = novoManager();
  const instancia = await manager.conectar(5, "hash-a");
  await socketDaPasta(path.join(diretorioSessoes, "5")).emitir("connection.update", { qr: "2@qr" });

  const deNovo = await manager.conectar(5, "hash-a");
  assert.equal(deNovo, instancia);
  assert.equal(sockets.length, 1);
});

test("conectar() simultâneo da mesma equipe abre um único socket", async () => {
  const { manager } = novoManager();
  const [x, y] = await Promise.all([manager.conectar(6, "hash-a"), manager.conectar(6, "hash-a")]);
  assert.equal(x, y);
  assert.equal(sockets.length, 1);
});

test("conectar() com hash_empresa diferente do da instância é recusado", async () => {
  const { manager } = novoManager();
  await manager.conectar(7, "hash-a");
  await assert.rejects(manager.conectar(7, "hash-b"), (erro) => /** @type {any} */ (erro).codigo === "EQUIPE_OUTRA_EMPRESA");
});

test("uma falha no iniciar() não deixa adapter zumbi no Map", async () => {
  const { manager, diretorioSessoes } = novoManager();
  // Um arquivo no lugar do diretório base faz o useMultiFileAuthState falso falhar no mkdir.
  fs.mkdirSync(path.dirname(diretorioSessoes), { recursive: true });
  fs.writeFileSync(diretorioSessoes, "não é diretório");

  await assert.rejects(manager.conectar(8, "hash-a"));
  assert.equal(manager.obter(8), null);
  fs.rmSync(diretorioSessoes, { force: true });
});

test("a equipe que conecta entra no registro de pareadas, e o loggedOut a remove", async () => {
  const { manager, diretorioSessoes, caminhoRegistro } = novoManager();
  await manager.conectar(9, "hash-a");
  const socket = socketDaPasta(path.join(diretorioSessoes, "9"));

  await socket.emitir("connection.update", { connection: "open" });
  assert.deepEqual(lerRegistro(caminhoRegistro), { 9: { hash_empresa: "hash-a" } });

  await socket.emitir("connection.update", {
    connection: "close",
    lastDisconnect: { error: { output: { statusCode: DisconnectReason.loggedOut } } },
  });
  assert.deepEqual(lerRegistro(caminhoRegistro), {});
});

test("reconectarTodas() reconecta só as equipes pareadas com sessão salva em disco", async () => {
  const { manager, diretorioSessoes, caminhoRegistro } = novoManager();
  fs.mkdirSync(path.dirname(caminhoRegistro), { recursive: true });
  fs.writeFileSync(
    caminhoRegistro,
    JSON.stringify({ 21: { hash_empresa: "hash-a" }, 22: { hash_empresa: "hash-b" }, "../x": { hash_empresa: "hash-c" } })
  );
  fs.mkdirSync(path.join(diretorioSessoes, "21"), { recursive: true });
  fs.writeFileSync(path.join(diretorioSessoes, "21", "creds.json"), "{}");
  // Equipe 23 tem pasta de sessão, mas nunca pareou (não está no registro): não gera QR à toa.
  fs.mkdirSync(path.join(diretorioSessoes, "23"), { recursive: true });
  fs.writeFileSync(path.join(diretorioSessoes, "23", "creds.json"), "{}");

  const reconectadas = await manager.reconectarTodas();

  assert.deepEqual(reconectadas, ["21"]);
  assert.ok(manager.obter(21));
  assert.equal(manager.obter(22), null, "sem sessão em disco não reconecta");
  assert.equal(manager.obter(23), null);
  assert.equal(sockets.length, 1);
  assert.equal(manager.obter(21)?.hashEmpresa, "hash-a");
});

test("reconectarTodas() sem registro não faz nada", async () => {
  const { manager } = novoManager();
  assert.deepEqual(await manager.reconectarTodas(), []);
  assert.equal(sockets.length, 0);
});

test("encerrarTodas() encerra os sockets de todas as equipes e esvazia o Map", async () => {
  const { manager } = novoManager();
  await manager.conectar(31, "hash-a");
  await manager.conectar(32, "hash-b");

  await manager.encerrarTodas();

  assert.equal(sockets.length, 2);
  assert.ok(sockets.every((s) => s.chamadasEnd === 1));
  assert.equal(manager.obter(31), null);
  assert.equal(manager.obter(32), null);
});
