// @ts-check
// Bordas do reconhecimento por conteúdo: MP3 sem ID3, AAC, AMR, brands ISO BMFF, ZIP/OLE adulterados
// ou ambíguos e Ogg truncado. Tudo em buffers de memória.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { detectarTipoPorConteudo, validarMidia, duracaoOggOpusSegundos, normalizarMimetype } = require("../../src/whatsapp/tipoMidia");
const arquivos = require("../helpers/arquivosMidia");

const TETO = 1024 * 1024;
const cauda = Buffer.alloc(32, 0x2a);
/** @param {number[]} bytes */
const com = (bytes) => Buffer.concat([Buffer.from(bytes), cauda]);

test("MP3 sem ID3 só vale com quadro MPEG válido: versão reservada, bitrate inválido e sem sync não são MP3 (layer 00 cai no ADTS)", () => {
  assert.equal(detectarTipoPorConteudo(com([0xff, 0xfb, 0x90])), "audio/mpeg");
  assert.deepEqual(validarMidia(com([0xff, 0xfb, 0x90]), "audio/mp3", TETO), { ok: true, mimetype: "audio/mpeg", tamanho_bytes: 35 });
  assert.equal(detectarTipoPorConteudo(com([0xff, 0xf9, 0x90])), "audio/aac", "layer 00 não é MP3: cai no ADTS");
  assert.equal(detectarTipoPorConteudo(com([0xff, 0xe9, 0x90])), null, "versão reservada");
  assert.equal(detectarTipoPorConteudo(com([0xff, 0xfb, 0xf0])), null, "bitrate inválido");
  assert.equal(detectarTipoPorConteudo(com([0xff, 0x7b, 0x90])), null, "sem sync de 11 bits");
  assert.equal(detectarTipoPorConteudo(Buffer.from([0xff, 0xfb])), null, "curto demais para um quadro");
});

test("AAC em ADTS e AMR são reconhecidos, e declarar outro tipo é divergência", () => {
  const aac = com([0xff, 0xf1, 0x50, 0x80]);
  assert.equal(detectarTipoPorConteudo(aac), "audio/aac");
  assert.equal(validarMidia(aac, "audio/aacp", TETO).ok, true);
  assert.deepEqual(validarMidia(aac, "audio/mpeg", TETO), { ok: false, motivo: "TIPO_DIVERGENTE" });

  const amr = Buffer.concat([Buffer.from("#!AMR\n", "latin1"), cauda]);
  assert.equal(detectarTipoPorConteudo(amr), "audio/amr");
});

test("brands do ISO BMFF: M4A, 3GPP e QuickTime são reconhecidos; HEIC e caixa curta não", () => {
  assert.equal(detectarTipoPorConteudo(arquivos.isoBmff("M4A ")), "audio/mp4");
  assert.equal(detectarTipoPorConteudo(arquivos.isoBmff("3gp4")), "video/3gpp");
  assert.equal(detectarTipoPorConteudo(arquivos.isoBmff("qt  ")), "video/quicktime");
  assert.equal(detectarTipoPorConteudo(arquivos.isoBmff("heic")), null, "HEIC é imagem não aceita, não vídeo");
  const curto = Buffer.alloc(11);
  curto.write("ftyp", 4, "latin1");
  assert.equal(detectarTipoPorConteudo(curto), null);
});

test("MP4 genérico declarado como áudio (m4a) sai como audio/mp4; declarado como imagem é divergente", () => {
  const mp4 = arquivos.mp4();
  assert.deepEqual(validarMidia(mp4, "audio/x-m4a", TETO), { ok: true, mimetype: "audio/mp4", tamanho_bytes: mp4.length });
  assert.deepEqual(validarMidia(mp4, "image/png", TETO), { ok: false, motivo: "TIPO_DIVERGENTE" });
  assert.equal(validarMidia(arquivos.isoBmff("3gp4"), "audio/3gpp", TETO).ok, true);
});

test("ZIP que mistura word/ e xl/ é ambíguo e recusado; sem [Content_Types].xml também", () => {
  const ambiguo = arquivos.zip(["[Content_Types].xml", "word/document.xml", "xl/workbook.xml"]);
  assert.equal(detectarTipoPorConteudo(ambiguo), null);
  const semTipos = arquivos.zip(["_rels/.rels", "word/document.xml"]);
  assert.equal(detectarTipoPorConteudo(semTipos), null);
  const soContentTypes = arquivos.zip(["[Content_Types].xml"]);
  assert.equal(detectarTipoPorConteudo(soContentTypes), null);
  assert.deepEqual(validarMidia(ambiguo, arquivos.MIME_DOCX, TETO), { ok: false, motivo: "TIPO_NAO_RECONHECIDO" });
});

