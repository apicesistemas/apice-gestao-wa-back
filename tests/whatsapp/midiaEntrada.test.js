// @ts-check
// Download da mídia recebida: em stream, com reuploadRequest, teto que interrompe o stream e prazo
// total. O download do Baileys é trocado por uma função falsa que devolve streams em memória; nenhum
// teste conecta ao WhatsApp nem grava em disco.
const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { Readable } = require("node:stream");
const { baixarMidia, obterMidiaValidada, obterLimitesMidia, ErroMidia } = require("../../src/whatsapp/midiaEntrada");
const arquivos = require("../helpers/arquivosMidia");
const { mensagemWa } = require("../helpers/mensagensWa");

/**
 * Stream lido sob demanda: cada chunk só é produzido quando o consumidor pede o próximo. Conta
 * quantos chunks foram puxados e se o stream foi destruído.
 * @param {number} totalChunks
 * @param {number} tamanhoChunk
 * @param {{ travarApos?: number }} [opcoes] para de produzir (fica pendente) depois de N chunks
 */
function streamSobDemanda(totalChunks, tamanhoChunk, { travarApos } = {}) {
  const estado = { puxados: 0, destruido: false };
  const stream = {
    destroyed: false,
    destroy() {
      estado.destruido = true;
      stream.destroyed = true;
    },
    async *[Symbol.asyncIterator]() {
      for (let i = 0; i < totalChunks; i += 1) {
        if (travarApos !== undefined && i >= travarApos) await new Promise(() => {});
        estado.puxados += 1;
        yield Buffer.alloc(tamanhoChunk, 0x41);
      }
    },
  };
  return { stream, estado };
}

/** @param {Buffer} buffer em pedaços de 7 bytes, como chega da rede */
function streamDe(buffer) {
  /** @type {Buffer[]} */
  const pedacos = [];
  for (let i = 0; i < buffer.length; i += 7) pedacos.push(buffer.subarray(i, i + 7));
  return Readable.from(pedacos);
}

const socketFalso = { updateMediaMessage: async (/** @type {any} */ m) => m };
const imagemWa = () => mensagemWa({ imageMessage: { mimetype: "image/jpeg", url: "https://mmg.whatsapp.net/teste", fileLength: 100 } });

test("baixarMidia pede o download em stream ao Baileys com reuploadRequest do socket e devolve o buffer em memória", async () => {
  /** @type {any[]} */
  const chamadas = [];
  const conteudo = arquivos.jpeg();
  const waMessage = imagemWa();
  const buffer = await baixarMidia(socketFalso, waMessage, {
    tetoBytes: 1024,
    prazoMs: 1000,
    baixar: async (...args) => {
      chamadas.push(args);
      return streamDe(conteudo);
    },
  });
  assert.ok(Buffer.isBuffer(buffer));
  assert.deepEqual(buffer, conteudo);
  assert.equal(chamadas.length, 1);
  const [mensagem, tipo, , contexto] = chamadas[0];
  assert.equal(mensagem, waMessage);
  assert.equal(tipo, "stream");
  assert.equal(contexto.reuploadRequest, socketFalso.updateMediaMessage);
  assert.ok(contexto.logger);
});

test("um arquivo acima do teto é recusado sem baixar o resto do stream", async () => {
  const { stream, estado } = streamSobDemanda(1000, 4);
  await assert.rejects(
    baixarMidia(socketFalso, imagemWa(), { tetoBytes: 10, prazoMs: 1000, baixar: async () => stream }),
    (erro) => erro instanceof ErroMidia && erro.codigo === "ACIMA_DO_TETO"
  );
  // 3 chunks de 4 bytes passam de 10: o 4º nunca é pedido e o stream é destruído (para de baixar)
  assert.equal(estado.puxados, 3);
  assert.equal(estado.destruido, true);
});

test("o teto também interrompe um stream do Node (Readable) e o destrói", async () => {
  const stream = streamDe(Buffer.alloc(10_000, 1));
  await assert.rejects(
    baixarMidia(socketFalso, imagemWa(), { tetoBytes: 100, prazoMs: 1000, baixar: async () => stream }),
    (erro) => erro instanceof ErroMidia && erro.codigo === "ACIMA_DO_TETO"
  );
  assert.equal(stream.destroyed, true);
});

