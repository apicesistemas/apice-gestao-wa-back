// @ts-check
// Tipo da mídia pelo conteúdo (magic bytes) e validação contra o tipo declarado e o teto.
// Os arquivos são buffers fictícios em memória (tests/helpers/arquivosMidia.js), nunca em disco.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { detectarTipoPorConteudo, validarMidia, duracaoOggOpusSegundos } = require("../../src/whatsapp/tipoMidia");
const arquivos = require("../helpers/arquivosMidia");

const TETO = 16 * 1024 * 1024;

test("PDF, JPEG, PNG, WebP, OGG/Opus e MP4 válidos são aceitos com o mimetype detectado", () => {
  /** @type {[Buffer, string, string][]} conteúdo, declarado pelo WhatsApp, detectado */
  const casos = [
    [arquivos.pdf(), "application/pdf", "application/pdf"],
    [arquivos.jpeg(), "image/jpeg", "image/jpeg"],
    [arquivos.png(), "image/png", "image/png"],
    [arquivos.webp(), "image/webp", "image/webp"],
    [arquivos.oggOpus(), "audio/ogg; codecs=opus", "audio/ogg"],
    [arquivos.mp4(), "video/mp4", "video/mp4"],
  ];
  for (const [buffer, declarado, detectado] of casos) {
    assert.equal(detectarTipoPorConteudo(buffer), detectado, `detecção de ${detectado}`);
    assert.deepEqual(validarMidia(buffer, declarado, TETO), { ok: true, mimetype: detectado, tamanho_bytes: buffer.length }, declarado);
  }
});

test("documentos Office (DOCX, XLSX, DOC, XLS), MP3, GIF e figurinha WebP também são reconhecidos", () => {
  /** @type {[Buffer, string][]} */
  const casos = [
    [arquivos.docx(), arquivos.MIME_DOCX],
    [arquivos.xlsx(), arquivos.MIME_XLSX],
    [arquivos.doc(), "application/msword"],
    [arquivos.xls(), "application/vnd.ms-excel"],
    [arquivos.mp3(), "audio/mpeg"],
    [arquivos.gif(), "image/gif"],
    [arquivos.isoBmff("M4A "), "audio/mp4"],
    [arquivos.isoBmff("3gp4"), "video/3gpp"],
    [arquivos.isoBmff("qt  "), "video/quicktime"],
  ];
  for (const [buffer, mime] of casos) {
    assert.equal(detectarTipoPorConteudo(buffer), mime);
    assert.equal(validarMidia(buffer, mime, TETO).ok, true, mime);
  }
});

test("um conteúdo que não bate com o tipo declarado é recusado", () => {
  assert.deepEqual(validarMidia(arquivos.pdf(), "image/jpeg", TETO), { ok: false, motivo: "TIPO_DIVERGENTE" });
  assert.deepEqual(validarMidia(arquivos.jpeg(), "application/pdf", TETO), { ok: false, motivo: "TIPO_DIVERGENTE" });
  assert.deepEqual(validarMidia(arquivos.mp4(), "audio/ogg", TETO), { ok: false, motivo: "TIPO_DIVERGENTE" });
  assert.deepEqual(validarMidia(arquivos.zipComum(), arquivos.MIME_DOCX, TETO), { ok: false, motivo: "TIPO_NAO_RECONHECIDO" });
  assert.deepEqual(validarMidia(arquivos.docx(), arquivos.MIME_XLSX, TETO), { ok: false, motivo: "TIPO_DIVERGENTE" });
});

test("conteúdo sem assinatura conhecida é recusado como não reconhecido, mesmo com tipo declarado aceito", () => {
  const executavel = Buffer.concat([Buffer.from("MZ", "latin1"), Buffer.alloc(64)]);
  assert.equal(detectarTipoPorConteudo(executavel), null);
  assert.deepEqual(validarMidia(executavel, "application/pdf", TETO), { ok: false, motivo: "TIPO_NAO_RECONHECIDO" });
  assert.deepEqual(validarMidia(Buffer.from("só texto"), "text/plain", TETO), { ok: false, motivo: "TIPO_NAO_RECONHECIDO" });
  // "ftyp" de imagem HEIC não vale como vídeo
  assert.equal(detectarTipoPorConteudo(arquivos.isoBmff("heic")), null);
  // RIFF que não é WEBP (ex.: WAV/AVI)
  assert.equal(detectarTipoPorConteudo(Buffer.concat([Buffer.from("RIFF\0\0\0\0WAVE", "latin1"), Buffer.alloc(16)])), null);
});

test("um arquivo acima do teto é recusado, e um buffer vazio também", () => {
  const buffer = arquivos.pdf();
  assert.deepEqual(validarMidia(buffer, "application/pdf", buffer.length - 1), { ok: false, motivo: "ACIMA_DO_TETO" });
  assert.equal(validarMidia(buffer, "application/pdf", buffer.length).ok, true);
  assert.deepEqual(validarMidia(Buffer.alloc(0), "application/pdf", TETO), { ok: false, motivo: "MIDIA_VAZIA" });
});

test("tipo declarado ausente ou genérico (octet-stream) aceita o tipo detectado; aliases e parâmetros são normalizados", () => {
  assert.deepEqual(validarMidia(arquivos.pdf(), null, TETO), { ok: true, mimetype: "application/pdf", tamanho_bytes: arquivos.pdf().length });
  assert.equal(validarMidia(arquivos.docx(), "application/octet-stream", TETO).ok, true);
  assert.equal(validarMidia(arquivos.jpeg(), "IMAGE/JPG", TETO).ok, true);
  // MP4 genérico declarado como áudio (m4a) é o mesmo contêiner: aceito como audio/mp4
  assert.deepEqual(validarMidia(arquivos.mp4(), "audio/mp4", TETO), { ok: true, mimetype: "audio/mp4", tamanho_bytes: arquivos.mp4().length });
});

test("duração real do OGG/Opus vem do granule da última página, não do declarado", () => {
  assert.equal(duracaoOggOpusSegundos(arquivos.oggOpus(7)), 7);
  assert.equal(duracaoOggOpusSegundos(arquivos.pdf()), null);
});
