// @ts-check
// GET /ping com o status de cada equipe (Task 15.3). Usa o instanciaManager e o adapter Baileys
// reais, com o socket mockado via require.cache: uma equipe conectada (com `sock.user` de JID, LID e
// nome do número parecidos com os reais) e outra com QR pendente. A resposta não pode levar JID,
// telefone, LID, nome do número, QR nem hash_empresa em lugar nenhum do JSON.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const express = require("express");
const baileysFalso = require("../helpers/baileysFalso");

baileysFalso.instalarBaileysFalso();
const { registrarControllers } = require("../../src/http");
const { criarHealthController } = require("../../src/http/HealthController");
const { criarInstanciaManager } = require("../../src/whatsapp/instanciaManager");
const { criarDesligamento } = require("../../src/utils/desligamento");
const { EU, TELEFONE_EQUIPE } = require("../helpers/mensagensWa");
const { version } = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "package.json"), "utf8"));

const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "wa-back-ping-"));
after(() => fs.rmSync(raiz, { recursive: true, force: true }));

const HASH_A = "hash-empresa-a-1234567890";
const HASH_B = "hash-empresa-b-0987654321";
const QR = "2@QrCodeFicticioDaEquipe2,AbCdEf==,GhIjKl==";
const NOME_NUMERO = "Suporte Ápice Financeiro";

const diretorioSessoes = path.join(raiz, "sessoes");
const caminhoRegistro = path.join(raiz, "cache", "equipes-wa.json");
const manager = criarInstanciaManager({ diretorioSessoes, caminhoRegistro, reportarStatus: async () => {} });

/** @param {string} pasta */
function socketDaPasta(pasta) {
  const indice = baileysFalso.pastasAuthState.lastIndexOf(pasta);
  assert.ok(indice >= 0, `nenhum socket aberto para ${pasta}`);
  return /** @type {any} */ (baileysFalso.sockets[indice]);
}

/**
 * Sobe um Express só com o HealthController montado sobre o manager e o desligamento informados.
 * @param {ReturnType<typeof criarDesligamento>} desligamento
 */
async function subir(desligamento) {
  const server = express();
  registrarControllers(server, [criarHealthController({ manager, desligamento })]);
  const httpServer = await new Promise((resolve) => {
    const s = server.listen(0, () => resolve(s));
  });
  const endereco = /** @type {import("node:net").AddressInfo} */ (/** @type {any} */ (httpServer).address());
  return {
    url: `http://127.0.0.1:${endereco.port}/ping`,
    fechar: () => new Promise((resolve) => /** @type {any} */ (httpServer).close(resolve)),
  };
}

before(async () => {
  // Equipe 1: conectada, com o `sock.user` como o Baileys preenche depois do pareamento.
  await manager.conectar(1, HASH_A);
  const socket1 = socketDaPasta(path.join(diretorioSessoes, "1"));
  socket1.user = { id: EU.jid, lid: EU.lid, name: NOME_NUMERO };
  await socket1.emitir("connection.update", { connection: "open" });

  // Equipe 2: aguardando a leitura do QR Code.
  await manager.conectar(2, HASH_B);
  const socket2 = socketDaPasta(path.join(diretorioSessoes, "2"));
  await socket2.emitir("connection.update", { qr: QR });
});

