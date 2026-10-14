// @ts-check
// MP4 (ISO BMFF) mínimo e fictício, montado só em memória: ftyp + mdat + moov, com uma trilha de
// vídeo (`vide`, ignorada) e uma de áudio (`soun`, AAC em `mp4a`/`esds`). As amostras de áudio
// ficam em dois chunks intercalados com dados de vídeo, para exercitar `stsc`/`stco`. Fica fora
// do padrão `*.test.js`, então o scripts/run-tests.js não o executa como teste.

/** @param {number} n */
const u32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0);
  return b;
};
/** @param {number} n */
const u16 = (n) => {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(n);
  return b;
};
/** @param {bigint} n */
const u64 = (n) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(n);
  return b;
};

/**
 * @param {string} tipo
 * @param {Buffer[]} partes
 */
function caixa(tipo, ...partes) {
  const corpo = Buffer.concat(partes);
  return Buffer.concat([u32(8 + corpo.length), Buffer.from(tipo, "latin1"), corpo]);
}

/**
 * Caixa "full" (versão + flags).
 * @param {string} tipo
 * @param {number} versao
 * @param {Buffer[]} partes
 */
const caixaCheia = (tipo, versao, ...partes) => caixa(tipo, Buffer.from([versao, 0, 0, 0]), ...partes);

/**
 * Descritor MPEG-4 (tag + tamanho em 1 byte, ou em 4 bytes no formato estendido 0x80 0x80 0x80 n).
 * @param {number} tag
 * @param {Buffer} corpo
 * @param {boolean} estendido
 */
function descritor(tag, corpo, estendido) {
  const tamanho = estendido ? Buffer.from([0x80, 0x80, 0x80, corpo.length]) : Buffer.from([corpo.length]);
  return Buffer.concat([Buffer.from([tag]), tamanho, corpo]);
}

/**
 * @param {Buffer} asc AudioSpecificConfig
 * @param {boolean} estendido
 */
function esds(asc, estendido) {
  const decoderConfig = descritor(
    0x04,
    Buffer.concat([Buffer.from([0x40, 0x15]), Buffer.from([0, 0x18, 0]), u32(128000), u32(128000), descritor(0x05, asc, estendido)]),
    estendido
  );
  const es = descritor(0x03, Buffer.concat([u16(1), Buffer.from([0]), decoderConfig, descritor(0x06, Buffer.from([0x02]), estendido)]), estendido);
  return caixaCheia("esds", 0, es);
}

/**
 * Sample entry de áudio (`mp4a`, ou outro codec), na versão 0 (ISO) ou 1 (QuickTime, +16 bytes).
 * @param {{ codec: string, versaoEntrada: number, asc: Buffer, esdsEmWave: boolean, estendido: boolean }} o
 */
function entradaAudio({ codec, versaoEntrada, asc, esdsEmWave, estendido }) {
  const cabecalho = Buffer.concat([
    Buffer.alloc(6), // reservado
    u16(1), // data_reference_index
    u16(versaoEntrada),
    u16(0), // revisão
    u32(0), // fornecedor
    u16(2), // canais
    u16(16), // bits por amostra
    u16(0),
    u16(0),
    u32(44100 * 65536), // taxa 16.16
    versaoEntrada === 1 ? Buffer.alloc(16) : Buffer.alloc(0),
  ]);
  const filhoEsds = esds(asc, estendido);
  return caixa(codec, cabecalho, esdsEmWave ? caixa("wave", caixa("frma", Buffer.from("mp4a", "latin1")), filhoEsds) : filhoEsds);
}

/**
 * @param {string} handler
 * @param {Buffer} entradaStsd
 * @param {Buffer[]} amostras
 * @param {number[][]} chunks índices das amostras de cada chunk
 * @param {number[]} offsets offset absoluto de cada chunk
 * @param {boolean} co64
 */
function trak(handler, entradaStsd, amostras, chunks, offsets, co64) {
  const stsd = caixaCheia("stsd", 0, u32(1), entradaStsd);
  const stts = caixaCheia("stts", 0, u32(1), u32(amostras.length), u32(1024));
  // stsc em "runs": cada mudança de amostras por chunk abre uma entrada
  /** @type {Buffer[]} */
  const entradasStsc = [];
  chunks.forEach((c, i) => {
    if (i === 0 || chunks[i - 1].length !== c.length) entradasStsc.push(Buffer.concat([u32(i + 1), u32(c.length), u32(1)]));
  });
  const stsc = caixaCheia("stsc", 0, u32(entradasStsc.length), ...entradasStsc);
  const stsz = caixaCheia("stsz", 0, u32(0), u32(amostras.length), ...amostras.map((a) => u32(a.length)));
  const stco = co64 ? caixaCheia("co64", 0, u32(offsets.length), ...offsets.map((o) => u64(BigInt(o)))) : caixaCheia("stco", 0, u32(offsets.length), ...offsets.map(u32));
  const stbl = caixa("stbl", stsd, stts, stsc, stsz, stco);
  const mdhd = caixaCheia("mdhd", 0, u32(0), u32(0), u32(44100), u32(amostras.length * 1024), u16(0x55c4), u16(0));
  const hdlr = caixaCheia("hdlr", 0, u32(0), Buffer.from(handler, "latin1"), Buffer.alloc(12), Buffer.from("\0", "latin1"));
  return caixa("trak", caixa("mdia", mdhd, hdlr, caixa("minf", stbl)));
}