test("ZIP adulterado (EOCD ausente, ZIP64, total 0 ou excessivo, diretório fora do lugar, entrada truncada) é recusado", () => {
  const valido = arquivos.docx();
  assert.equal(detectarTipoPorConteudo(valido), arquivos.MIME_DOCX);
  const eocd = valido.length - 22;
  /** @param {(b: Buffer) => void} alterar */
  const adulterar = (alterar) => {
    const copia = Buffer.from(valido);
    alterar(copia);
    return detectarTipoPorConteudo(copia);
  };

  assert.equal(detectarTipoPorConteudo(Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), cauda])), null, "sem EOCD");
  assert.equal(detectarTipoPorConteudo(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0])), null, "menor que um EOCD");
  assert.equal(adulterar((b) => b.writeUInt16LE(0xffff, eocd + 10)), null, "ZIP64 no total");
  assert.equal(adulterar((b) => b.writeUInt32LE(0xffffffff, eocd + 12)), null, "ZIP64 no tamanho");
  assert.equal(adulterar((b) => b.writeUInt32LE(0xffffffff, eocd + 16)), null, "ZIP64 no offset");
  assert.equal(adulterar((b) => b.writeUInt16LE(0, eocd + 10)), null, "total 0");
  assert.equal(adulterar((b) => b.writeUInt16LE(10001, eocd + 10)), null, "total acima do teto de entradas");
  assert.equal(adulterar((b) => b.writeUInt32LE(b.length, eocd + 16)), null, "diretório além do EOCD");
  assert.equal(adulterar((b) => b.writeUInt32LE(0, eocd + 16)), null, "offset apontando para fora do diretório central");
  assert.equal(adulterar((b) => b.writeUInt16LE(4, eocd + 10)), null, "total maior que as entradas existentes");
});

test("entrada do diretório central com nome que passa do fim é recusada", () => {
  const valido = arquivos.docx();
  const eocd = valido.length - 22;
  const inicioDiretorio = valido.readUInt32LE(eocd + 16);
  const copia = Buffer.from(valido);
  copia.writeUInt16LE(0xfff0, inicioDiretorio + 28); // tamanho do nome absurdo na 1ª entrada
  assert.equal(detectarTipoPorConteudo(copia), null);
});

test("OLE com Word e Workbook juntos é ambíguo; sem stream conhecido não é reconhecido; Book vale como XLS", () => {
  const ambiguo = Buffer.concat([arquivos.ole("WordDocument"), Buffer.from("Workbook", "utf16le")]);
  assert.equal(detectarTipoPorConteudo(ambiguo), null);
  assert.equal(detectarTipoPorConteudo(arquivos.ole("Outro")), null);
  assert.equal(detectarTipoPorConteudo(arquivos.ole("Book")), "application/vnd.ms-excel");
});

test("validarMidia: não-Buffer é vazio, exatamente no teto passa e um byte acima não; declarado nulo vale o detectado", () => {
  // @ts-expect-error entrada inválida de propósito
  assert.deepEqual(validarMidia("texto", "image/png", TETO), { ok: false, motivo: "MIDIA_VAZIA" });
  const png = arquivos.png();
  assert.equal(validarMidia(png, "image/png", png.length).ok, true);
  assert.deepEqual(validarMidia(png, "image/png", png.length - 1), { ok: false, motivo: "ACIMA_DO_TETO" });
  assert.equal(validarMidia(png, null, TETO).ok, true);
  assert.equal(validarMidia(png, undefined, TETO).ok, true);
  assert.equal(detectarTipoPorConteudo(Buffer.alloc(0)), null);
});

test("normalizarMimetype: minúsculo, sem parâmetros; nulo, indefinido e não-texto viram vazio", () => {
  assert.equal(normalizarMimetype("Audio/OGG; codecs=opus"), "audio/ogg");
  assert.equal(normalizarMimetype(null), "");
  assert.equal(normalizarMimetype(undefined), "");
  // @ts-expect-error tipo inválido de propósito
  assert.equal(normalizarMimetype(42), "");
});

test("duração do Ogg/Opus é nula para outros tipos, página final truncada, versão inválida e granule menor que o pre-skip", () => {
  assert.equal(duracaoOggOpusSegundos(arquivos.png()), null);
  assert.equal(duracaoOggOpusSegundos(Buffer.alloc(0)), null);

  const ogg = arquivos.oggOpus(5);
  assert.equal(duracaoOggOpusSegundos(ogg), 5);

  const ultima = ogg.lastIndexOf("OggS");
  assert.equal(duracaoOggOpusSegundos(ogg.subarray(0, ultima + 10)), null, "cabeçalho da última página incompleto");

  const versaoInvalida = Buffer.from(ogg);
  versaoInvalida[ultima + 4] = 1;
  assert.equal(duracaoOggOpusSegundos(versaoInvalida), null);

  const antesDoPreSkip = Buffer.from(ogg);
  antesDoPreSkip.writeBigInt64LE(100n, ultima + 6); // 100 < pre-skip 312
  assert.equal(duracaoOggOpusSegundos(antesDoPreSkip), null);

  const curto = Buffer.alloc(38);
  curto.write("OggS", 0, "latin1");
  curto.write("OpusHead", 28, "latin1");
  assert.equal(duracaoOggOpusSegundos(curto), null, "menor que 40 bytes");
});
