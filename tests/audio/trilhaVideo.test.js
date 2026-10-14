// @ts-check
// Extração da trilha de áudio de um vídeo (MP4/3GP/QuickTime) só em memória: AAC do `mp4a` vira um
// fluxo ADTS (`audio/aac`, formato aceito pela MiniMax), sem ffmpeg e sem disco. O `moov` no fim
// do arquivo (MP4 sem "faststart") funciona porque o buffer inteiro já está em memória.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { extrairTrilhaAudio, ErroTrilhaAudio, MIMETYPE_TRILHA } = require("../../src/audio/trilhaVideo");
const { mp4ComAudio, lerAdts, AMOSTRAS_PADRAO } = require("../helpers/mp4Falso");
const { detectarTipoPorConteudo } = require("../../src/whatsapp/tipoMidia");

/**
 * @param {Buffer} saida
 * @param {Buffer[]} [amostras]
 */
function conferirAdts(saida, amostras = AMOSTRAS_PADRAO) {
  const quadros = lerAdts(saida);
  assert.equal(quadros.length, amostras.length);
  quadros.forEach((q, i) => {
    assert.equal(q.mpeg4, true);
    assert.equal(q.semCrc, true);
    assert.equal(q.perfil, 1, "AAC-LC no ADTS é perfil 1 (objeto 2 − 1)");
    assert.equal(q.indiceFrequencia, 4, "44,1 kHz");
    assert.equal(q.canais, 2);
    assert.deepEqual(q.conteudo, amostras[i]);
  });
}

test("um MP4 com vídeo e áudio AAC (moov no fim) vira ADTS com as amostras de áudio na ordem, sem os dados de vídeo", () => {
  const video = mp4ComAudio({ moovNoFim: true });
  assert.equal(detectarTipoPorConteudo(video), "video/mp4");
  const saida = extrairTrilhaAudio(video);
  assert.ok(Buffer.isBuffer(saida));
  assert.equal(MIMETYPE_TRILHA, "audio/aac");
  assert.equal(saida.length, AMOSTRAS_PADRAO.reduce((t, a) => t + a.length + 7, 0));
  conferirAdts(saida);
  assert.ok(!saida.includes(Buffer.alloc(9, 0x77)), "nenhum byte da trilha de vídeo");
});

test("o moov no início (faststart), co64, descritores com tamanho estendido e QuickTime v1 com esds dentro de wave também funcionam", () => {
  conferirAdts(extrairTrilhaAudio(mp4ComAudio({ moovNoFim: false })));
  conferirAdts(extrairTrilhaAudio(mp4ComAudio({ co64: true })));
  conferirAdts(extrairTrilhaAudio(mp4ComAudio({ estendido: true })));
  conferirAdts(extrairTrilhaAudio(mp4ComAudio({ versaoEntrada: 1, esdsEmWave: true, brand: "qt  " })));
});

test("um M4A (só áudio) e uma amostra única também são extraídos", () => {
  conferirAdts(extrairTrilhaAudio(mp4ComAudio({ comVideo: false, brand: "M4A " })));
  const uma = [Buffer.alloc(20, 0x11)];
  conferirAdts(extrairTrilhaAudio(mp4ComAudio({ amostras: uma })), uma);
});

test("HE-AAC (objeto 5) usa o perfil e a frequência do núcleo AAC-LC no ADTS", () => {
  // objeto 5, freq. 6 (24 kHz), 2 canais, freq. de extensão 3 (48 kHz), objeto 2 → 0x2B 0x11 0x88
  const quadros = lerAdts(extrairTrilhaAudio(mp4ComAudio({ asc: Buffer.from([0x2b, 0x11, 0x88]) })));
  assert.equal(quadros[0].perfil, 1);
  assert.equal(quadros[0].indiceFrequencia, 6);
  assert.equal(quadros[0].canais, 2);
});

/**
 * @param {() => unknown} fn
 * @param {string} codigo
 */
function falhaCom(fn, codigo) {
  assert.throws(fn, (erro) => erro instanceof ErroTrilhaAudio && erro.codigo === codigo);
}

test("vídeo sem trilha de áudio lança SEM_TRILHA_AUDIO", () => {
  falhaCom(() => extrairTrilhaAudio(mp4ComAudio({ comAudio: false })), "SEM_TRILHA_AUDIO");
});

test("trilha de áudio em codec que não é AAC (ex.: AMR do 3GP) lança CODEC_NAO_SUPORTADO", () => {
  falhaCom(() => extrairTrilhaAudio(mp4ComAudio({ codec: "samr", brand: "3gp4" })), "CODEC_NAO_SUPORTADO");
});

test("conteúdo que não é ISO BMFF, sem moov ou truncado lança CONTEINER_INVALIDO, nunca outro erro", () => {
  falhaCom(() => extrairTrilhaAudio(Buffer.from("OggS não é mp4")), "CONTEINER_INVALIDO");
  falhaCom(() => extrairTrilhaAudio(Buffer.alloc(0)), "CONTEINER_INVALIDO");
  const video = mp4ComAudio({ moovNoFim: true });
  falhaCom(() => extrairTrilhaAudio(video.subarray(0, video.length - 30)), "CONTEINER_INVALIDO");
  const semMoov = mp4ComAudio({ moovNoFim: true });
  semMoov.write("free", semMoov.lastIndexOf("moov"), "latin1");
  falhaCom(() => extrairTrilhaAudio(semMoov), "CONTEINER_INVALIDO");
  // offset de chunk apontando para fora do arquivo
  const foraDoArquivo = mp4ComAudio({ moovNoFim: true });
  const stco = foraDoArquivo.lastIndexOf("stco");
  foraDoArquivo.writeUInt32BE(0xfffffff0, stco + 12);
  falhaCom(() => extrairTrilhaAudio(foraDoArquivo), "CONTEINER_INVALIDO");
  // @ts-expect-error entrada que não é Buffer
  falhaCom(() => extrairTrilhaAudio("não é buffer"), "CONTEINER_INVALIDO");
});