/** AudioSpecificConfig AAC-LC, 44,1 kHz (índice 4), estéreo: 00010 0100 0010 000 → 0x12 0x10. */
const ASC_AAC_LC = Buffer.from([0x12, 0x10]);

/** Amostras de áudio padrão (bytes arbitrários, tamanhos diferentes). */
const AMOSTRAS_PADRAO = [Buffer.alloc(10, 0xa1), Buffer.alloc(7, 0xb2), Buffer.alloc(12, 0xc3)];

/**
 * @param {{
 *   amostras?: Buffer[],
 *   moovNoFim?: boolean,
 *   comAudio?: boolean,
 *   comVideo?: boolean,
 *   codec?: string,
 *   versaoEntrada?: number,
 *   esdsEmWave?: boolean,
 *   estendido?: boolean,
 *   co64?: boolean,
 *   asc?: Buffer,
 *   brand?: string,
 * }} [opcoes]
 * @returns {Buffer}
 */
function mp4ComAudio({
  amostras = AMOSTRAS_PADRAO,
  moovNoFim = true,
  comAudio = true,
  comVideo = true,
  codec = "mp4a",
  versaoEntrada = 0,
  esdsEmWave = false,
  estendido = false,
  co64 = false,
  asc = ASC_AAC_LC,
  brand = "isom",
} = {}) {
  const ftyp = caixa("ftyp", Buffer.from(brand, "latin1"), u32(0), Buffer.from("isomiso2", "latin1"));
  const dadosVideo = Buffer.alloc(9, 0x77);
  // Layout do mdat: [chunk de áudio 1: amostras 0..n-2] [vídeo] [chunk de áudio 2: última amostra]
  const chunks = amostras.length > 1 ? [amostras.slice(0, -1).map((_, i) => i), [amostras.length - 1]] : [[0]];
  const conteudoChunk = chunks.map((c) => Buffer.concat(c.map((i) => amostras[i])));
  const corpoMdat = Buffer.concat([conteudoChunk[0], dadosVideo, ...conteudoChunk.slice(1)]);

  /** @param {number} inicioMdatCorpo */
  const montarMoov = (inicioMdatCorpo) => {
    const offsets = [inicioMdatCorpo, ...(conteudoChunk.length > 1 ? [inicioMdatCorpo + conteudoChunk[0].length + dadosVideo.length] : [])];
    const traks = [];
    if (comVideo) traks.push(trak("vide", caixa("avc1", Buffer.alloc(78)), [dadosVideo], [[0]], [inicioMdatCorpo + conteudoChunk[0].length], false));
    if (comAudio) traks.push(trak("soun", entradaAudio({ codec, versaoEntrada, asc, esdsEmWave, estendido }), amostras, chunks, offsets, co64));
    return caixa("moov", caixaCheia("mvhd", 0, Buffer.alloc(96)), ...traks);
  };

  if (moovNoFim) {
    const mdat = caixa("mdat", corpoMdat);
    return Buffer.concat([ftyp, mdat, montarMoov(ftyp.length + 8)]);
  }
  const tamanhoMoov = montarMoov(0).length; // os offsets não mudam o tamanho do moov
  const moov = montarMoov(ftyp.length + tamanhoMoov + 8);
  return Buffer.concat([ftyp, moov, caixa("mdat", corpoMdat)]);
}

/**
 * Lê um fluxo ADTS: devolve o cabeçalho de cada quadro e o conteúdo (sem o cabeçalho).
 * Leitor independente do código de produção, para conferir os bits.
 * @param {Buffer} b
 */
function lerAdts(b) {
  /** @type {{ mpeg4: boolean, semCrc: boolean, perfil: number, indiceFrequencia: number, canais: number, conteudo: Buffer }[]} */
  const quadros = [];
  let p = 0;
  while (p < b.length) {
    if (b[p] !== 0xff || (b[p + 1] & 0xf6) !== 0xf0) throw new Error(`Sync ADTS ausente no byte ${p}.`);
    const tamanho = ((b[p + 3] & 0x03) << 11) | (b[p + 4] << 3) | (b[p + 5] >> 5);
    quadros.push({
      mpeg4: (b[p + 1] & 0x08) === 0,
      semCrc: (b[p + 1] & 0x01) === 1,
      perfil: b[p + 2] >> 6,
      indiceFrequencia: (b[p + 2] >> 2) & 0x0f,
      canais: ((b[p + 2] & 0x01) << 2) | (b[p + 3] >> 6),
      conteudo: b.subarray(p + 7, p + tamanho),
    });
    p += tamanho;
  }
  return quadros;
}

module.exports = { mp4ComAudio, lerAdts, ASC_AAC_LC, AMOSTRAS_PADRAO };
