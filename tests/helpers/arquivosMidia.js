// @ts-check
// Buffers mínimos e fictícios de cada tipo de mídia, montados só em memória (nunca em disco): só
// os cabeçalhos que a detecção por magic bytes lê, seguidos de bytes de enchimento. Fica fora do
// padrão `*.test.js`, então o scripts/run-tests.js não o executa como teste.

/** @param {number} n */
const enchimento = (n = 32) => Buffer.alloc(n, 0x2a);

const pdf = () => Buffer.concat([Buffer.from("%PDF-1.7\n%âãÏÓ\n", "latin1"), enchimento()]);
const jpeg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.from("JFIF\0", "latin1"), enchimento()]);
const png = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), enchimento()]);
const gif = () => Buffer.concat([Buffer.from("GIF89a", "latin1"), enchimento()]);

function webp() {
  const corpo = Buffer.concat([Buffer.from("WEBPVP8 ", "latin1"), enchimento()]);
  const tamanho = Buffer.alloc(4);
  tamanho.writeUInt32LE(corpo.length);
  return Buffer.concat([Buffer.from("RIFF", "latin1"), tamanho, corpo]);
}

/**
 * Página Ogg (RFC 3533) com um único segmento.
 * @param {Buffer} conteudo
 * @param {bigint} granule
 * @param {number} tipoCabecalho
 */
function paginaOgg(conteudo, granule, tipoCabecalho) {
  const cabecalho = Buffer.alloc(27);
  cabecalho.write("OggS", 0, "latin1");
  cabecalho[4] = 0; // versão
  cabecalho[5] = tipoCabecalho;
  cabecalho.writeBigInt64LE(granule, 6);
  cabecalho.writeUInt32LE(1, 14); // serial
  cabecalho[26] = 1; // um segmento
  return Buffer.concat([cabecalho, Buffer.from([conteudo.length]), conteudo]);
}

/**
 * Ogg/Opus: página do OpusHead (pre-skip 312) e página final com o granule da duração.
 * @param {number} [segundos]
 */
function oggOpus(segundos = 5) {
  const opusHead = Buffer.alloc(19);
  opusHead.write("OpusHead", 0, "latin1");
  opusHead[8] = 1; // versão
  opusHead[9] = 1; // canais
  opusHead.writeUInt16LE(312, 10); // pre-skip
  opusHead.writeUInt32LE(48000, 12);
  const ultima = paginaOgg(enchimento(16), BigInt(segundos * 48000 + 312), 0x04);
  return Buffer.concat([paginaOgg(opusHead, 0n, 0x02), ultima]);
}

/**
 * Caixa `ftyp` do ISO BMFF (MP4, M4A, 3GP, QuickTime) com a major brand informada.
 * @param {string} [brand]
 */
function isoBmff(brand = "isom") {
  const ftyp = Buffer.alloc(24);
  ftyp.writeUInt32BE(24, 0);
  ftyp.write("ftyp", 4, "latin1");
  ftyp.write(brand, 8, "latin1");
  ftyp.write("isomiso2", 16, "latin1");
  return Buffer.concat([ftyp, enchimento()]);
}

const mp4 = () => isoBmff("isom");
const mp3 = () => Buffer.concat([Buffer.from("ID3", "latin1"), Buffer.from([0x04, 0x00, 0x00]), enchimento()]);

/**
 * ZIP mínimo (entradas vazias, armazenadas) com diretório central e EOCD, como um DOCX/XLSX.
 * @param {string[]} nomes
 */
function zip(nomes) {
  /** @type {Buffer[]} */
  const locais = [];
  /** @type {Buffer[]} */
  const centrais = [];
  let offset = 0;
  for (const nome of nomes) {
    const n = Buffer.from(nome, "latin1");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(n.length, 28);
    central.writeUInt32LE(offset, 42);
    const blocoLocal = Buffer.concat([local, n]);
    locais.push(blocoLocal);
    centrais.push(Buffer.concat([central, n]));
    offset += blocoLocal.length;
  }
  const diretorio = Buffer.concat(centrais);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(nomes.length, 8);
  eocd.writeUInt16LE(nomes.length, 10);
  eocd.writeUInt32LE(diretorio.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locais, diretorio, eocd]);
}

const docx = () => zip(["[Content_Types].xml", "_rels/.rels", "word/document.xml"]);
const xlsx = () => zip(["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml"]);
const zipComum = () => zip(["leia-me.txt", "fotos/foto.jpg"]);

const CABECALHO_OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
/** @param {string} stream nome do stream principal (UTF-16LE no diretório OLE) */
const ole = (stream) => Buffer.concat([Buffer.from(CABECALHO_OLE), enchimento(64), Buffer.from(stream, "utf16le"), enchimento()]);
const doc = () => ole("WordDocument");
const xls = () => ole("Workbook");

const MIME_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MIME_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

module.exports = {
  pdf,
  jpeg,
  png,
  gif,
  webp,
  oggOpus,
  isoBmff,
  mp4,
  mp3,
  zip,
  docx,
  xlsx,
  zipComum,
  doc,
  xls,
  MIME_DOCX,
  MIME_XLSX,
};