test("um download que não responde dentro do prazo é abortado com PRAZO_ESGOTADO", async () => {
  const inicio = Date.now();
  await assert.rejects(
    baixarMidia(socketFalso, imagemWa(), { tetoBytes: 1024, prazoMs: 30, baixar: () => new Promise(() => {}) }),
    (erro) => erro instanceof ErroMidia && erro.codigo === "PRAZO_ESGOTADO"
  );
  assert.ok(Date.now() - inicio < 1000);
});

test("um stream que trava no meio é destruído quando o prazo vence", async () => {
  const { stream, estado } = streamSobDemanda(10, 4, { travarApos: 2 });
  await assert.rejects(
    baixarMidia(socketFalso, imagemWa(), { tetoBytes: 1024, prazoMs: 30, baixar: async () => stream }),
    (erro) => erro instanceof ErroMidia && erro.codigo === "PRAZO_ESGOTADO"
  );
  assert.equal(estado.destruido, true);
});

test("um stream que só chega depois do prazo é destruído sem ser lido", async () => {
  const { stream, estado } = streamSobDemanda(10, 4);
  /** @type {(valor: any) => void} */
  let entregar = () => {};
  const promessa = baixarMidia(socketFalso, imagemWa(), {
    tetoBytes: 1024,
    prazoMs: 20,
    baixar: () => new Promise((resolve) => (entregar = resolve)),
  });
  await assert.rejects(promessa, (erro) => erro instanceof ErroMidia && erro.codigo === "PRAZO_ESGOTADO");
  entregar(stream);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(estado.destruido, true);
  assert.equal(estado.puxados, 0);
});

test("uma falha do Baileys vira DOWNLOAD_FALHOU, sem repassar a mensagem original (pode ter JID/URL)", async () => {
  await assert.rejects(
    baixarMidia(socketFalso, imagemWa(), {
      tetoBytes: 1024,
      prazoMs: 1000,
      baixar: async () => {
        throw new Error("falha em 5511900000001@s.whatsapp.net https://mmg.whatsapp.net/x");
      },
    }),
    (erro) => erro instanceof ErroMidia && erro.codigo === "DOWNLOAD_FALHOU" && !/whatsapp|5511/.test(erro.message)
  );
});

test("o download nunca grava em disco", async () => {
  const originais = {
    writeFile: fs.writeFile,
    writeFileSync: fs.writeFileSync,
    createWriteStream: fs.createWriteStream,
    appendFile: fs.appendFile,
    appendFileSync: fs.appendFileSync,
    promisesWriteFile: fs.promises.writeFile,
  };
  let gravou = false;
  const marcar = () => {
    gravou = true;
    throw new Error("gravação em disco proibida");
  };
  Object.assign(fs, { writeFile: marcar, writeFileSync: marcar, createWriteStream: marcar, appendFile: marcar, appendFileSync: marcar });
  fs.promises.writeFile = /** @type {any} */ (marcar);
  try {
    const resultado = await obterMidiaValidada(socketFalso, imagemWa(), { mimetype: "image/jpeg", tamanho_bytes: 100, nome_arquivo: null, duracao_segundos: null, ptt: false, gif: false }, {
      tetoBytes: 1024,
      prazoMs: 1000,
      baixar: async () => streamDe(arquivos.jpeg()),
    });
    assert.equal(resultado.ok, true);
  } finally {
    Object.assign(fs, { writeFile: originais.writeFile, writeFileSync: originais.writeFileSync, createWriteStream: originais.createWriteStream, appendFile: originais.appendFile, appendFileSync: originais.appendFileSync });
    fs.promises.writeFile = originais.promisesWriteFile;
  }
  assert.equal(gravou, false);
});

/** @param {Partial<import("../../src/whatsapp/filtroEntrada").MetadadosMidia>} [m] */
const metadados = (m = {}) => ({ mimetype: "application/pdf", tamanho_bytes: 50, nome_arquivo: "boleto.pdf", duracao_segundos: null, ptt: false, gif: false, ...m });

