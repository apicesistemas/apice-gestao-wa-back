// @ts-check
// Mídia no fluxo de entrada do adapter: messages.upsert → normalizar → baixar (stream com
// reuploadRequest) e validar → registrar a mensagem (com midia_pendente) → enviar o binário ao back.
// O Baileys é o falso (tests/helpers/baileysFalso.js) e o download devolve streams em memória.
const { test, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");
const baileysFalso = require("../helpers/baileysFalso");

baileysFalso.instalarBaileysFalso();
const { criarAdapter } = require("../../src/whatsapp/BaileysAdapter");
const { mensagemWa, EU, long } = require("../helpers/mensagensWa");
const arquivos = require("../helpers/arquivosMidia");

const { ultimoSocket, drenar, definirDownload } = baileysFalso;

const diretorioSessoes = fs.mkdtempSync(path.join(os.tmpdir(), "wa-back-midia-"));
after(() => fs.rmSync(diretorioSessoes, { recursive: true, force: true }));

beforeEach(() => baileysFalso.limparHistorico());

/** @param {Buffer} buffer */
const streamDe = (buffer) => Readable.from([buffer.subarray(0, 5), buffer.subarray(5)]);

/**
 * Adapter conectado com o registro e o envio de mídia ao back trocados por falsos que guardam a
 * ordem das chamadas.
 * @param {{ tetoBytes?: number, prazoMs?: number, registrar?: () => Promise<unknown>, enviar?: () => Promise<unknown> }} [opcoes]
 */
async function adapterConectado({ tetoBytes = 1024, prazoMs = 1000, registrar, enviar } = {}) {
  /** @type {string[]} */
  const ordem = [];
  /** @type {{ mensagem: any, contexto: any, estadoMidia: any }[]} */
  const registradas = [];
  /** @type {{ mensagem_wa_id: string, buffer: Buffer, metadados: any }[]} */
  const midiasEnviadas = [];
  const adapter = criarAdapter({
    codEquipe: "21",
    hashEmpresa: "hash-empresa-teste",
    diretorioSessoes,
    obterLimitesMidia: () => ({ tetoBytes, prazoMs }),
    registrarMensagem: async (mensagem, contexto, estadoMidia) => {
      ordem.push(`registrar:${mensagem.mensagem_wa_id}`);
      registradas.push({ mensagem, contexto, estadoMidia });
      if (registrar) await registrar();
    },
    enviarMidia: async (mensagem_wa_id, buffer, metadados) => {
      ordem.push(`midia:${mensagem_wa_id}`);
      midiasEnviadas.push({ mensagem_wa_id, buffer, metadados });
      if (enviar) await enviar();
    },
  });
  await adapter.iniciar();
  const socket = /** @type {any} */ (ultimoSocket());
  socket.user = { id: EU.jid, lid: EU.lid };
  socket.onWhatsApp = async () => [];
  await socket.emitir("connection.update", { connection: "open" });
  /** @param {any[]} messages */
  const receber = async (messages) => {
    await socket.emitir("messages.upsert", { messages, type: "notify" });
    await drenar();
  };
  return { socket, ordem, registradas, midiasEnviadas, receber };
}

/** @param {string} [mimetype] @param {number} [tamanho] */
const documentoWa = (mimetype = "application/pdf", tamanho = 60) =>
  mensagemWa({ documentMessage: { mimetype, fileName: "nota fiscal.pdf", fileLength: long(tamanho), url: "https://mmg.whatsapp.net/teste" } });

test("mídia recebida é baixada em stream com reuploadRequest, a mensagem é registrada e o binário vai ao back depois", async () => {
  const conteudo = arquivos.pdf();
  definirDownload(async () => streamDe(conteudo));
  const { socket, ordem, registradas, midiasEnviadas, receber } = await adapterConectado();
  const msg = documentoWa();

  await receber([msg]);

  assert.equal(baileysFalso.downloads.length, 1);
  const [mensagemBaixada, tipo, , contextoDownload] = baileysFalso.downloads[0];
  assert.equal(mensagemBaixada, msg);
  assert.equal(tipo, "stream");
  assert.equal(contextoDownload.reuploadRequest, socket.updateMediaMessage);

  assert.deepEqual(ordem, [`registrar:${msg.key.id}`, `midia:${msg.key.id}`]);
  assert.deepEqual(registradas[0].estadoMidia, { midia_pendente: false, midia_motivo_pendencia: null });
  assert.deepEqual(registradas[0].contexto, { hash_empresa: "hash-empresa-teste", cod_equipe: "21" });
  assert.equal(midiasEnviadas[0].mensagem_wa_id, msg.key.id);
  assert.deepEqual(midiasEnviadas[0].buffer, conteudo);
  assert.deepEqual(midiasEnviadas[0].metadados, {
    hash_empresa: "hash-empresa-teste",
    cod_equipe: "21",
    mimetype: "application/pdf",
    tamanho_bytes: conteudo.length,
    nome_arquivo: "nota fiscal.pdf",
    duracao_segundos: null,
  });
});

test("uma falha no download registra a mensagem com midia_pendente, sem perder a mensagem", async () => {
  definirDownload(async () => {
    throw new Error("falha de rede do WhatsApp");
  });
  const { ordem, registradas, midiasEnviadas, receber } = await adapterConectado();
  const msg = documentoWa();
  const seguinte = mensagemWa({ conversation: "e agora?" });

  await receber([msg, seguinte]);

  assert.deepEqual(ordem, [`registrar:${msg.key.id}`, `registrar:${seguinte.key.id}`]);
  assert.equal(registradas[0].mensagem.tipo, "DOCUMENTO");
  assert.equal(registradas[0].mensagem.midia.nome_arquivo, "nota fiscal.pdf");
  assert.deepEqual(registradas[0].estadoMidia, { midia_pendente: true, midia_motivo_pendencia: "DOWNLOAD_FALHOU" });
  assert.deepEqual(registradas[1].estadoMidia, { midia_pendente: false, midia_motivo_pendencia: null });
  assert.equal(midiasEnviadas.length, 0);
});

test("um download que estoura o prazo registra a mensagem com midia_pendente (PRAZO_ESGOTADO) e a fila segue", async () => {
  definirDownload(() => new Promise(() => {}));
  const { registradas, midiasEnviadas, receber } = await adapterConectado({ prazoMs: 20 });
  const msg = documentoWa();
  await receber([msg]);
  await new Promise((resolve) => setTimeout(resolve, 60));
  await drenar();
  assert.equal(registradas.length, 1);
  assert.deepEqual(registradas[0].estadoMidia, { midia_pendente: true, midia_motivo_pendencia: "PRAZO_ESGOTADO" });
  assert.equal(midiasEnviadas.length, 0);
});

test("conteúdo divergente do tipo declarado e arquivo acima do teto são recusados, e a mensagem continua registrada", async () => {
  definirDownload(async () => streamDe(arquivos.jpeg()));
  const divergente = await adapterConectado();
  await divergente.receber([documentoWa("application/pdf")]);
  assert.deepEqual(divergente.registradas[0].estadoMidia, { midia_pendente: true, midia_motivo_pendencia: "TIPO_DIVERGENTE" });
  assert.equal(divergente.midiasEnviadas.length, 0);

  baileysFalso.limparHistorico();
  definirDownload(async () => streamDe(arquivos.pdf()));
  const grande = await adapterConectado({ tetoBytes: 100 });
  await grande.receber([documentoWa("application/pdf", 5000)]);
  assert.equal(baileysFalso.downloads.length, 0, "tamanho declarado acima do teto: nem começa o download");
  assert.deepEqual(grande.registradas[0].estadoMidia, { midia_pendente: true, midia_motivo_pendencia: "ACIMA_DO_TETO" });
  assert.equal(grande.midiasEnviadas.length, 0);
});

test("mensagem sem mídia não baixa nada e vai com midia_pendente false", async () => {
  const { registradas, midiasEnviadas, receber } = await adapterConectado();
  await receber([mensagemWa({ conversation: "oi" })]);
  assert.equal(baileysFalso.downloads.length, 0);
  assert.deepEqual(registradas[0].estadoMidia, { midia_pendente: false, midia_motivo_pendencia: null });
  assert.equal(midiasEnviadas.length, 0);
});

test("áudio PTT vai ao back com o mimetype detectado e a duração real do OGG", async () => {
  definirDownload(async () => streamDe(arquivos.oggOpus(6)));
  const { midiasEnviadas, receber } = await adapterConectado();
  await receber([mensagemWa({ audioMessage: { mimetype: "audio/ogg; codecs=opus", ptt: true, seconds: 2, fileLength: long(80), url: "https://mmg.whatsapp.net/a" } })]);
  assert.equal(midiasEnviadas.length, 1);
  assert.equal(midiasEnviadas[0].metadados.mimetype, "audio/ogg");
  assert.equal(midiasEnviadas[0].metadados.duracao_segundos, 6);
});

test("uma falha ao enviar a mídia ao back só loga: a mensagem já foi registrada e a fila segue", async () => {
  definirDownload(async () => streamDe(arquivos.pdf()));
  const { ordem, receber } = await adapterConectado({
    enviar: async () => {
      throw new Error("back fora do ar");
    },
  });
  const msg = documentoWa();
  const seguinte = mensagemWa({ conversation: "oi" });
  await receber([msg, seguinte]);
  assert.deepEqual(ordem, [`registrar:${msg.key.id}`, `midia:${msg.key.id}`, `registrar:${seguinte.key.id}`]);
});

test("se o registro da mensagem falha, a mídia não é enviada (o back não teria a que associar)", async () => {
  definirDownload(async () => streamDe(arquivos.pdf()));
  const { ordem, receber } = await adapterConectado({
    registrar: async () => {
      throw new Error("back fora do ar");
    },
  });
  const msg = documentoWa();
  await receber([msg]);
  assert.deepEqual(ordem, [`registrar:${msg.key.id}`]);
});