test("GET /ping lista o status de cada equipe sem expor JID, telefone, LID, nome do número, QR nem hash_empresa", async () => {
  const { url, fechar } = await subir(criarDesligamento());
  try {
    const resposta = await fetch(url); // sem X-Internal-Token: rota de monitoramento
    assert.equal(resposta.status, 200);
    const texto = await resposta.text();
    const corpo = JSON.parse(texto);

    assert.equal(corpo.status, "ok");
    assert.equal(corpo.versao, version);
    assert.equal(corpo.encerrando, false);
    assert.deepEqual(
      corpo.equipes.map((/** @type {any} */ e) => ({ cod_equipe: e.cod_equipe, status: e.status })),
      [
        { cod_equipe: 1, status: "CONECTADO" },
        { cod_equipe: 2, status: "QR_PENDENTE" },
      ]
    );
    // Só os campos combinados em cada equipe; `desde` é um instante ISO quando presente.
    for (const equipe of corpo.equipes) {
      assert.deepEqual(
        Object.keys(equipe).filter((k) => !["cod_equipe", "status", "desde"].includes(k)),
        [],
        "campo inesperado na equipe"
      );
      if (equipe.desde !== undefined) assert.ok(!Number.isNaN(Date.parse(equipe.desde)), "desde inválido");
    }
    assert.ok(corpo.equipes[0].desde, "a equipe conectada informa desde quando");

    // Nada do número da equipe nem do tenant em lugar nenhum do JSON serializado.
    const proibidos = [
      EU.jid,
      EU.jid.split(":")[0],
      TELEFONE_EQUIPE,
      EU.lid,
      EU.lid.split(":")[0],
      EU.lid.split("@")[0].split(":")[0],
      "@s.whatsapp.net",
      "@lid",
      NOME_NUMERO,
      QR,
      HASH_A,
      HASH_B,
    ];
    for (const proibido of proibidos) assert.ok(!texto.includes(proibido), `o /ping expôs ${proibido}`);
    // Nenhum campo sensível pelo nome (o valor "QR_PENDENTE" é permitido; o conteúdo do QR, não).
    assert.ok(
      !/"(ultimo_erro\w*|hash_empresa|\w*jid|\w*lid|qr\w*|telefone|numero\w*|nome\w*|user)"\s*:/i.test(texto),
      "o /ping expôs um campo sensível"
    );
  } finally {
    await fechar();
  }
});

test("GET /ping responde 503 com encerrando: true durante o desligamento gracioso", async () => {
  const desligamento = criarDesligamento();
  const { url, fechar } = await subir(desligamento);
  try {
    desligamento.marcarEncerrando();
    const resposta = await fetch(url);
    assert.equal(resposta.status, 503);
    assert.equal(resposta.headers.get("retry-after"), "10");
    const corpo = /** @type {any} */ (await resposta.json());
    assert.equal(corpo.status, "encerrando");
    assert.equal(corpo.encerrando, true);
    assert.equal(corpo.versao, version);
    assert.ok(Array.isArray(corpo.equipes));
  } finally {
    await fechar();
  }
});

test("GET /ping inclui como DESCONECTADO a equipe pareada sem instância no processo", async () => {
  fs.mkdirSync(path.dirname(caminhoRegistro), { recursive: true });
  const registro = JSON.parse(fs.readFileSync(caminhoRegistro, "utf8"));
  registro["7"] = { hash_empresa: "hash-empresa-c-1111" };
  fs.writeFileSync(caminhoRegistro, JSON.stringify(registro));

  const { url, fechar } = await subir(criarDesligamento());
  try {
    const texto = await (await fetch(url)).text();
    const corpo = JSON.parse(texto);
    assert.deepEqual(
      corpo.equipes.map((/** @type {any} */ e) => [e.cod_equipe, e.status]),
      [
        [1, "CONECTADO"],
        [2, "QR_PENDENTE"],
        [7, "DESCONECTADO"],
      ]
    );
    assert.ok(!texto.includes("hash-empresa-c-1111"));
  } finally {
    await fechar();
  }
});

test("GET /ping continua respondendo 200 se a leitura do status das equipes falhar", async () => {
  const server = express();
  const managerQuebrado = {
    listarStatus: () => {
      throw new Error("registro ilegível /caminho/secreto");
    },
  };
  registrarControllers(server, [criarHealthController({ manager: managerQuebrado, desligamento: criarDesligamento() })]);
  /** @type {any} */
  const httpServer = await new Promise((resolve) => {
    const s = server.listen(0, () => resolve(s));
  });
  const erroOriginal = console.error;
  console.error = () => {};
  try {
    const resposta = await fetch(`http://127.0.0.1:${httpServer.address().port}/ping`);
    assert.equal(resposta.status, 200);
    const texto = await resposta.text();
    assert.ok(!texto.includes("secreto"));
    assert.deepEqual(JSON.parse(texto).equipes, []);
  } finally {
    console.error = erroOriginal;
    await new Promise((resolve) => httpServer.close(resolve));
  }
});