test("obterMidiaValidada baixa, valida e devolve o buffer com o mimetype detectado e o tamanho real", async () => {
  const conteudo = arquivos.pdf();
  const resultado = await obterMidiaValidada(socketFalso, imagemWa(), metadados(), { tetoBytes: 1024, prazoMs: 1000, baixar: async () => streamDe(conteudo) });
  assert.deepEqual(resultado, {
    ok: true,
    buffer: conteudo,
    mimetype: "application/pdf",
    tamanho_bytes: conteudo.length,
    nome_arquivo: "boleto.pdf",
    duracao_segundos: null,
  });
});

test("obterMidiaValidada usa a duração real do OGG/Opus no lugar da declarada", async () => {
  const resultado = await obterMidiaValidada(socketFalso, imagemWa(), metadados({ mimetype: "audio/ogg; codecs=opus", duracao_segundos: 99, ptt: true }), {
    tetoBytes: 1024,
    prazoMs: 1000,
    baixar: async () => streamDe(arquivos.oggOpus(4)),
  });
  assert.equal(resultado.ok, true);
  assert.equal(resultado.ok && resultado.mimetype, "audio/ogg");
  assert.equal(resultado.ok && resultado.duracao_segundos, 4);
});

test("obterMidiaValidada recusa sem baixar quando o tamanho declarado já passa do teto", async () => {
  let baixou = false;
  const resultado = await obterMidiaValidada(socketFalso, imagemWa(), metadados({ tamanho_bytes: 2048 }), {
    tetoBytes: 1024,
    prazoMs: 1000,
    baixar: async () => {
      baixou = true;
      return streamDe(arquivos.pdf());
    },
  });
  assert.deepEqual(resultado, { ok: false, motivo: "ACIMA_DO_TETO" });
  assert.equal(baixou, false);
});

test("obterMidiaValidada devolve o motivo da recusa: download, prazo, teto real e tipo divergente", async () => {
  const limites = { tetoBytes: 1024, prazoMs: 30 };
  assert.deepEqual(
    await obterMidiaValidada(socketFalso, imagemWa(), metadados(), { ...limites, baixar: async () => Promise.reject(new Error("rede")) }),
    { ok: false, motivo: "DOWNLOAD_FALHOU" }
  );
  assert.deepEqual(await obterMidiaValidada(socketFalso, imagemWa(), metadados(), { ...limites, baixar: () => new Promise(() => {}) }), {
    ok: false,
    motivo: "PRAZO_ESGOTADO",
  });
  // declarou 50 bytes, mas o stream passa do teto
  assert.deepEqual(await obterMidiaValidada(socketFalso, imagemWa(), metadados(), { ...limites, baixar: async () => streamDe(Buffer.alloc(5000)) }), {
    ok: false,
    motivo: "ACIMA_DO_TETO",
  });
  assert.deepEqual(await obterMidiaValidada(socketFalso, imagemWa(), metadados({ mimetype: "image/jpeg" }), { ...limites, baixar: async () => streamDe(arquivos.pdf()) }), {
    ok: false,
    motivo: "TIPO_DIVERGENTE",
  });
});

const VARS = ["MIDIA_TETO_BYTES", "MIDIA_PRAZO_MS"];
/** @type {Record<string, string | undefined>} */
let envOriginal = {};
beforeEach(() => {
  envOriginal = Object.fromEntries(VARS.map((nome) => [nome, process.env[nome]]));
});
afterEach(() => {
  for (const nome of VARS) {
    if (envOriginal[nome] === undefined) delete process.env[nome];
    else process.env[nome] = envOriginal[nome];
  }
});

test("obterLimitesMidia lê MIDIA_TETO_BYTES e MIDIA_PRAZO_MS, com padrão de 16 MB e 60 s", () => {
  delete process.env.MIDIA_TETO_BYTES;
  delete process.env.MIDIA_PRAZO_MS;
  assert.deepEqual(obterLimitesMidia(), { tetoBytes: 16 * 1024 * 1024, prazoMs: 60_000 });
  process.env.MIDIA_TETO_BYTES = "1048576";
  process.env.MIDIA_PRAZO_MS = "5000";
  assert.deepEqual(obterLimitesMidia(), { tetoBytes: 1048576, prazoMs: 5000 });
  process.env.MIDIA_TETO_BYTES = "abc";
  process.env.MIDIA_PRAZO_MS = "-1";
  assert.deepEqual(obterLimitesMidia(), { tetoBytes: 16 * 1024 * 1024, prazoMs: 60_000 });
});
