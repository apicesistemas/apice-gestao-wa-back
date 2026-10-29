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
const { mp4ComAudio } = require("../helpers/mp4Falso");
const { criarFilaTranscricao } = require("../../src/audio/filaTranscricao");

const { ultimoSocket, drenar, definirDownload } = baileysFalso;

const diretorioSessoes = fs.mkdtempSync(path.join(os.tmpdir(), "wa-back-midia-"));
after(() => fs.rmSync(diretorioSessoes, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));

beforeEach(() => baileysFalso.limparHistorico());

/** @param {Buffer} buffer */
const streamDe = (buffer) => Readable.from([buffer.subarray(0, 5), buffer.subarray(5)]);

/**
 * Adapter conectado com o registro e o envio de mídia ao back trocados por falsos que guardam a
 * ordem das chamadas.
 * A transcrição é trocada por um falso que só guarda as tarefas (ou pela fila passada no teste).
 * @param {{
 *   tetoBytes?: number,
 *   prazoMs?: number,
 *   registrar?: () => Promise<unknown>,
 *   enviar?: () => Promise<unknown>,
 *   enfileirarTranscricao?: (tarefa: any) => Promise<unknown>,
 * }} [opcoes]
 */
async function adapterConectado({ tetoBytes = 1024, prazoMs = 1000, registrar, enviar, enfileirarTranscricao } = {}) {
  /** @type {string[]} */
  const ordem = [];
  /** @type {{ mensagem: any, contexto: any, estadoMidia: any }[]} */
  const registradas = [];
  /** @type {{ mensagem_wa_id: string, buffer: Buffer, metadados: any }[]} */
  const midiasEnviadas = [];
  /** @type {any[]} */
  const transcricoes = [];
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
    enfileirarTranscricao: (tarefa) => {
      ordem.push(`transcricao:${tarefa.mensagem_wa_id}`);
      transcricoes.push(tarefa);
      return enfileirarTranscricao ? enfileirarTranscricao(tarefa) : Promise.resolve();
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
  return { socket, ordem, registradas, midiasEnviadas, transcricoes, receber };
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
  const divergente = await adapterConectado();
  // imagem declarada JPEG com conteúdo PDF (DOCUMENTO divergente é aceito como octet-stream: ver o fim do arquivo)
  definirDownload(async () => streamDe(arquivos.pdf()));
  await divergente.receber([mensagemWa({ imageMessage: { mimetype: "image/jpeg", fileLength: long(60), url: "https://mmg.whatsapp.net/teste" } })]);
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

// Transcrição (Task 5.2): áudio e vídeo registrados com a mídia aceita entram na fila de
// transcrição (concorrência 1, global), sem bloquear a fila de entrada da equipe.

/** @param {number} [segundos] */
const audioPttWa = (segundos = 6) =>
  mensagemWa({ audioMessage: { mimetype: "audio/ogg; codecs=opus", ptt: true, seconds: segundos, fileLength: long(80), url: "https://mmg.whatsapp.net/a" } });
const videoWa = () => mensagemWa({ videoMessage: { mimetype: "video/mp4", seconds: 3, fileLength: long(400), url: "https://mmg.whatsapp.net/v", caption: "olha o erro" } });

test("um áudio PTT registrado com a mídia aceita entra na fila de transcrição depois do registro e do envio da mídia", async () => {
  const ogg = arquivos.oggOpus(6);
  definirDownload(async () => streamDe(ogg));
  const { ordem, transcricoes, receber } = await adapterConectado();
  const msg = audioPttWa();
  await receber([msg]);
  assert.deepEqual(ordem, [`registrar:${msg.key.id}`, `midia:${msg.key.id}`, `transcricao:${msg.key.id}`]);
  assert.deepEqual(transcricoes, [
    { mensagem_wa_id: msg.key.id, buffer: ogg, mimetype: "audio/ogg", duracao_segundos: 6, contexto: { hash_empresa: "hash-empresa-teste", cod_equipe: "21" } },
  ]);
});

test("um vídeo registrado com a mídia aceita entra na fila de transcrição com o tipo detectado", async () => {
  const video = mp4ComAudio();
  definirDownload(async () => streamDe(video));
  const { transcricoes, receber } = await adapterConectado();
  const msg = videoWa();
  await receber([msg]);
  assert.equal(transcricoes.length, 1);
  assert.equal(transcricoes[0].mimetype, "video/mp4");
  assert.equal(transcricoes[0].duracao_segundos, 3);
  assert.deepEqual(transcricoes[0].buffer, video);
});

test("um GIF (videoMessage com gifPlayback) é registrado com midia.gif e a mídia segue, mas não entra na fila de transcrição", async () => {
  const video = mp4ComAudio();
  definirDownload(async () => streamDe(video));
  const { ordem, registradas, transcricoes, receber } = await adapterConectado();
  const msg = mensagemWa({ videoMessage: { mimetype: "video/mp4", seconds: 2, fileLength: long(400), url: "https://mmg.whatsapp.net/g", gifPlayback: true } });
  await receber([msg]);
  assert.deepEqual(ordem, [`registrar:${msg.key.id}`, `midia:${msg.key.id}`]);
  assert.equal(registradas[0].mensagem.midia.gif, true);
  assert.equal(transcricoes.length, 0);
});

test("documento, imagem, mídia pendente ou mensagem não registrada não entram na fila de transcrição", async () => {
  definirDownload(async () => streamDe(arquivos.pdf()));
  const doc = await adapterConectado();
  await doc.receber([documentoWa()]);
  assert.equal(doc.transcricoes.length, 0);

  // PFX (certificado digital) nunca vai à MiniMax: é DOCUMENTO e fica fora da fila de transcrição.
  definirDownload(async () => streamDe(arquivos.pfx()));
  const pfx = await adapterConectado();
  await pfx.receber([documentoWa("application/x-pkcs12")]);
  assert.equal(pfx.registradas.length, 1);
  assert.equal(pfx.midiasEnviadas.length, 1);
  assert.equal(pfx.midiasEnviadas[0].metadados.mimetype, "application/x-pkcs12");
  assert.equal(pfx.transcricoes.length, 0);

  definirDownload(async () => {
    throw new Error("falha de rede do WhatsApp");
  });
  const pendente = await adapterConectado();
  await pendente.receber([audioPttWa()]);
  assert.equal(pendente.registradas.length, 1);
  assert.equal(pendente.transcricoes.length, 0, "sem o binário não há o que transcrever");

  definirDownload(async () => streamDe(arquivos.oggOpus(3)));
  const semRegistro = await adapterConectado({
    registrar: async () => {
      throw new Error("back fora do ar");
    },
  });
  await semRegistro.receber([audioPttWa()]);
  assert.equal(semRegistro.transcricoes.length, 0);
});

test("a transcrição não bloqueia a fila de entrada: a mensagem seguinte é registrada com a transcrição ainda em andamento", async () => {
  definirDownload(async () => streamDe(arquivos.oggOpus(3)));
  const { ordem, receber } = await adapterConectado({ enfileirarTranscricao: () => new Promise(() => {}) });
  const audio = audioPttWa();
  const seguinte = mensagemWa({ conversation: "ouviu?" });
  await receber([audio, seguinte]);
  assert.deepEqual(ordem, [`registrar:${audio.key.id}`, `midia:${audio.key.id}`, `transcricao:${audio.key.id}`, `registrar:${seguinte.key.id}`]);
});

test("uma transcrição que rejeita (defesa) só loga e a fila de entrada segue", async () => {
  definirDownload(async () => streamDe(arquivos.oggOpus(3)));
  const { registradas, receber } = await adapterConectado({ enfileirarTranscricao: () => Promise.reject(new Error("bug")) });
  await receber([audioPttWa(), mensagemWa({ conversation: "oi" })]);
  await drenar();
  assert.equal(registradas.length, 2);
});

test("uma falha da MiniMax (429/timeout) envia status PENDENTE, e a mensagem continua registrada", async () => {
  const VARS = ["CRM_BACK_URL", "CRM_BACK_SERVICE_TOKEN", "MINIMAX_API_KEY"];
  const envOriginal = Object.fromEntries(VARS.map((nome) => [nome, process.env[nome]]));
  const fetchOriginal = globalThis.fetch;
  process.env.CRM_BACK_URL = "http://back.local:3500";
  process.env.CRM_BACK_SERVICE_TOKEN = "token-wa-para-back";
  process.env.MINIMAX_API_KEY = "chave-minimax-de-teste";
  /** @type {any[]} */
  const transcricoesNoBack = [];
  let chamadasMinimax = 0;
  globalThis.fetch = /** @type {typeof fetch} */ (
    async (url, init) => {
      if (String(url).includes("minimax")) {
        chamadasMinimax += 1;
        if (chamadasMinimax === 1) return new Response("conn limit (1041)", { status: 429 });
        throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
      }
      transcricoesNoBack.push({ url: String(url), corpo: JSON.parse(String(init?.body)) });
      return Response.json({ msg: "ok" });
    }
  );
  try {
    definirDownload(async () => streamDe(arquivos.oggOpus(5)));
    const fila = criarFilaTranscricao({ esperar: async () => {} });
    /** @type {Promise<unknown>[]} */
    const emAndamento = [];
    const { registradas, midiasEnviadas, receber } = await adapterConectado({
      enfileirarTranscricao: (tarefa) => {
        const p = fila.enfileirarTranscricao(tarefa);
        emAndamento.push(p);
        return p;
      },
    });
    const msg = audioPttWa(5);
    await receber([msg]);
    const [resultado] = await Promise.all(emAndamento);

    assert.deepEqual(resultado, { status: "PENDENTE", texto: null });
    assert.equal(chamadasMinimax, 2, "uma chamada + uma nova tentativa");
    assert.equal(registradas.length, 1, "a mensagem foi registrada e continua registrada");
    assert.equal(registradas[0].mensagem.mensagem_wa_id, msg.key.id);
    assert.equal(registradas[0].mensagem.tipo, "AUDIO");
    assert.equal(midiasEnviadas.length, 1, "a mídia também foi ao back");
    assert.deepEqual(transcricoesNoBack, [
      {
        url: "http://back.local:3500/interno/transcricao",
        corpo: { hash_empresa: "hash-empresa-teste", cod_equipe: 21, mensagem_wa_id: msg.key.id, status: "PENDENTE", texto: null },
      },
    ]);
  } finally {
    globalThis.fetch = fetchOriginal;
    for (const nome of VARS) {
      if (envOriginal[nome] === undefined) delete process.env[nome];
      else process.env[nome] = envOriginal[nome];
    }
  }
});

// ---- DOCUMENTO de qualquer tipo é aceito; os demais tipos seguem rígidos ----

const XML_NFE = Buffer.from('<?xml version="1.0" encoding="UTF-8"?><nfeProc></nfeProc>');

test("DOCUMENTO XML (conteúdo não reconhecido) é registrado sem pendência e a mídia vai ao back como octet-stream", async () => {
  definirDownload(async () => streamDe(XML_NFE));
  const { registradas, midiasEnviadas, receber } = await adapterConectado();
  await receber([mensagemWa({ documentMessage: { mimetype: "text/xml", fileName: "nfe.xml", fileLength: long(60), url: "https://mmg.whatsapp.net/teste" } })]);
  assert.deepEqual(registradas[0].estadoMidia, { midia_pendente: false, midia_motivo_pendencia: null });
  assert.equal(midiasEnviadas.length, 1);
  assert.deepEqual(midiasEnviadas[0].buffer, XML_NFE);
  assert.equal(midiasEnviadas[0].metadados.mimetype, "application/octet-stream");
  assert.equal(midiasEnviadas[0].metadados.nome_arquivo, "nfe.xml");
});

test("DOCUMENTO com PDF divergente do declarado é aceito como octet-stream; o PDF compatível segue application/pdf", async () => {
  definirDownload(async () => streamDe(arquivos.jpeg()));
  const divergente = await adapterConectado();
  await divergente.receber([documentoWa("application/pdf")]);
  assert.deepEqual(divergente.registradas[0].estadoMidia, { midia_pendente: false, midia_motivo_pendencia: null });
  assert.equal(divergente.midiasEnviadas[0].metadados.mimetype, "application/octet-stream");

  baileysFalso.limparHistorico();
  definirDownload(async () => streamDe(arquivos.pdf()));
  const compativel = await adapterConectado();
  await compativel.receber([documentoWa("application/pdf")]);
  assert.equal(compativel.midiasEnviadas[0].metadados.mimetype, "application/pdf");
});

test("o mesmo conteúdo desconhecido como IMAGEM, VÍDEO, ÁUDIO ou FIGURINHA continua pendente (TIPO_NAO_RECONHECIDO)", async () => {
  const url = "https://mmg.whatsapp.net/teste";
  const mensagens = [
    { imageMessage: { mimetype: "image/jpeg", fileLength: long(60), url } },
    { videoMessage: { mimetype: "video/mp4", seconds: 3, fileLength: long(60), url } },
    { audioMessage: { mimetype: "audio/ogg; codecs=opus", seconds: 3, ptt: true, fileLength: long(60), url } },
    { stickerMessage: { mimetype: "image/webp", fileLength: long(60), url } },
  ];
  for (const conteudo of mensagens) {
    baileysFalso.limparHistorico();
    definirDownload(async () => streamDe(XML_NFE));
    const { registradas, midiasEnviadas, receber } = await adapterConectado();
    await receber([mensagemWa(conteudo)]);
    assert.deepEqual(registradas[0].estadoMidia, { midia_pendente: true, midia_motivo_pendencia: "TIPO_NAO_RECONHECIDO" }, Object.keys(conteudo)[0]);
    assert.equal(midiasEnviadas.length, 0);
  }
});
