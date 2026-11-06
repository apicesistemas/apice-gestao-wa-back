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

test("imagem raster (JPEG, PNG, WebP) declarada como outra da família vale pelo tipo detectado", () => {
  // O WhatsApp declara image/jpeg em toda imageMessage, mas capturas de tela chegam em PNG.
  /** @type {[Buffer, string, string][]} conteúdo, declarado, detectado */
  const casos = [
    [arquivos.png(), "image/jpeg", "image/png"],
    [arquivos.png(), "IMAGE/PJPEG; q=1", "image/png"],
    [arquivos.jpeg(), "image/png", "image/jpeg"],
    [arquivos.webp(), "image/jpeg", "image/webp"],
    [arquivos.webp(), "image/jpg", "image/webp"],
  ];
  for (const [buffer, declarado, detectado] of casos) {
    assert.deepEqual(validarMidia(buffer, declarado, TETO), { ok: true, mimetype: detectado, tamanho_bytes: buffer.length }, `${declarado} → ${detectado}`);
  }
});

test("fora da família raster a divergência continua recusada (GIF, PDF, PNG como PDF)", () => {
  assert.deepEqual(validarMidia(arquivos.gif(), "image/jpeg", TETO), { ok: false, motivo: "TIPO_DIVERGENTE" });
  assert.deepEqual(validarMidia(arquivos.png(), "image/gif", TETO), { ok: false, motivo: "TIPO_DIVERGENTE" });
  assert.deepEqual(validarMidia(arquivos.png(), "application/pdf", TETO), { ok: false, motivo: "TIPO_DIVERGENTE" });
  assert.deepEqual(validarMidia(arquivos.pdf(), "image/jpeg", TETO), { ok: false, motivo: "TIPO_DIVERGENTE" });
  assert.deepEqual(validarMidia(arquivos.pfx(), "image/jpeg", TETO), { ok: false, motivo: "TIPO_DIVERGENTE" });
  assert.deepEqual(validarMidia(arquivos.pfx(), "image/png", TETO), { ok: false, motivo: "TIPO_DIVERGENTE" });
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

test("PKCS#12 (PFX) é detectado pelo conteúdo, com comprimento DER longo, curto ou BER indefinido", () => {
  for (const buffer of [arquivos.pfx(), arquivos.pfxCurto(), arquivos.pfxBer()]) {
    assert.equal(detectarTipoPorConteudo(buffer), "application/x-pkcs12");
  }
});

test("PKCS#12 é aceito com o declarado canônico, o alternativo e os genéricos, e recusado com o de outro tipo", () => {
  const buffer = arquivos.pfx();
  for (const declarado of ["application/x-pkcs12", "application/pkcs12", "application/octet-stream", "binary/octet-stream", ""]) {
    assert.deepEqual(validarMidia(buffer, declarado, TETO), { ok: true, mimetype: "application/x-pkcs12", tamanho_bytes: buffer.length }, declarado);
  }
  assert.deepEqual(validarMidia(buffer, "application/pdf", TETO), { ok: false, motivo: "TIPO_DIVERGENTE" });
});

test("certificado X.509 DER (.cer) e ASN.1 que não é PKCS#12 continuam recusados", () => {
  assert.equal(detectarTipoPorConteudo(arquivos.x509()), null);
  assert.deepEqual(validarMidia(arquivos.x509(), "application/x-pkcs12", TETO), { ok: false, motivo: "TIPO_NAO_RECONHECIDO" });
  const semOid = Buffer.from([0x30, 0x82, 0x01, 0x00, 0x02, 0x01, 0x03, 0x30, 0x82, 0x00, 0xf0, ...Array(80).fill(0x2a)]);
  assert.equal(detectarTipoPorConteudo(semOid), null, "versão 3 sem o OID PKCS#7");
  assert.equal(detectarTipoPorConteudo(Buffer.from([0x30, 0x85, 0x02, 0x01, 0x03, 0x30])), null, "comprimento longo além de 4 bytes");
  assert.equal(detectarTipoPorConteudo(Buffer.from([0x30, 0x82, 0x01])), null, "truncado");
  assert.equal(detectarTipoPorConteudo(Buffer.from([0x30])), null, "só o byte inicial");
});

test("PKCS#12: a janela do OID é [p+3, p+67), igual à do back (último offset aceito p+57, primeiro fora p+58)", () => {
  const OID = [0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07];
  const p = 2; // comprimento curto: `30 LL` e o INTEGER versão 3 começa no byte 2
  /** @param {number} offsetOid offset absoluto onde o OID começa */
  const comOidEm = (offsetOid) => {
    const b = Buffer.alloc(p + 3 + 64 + 16, 0x2a);
    b.set([0x30, 0x7a, 0x02, 0x01, 0x03, 0x30], 0);
    b.set(OID, offsetOid);
    return b;
  };
  assert.equal(detectarTipoPorConteudo(comOidEm(p + 57)), "application/x-pkcs12", "OID terminando na última posição da janela");
  assert.equal(detectarTipoPorConteudo(comOidEm(p + 58)), null, "OID que ultrapassa a janela em 1 byte");
  assert.equal(detectarTipoPorConteudo(comOidEm(p + 4)), "application/x-pkcs12", "OID logo depois do `30` do ContentInfo");
});

// ---- DOCUMENTO genérico na entrada (opt-in `documentoGenerico`): qualquer arquivo é aceito ----

const GENERICO = { documentoGenerico: true };
const OCTET = "application/octet-stream";

test("documentoGenerico: XML, TXT e ZIP comum viram application/octet-stream, e o tamanho é o real", () => {
  const xml = Buffer.from('<?xml version="1.0" encoding="UTF-8"?><nfeProc></nfeProc>');
  assert.deepEqual(validarMidia(xml, "text/xml", TETO, GENERICO), { ok: true, mimetype: OCTET, tamanho_bytes: xml.length });
  assert.deepEqual(validarMidia(xml, "", TETO, GENERICO), { ok: true, mimetype: OCTET, tamanho_bytes: xml.length });
  const txt = Buffer.from("só texto");
  assert.deepEqual(validarMidia(txt, "text/plain", TETO, GENERICO), { ok: true, mimetype: OCTET, tamanho_bytes: txt.length });
  const zip = arquivos.zipComum();
  assert.deepEqual(validarMidia(zip, "application/zip", TETO, GENERICO), { ok: true, mimetype: OCTET, tamanho_bytes: zip.length });
});

test("documentoGenerico: conteúdo reconhecido e compatível mantém o mimetype detectado", () => {
  const pdf = arquivos.pdf();
  assert.deepEqual(validarMidia(pdf, "application/pdf", TETO, GENERICO), { ok: true, mimetype: "application/pdf", tamanho_bytes: pdf.length });
  const docx = arquivos.docx();
  assert.equal(validarMidia(docx, arquivos.MIME_DOCX, TETO, GENERICO).ok && /** @type {any} */ (validarMidia(docx, arquivos.MIME_DOCX, TETO, GENERICO)).mimetype, arquivos.MIME_DOCX);
});

test("documentoGenerico: tipo divergente (DOCX declarado como application/zip, JPEG como PDF) é aceito como octet-stream", () => {
  const docx = arquivos.docx();
  assert.deepEqual(validarMidia(docx, "application/zip", TETO, GENERICO), { ok: true, mimetype: OCTET, tamanho_bytes: docx.length });
  const jpeg = arquivos.jpeg();
  assert.deepEqual(validarMidia(jpeg, "application/pdf", TETO, GENERICO), { ok: true, mimetype: OCTET, tamanho_bytes: jpeg.length });
});

test("documentoGenerico: mídia vazia e acima do teto continuam recusadas", () => {
  assert.deepEqual(validarMidia(Buffer.alloc(0), "text/xml", TETO, GENERICO), { ok: false, motivo: "MIDIA_VAZIA" });
  assert.deepEqual(validarMidia(Buffer.from("<a/>"), "text/xml", 2, GENERICO), { ok: false, motivo: "ACIMA_DO_TETO" });
});

test("sem a opção (envio e demais tipos) o conteúdo desconhecido segue recusado", () => {
  const xml = Buffer.from('<?xml version="1.0"?><a/>');
  assert.deepEqual(validarMidia(xml, "text/xml", TETO), { ok: false, motivo: "TIPO_NAO_RECONHECIDO" });
  assert.deepEqual(validarMidia(xml, "text/xml", TETO, { documentoGenerico: false }), { ok: false, motivo: "TIPO_NAO_RECONHECIDO" });
  assert.deepEqual(validarMidia(arquivos.docx(), "application/zip", TETO, {}), { ok: false, motivo: "TIPO_DIVERGENTE" });
});

// ---- OpenDocument (ODT, ODS, ODP): ZIP com a entrada `mimetype` armazenada logo no início ----

test("ODT, ODS e ODP são reconhecidos pelo conteúdo com o mimetype próprio e aceitam o declarado correto ou genérico", () => {
  /** @type {[Buffer, string][]} */
  const casos = [
    [arquivos.odt(), arquivos.MIME_ODT],
    [arquivos.ods(), arquivos.MIME_ODS],
    [arquivos.odp(), arquivos.MIME_ODP],
  ];
  for (const [buffer, mime] of casos) {
    assert.equal(detectarTipoPorConteudo(buffer), mime);
    assert.deepEqual(validarMidia(buffer, mime, TETO), { ok: true, mimetype: mime, tamanho_bytes: buffer.length });
    assert.deepEqual(validarMidia(buffer, "application/octet-stream", TETO), { ok: true, mimetype: mime, tamanho_bytes: buffer.length });
    assert.deepEqual(validarMidia(buffer, "application/zip", TETO), { ok: false, motivo: "TIPO_DIVERGENTE" });
  }
  assert.deepEqual(validarMidia(arquivos.odt(), arquivos.MIME_ODS, TETO), { ok: false, motivo: "TIPO_DIVERGENTE" });
});

test("ZIP sem a entrada mimetype, mimetype de outro formato ou de modelo (ott) continuam não reconhecidos", () => {
  assert.equal(detectarTipoPorConteudo(arquivos.zipComum()), null);
  assert.equal(detectarTipoPorConteudo(arquivos.odf("application/vnd.oasis.opendocument.graphics")), null);
  assert.equal(detectarTipoPorConteudo(arquivos.odf("application/vnd.oasis.opendocument.text-template")), null);
  // "mimetype" no byte 30, mas sem o mime logo depois
  assert.equal(detectarTipoPorConteudo(arquivos.zip(["mimetype", "x.txt"], { mimetype: Buffer.from("text/plain") })), null);
});

test("documentoGenerico: ODT declarado como octet-stream ou com o mime próprio sai com o mime próprio", () => {
  const odt = arquivos.odt();
  assert.deepEqual(validarMidia(odt, "application/octet-stream", TETO, GENERICO), { ok: true, mimetype: arquivos.MIME_ODT, tamanho_bytes: odt.length });
  assert.deepEqual(validarMidia(odt, arquivos.MIME_ODT, TETO, GENERICO), { ok: true, mimetype: arquivos.MIME_ODT, tamanho_bytes: odt.length });
});

// ---- ODF: vetores de borda do algoritmo único (os mesmos da suíte do back) ----

test("ODF (a) padrão com tamanho e próxima entrada, (b) tamanho 0 + próxima entrada, (c) bit 3 com tamanho e sem próxima entrada, descritor depois do mime: ODT", () => {
  const { odfBruto, PROXIMA_ENTRADA, PROXIMO_DESCRITOR, MIME_ODT } = arquivos;
  assert.equal(detectarTipoPorConteudo(odfBruto(MIME_ODT, { proxima: PROXIMA_ENTRADA })), MIME_ODT, "(a)");
  assert.equal(detectarTipoPorConteudo(odfBruto(MIME_ODT, { tamanho: 0, proxima: PROXIMA_ENTRADA })), MIME_ODT, "(b)");
  assert.equal(detectarTipoPorConteudo(odfBruto(MIME_ODT, { flags: 0x08 })), MIME_ODT, "(c)");
  assert.equal(detectarTipoPorConteudo(odfBruto(MIME_ODT, { flags: 0x08, tamanho: 0, proxima: PROXIMO_DESCRITOR })), MIME_ODT, "descritor de dados PK\x07\x08");
});

test("ODF (d) método 8, (e) extra ≠ 0, (f) text-template, tamanho 0 sem próxima entrada, nome ≠ 8: não reconhecido", () => {
  const { odfBruto, PROXIMA_ENTRADA, MIME_ODT } = arquivos;
  assert.equal(detectarTipoPorConteudo(odfBruto(MIME_ODT, { metodo: 8, proxima: PROXIMA_ENTRADA })), null, "(d)");
  assert.equal(detectarTipoPorConteudo(odfBruto(MIME_ODT, { extra: 4, proxima: PROXIMA_ENTRADA })), null, "(e)");
  const modelo = "application/vnd.oasis.opendocument.text-template";
  assert.equal(detectarTipoPorConteudo(odfBruto(modelo, { proxima: PROXIMA_ENTRADA })), null, "(f) tamanho do modelo");
  assert.equal(detectarTipoPorConteudo(odfBruto(modelo, { tamanho: 0, proxima: PROXIMA_ENTRADA })), null, "(f) tamanho 0");
  assert.equal(detectarTipoPorConteudo(odfBruto(MIME_ODT, { tamanho: 0 })), null, "tamanho 0 e nada depois");
  assert.equal(detectarTipoPorConteudo(odfBruto(MIME_ODT).subarray(0, 40)), null, "truncado no meio do mime");
  const nomeOutro = odfBruto(MIME_ODT, { proxima: PROXIMA_ENTRADA });
  nomeOutro.writeUInt16LE(7, 26);
  assert.equal(detectarTipoPorConteudo(nomeOutro), null, "tamanho do nome ≠ 8");
});

test("ODF (g) ZIP sem mimetype e (h) ODS e ODP: os mimes próprios", () => {
  const { odfBruto, PROXIMA_ENTRADA, MIME_ODS, MIME_ODP } = arquivos;
  assert.equal(detectarTipoPorConteudo(arquivos.zipComum()), null, "(g)");
  assert.equal(detectarTipoPorConteudo(odfBruto(MIME_ODS, { proxima: PROXIMA_ENTRADA })), MIME_ODS, "(h) ods");
  assert.equal(detectarTipoPorConteudo(odfBruto(MIME_ODP, { tamanho: 0, proxima: PROXIMA_ENTRADA })), MIME_ODP, "(h) odp");
});
