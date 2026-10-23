// @ts-check
// Tipo da mídia recebida pelo CONTEÚDO (magic bytes), nunca pela extensão nem só pelo mimetype
// declarado pelo remetente. Base: src/whatsapp/tipoMidia.js do apice-financeiro-wa-wa-back
// (assinaturas, brands do ISO BMFF, diretório central do ZIP, duração real do Ogg/Opus), ampliada
// para tudo que o CRM recebe e exibe: imagem e figurinha, vídeo, áudio, PDF e Office.
// Funções puras: não leem nem gravam nada.

/**
 * @param {Buffer} buf
 * @param {number[]} assinatura
 * @param {number} [offset]
 */
const inicia = (buf, assinatura, offset = 0) =>
  buf.length >= offset + assinatura.length && assinatura.every((b, i) => buf[offset + i] === b);
/** @param {string} texto */
const ascii = (texto) => [...Buffer.from(texto, "latin1")];

const MIME_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MIME_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const MIME_DOC = "application/msword";
const MIME_XLS = "application/vnd.ms-excel";

// "ftyp" sozinho também casa HEIC/AVIF (imagem): o tipo sai da major brand (bytes 8..12).
const BRANDS_VIDEO_MP4 = new Set(["isom", "iso2", "iso4", "iso5", "iso6", "mp41", "mp42", "avc1", "dash", "M4V ", "mmp4"]);
const BRANDS_AUDIO_MP4 = new Set(["M4A ", "M4B "]);
const BRANDS_3GPP = new Set(["3gp4", "3gp5", "3gp6", "3gg6", "3ge6"]);
const BRANDS_QUICKTIME = new Set(["qt  "]);

/** @param {Buffer} b @returns {string | null} */
function tipoIsoBmff(b) {
  if (!inicia(b, ascii("ftyp"), 4) || b.length < 12) return null;
  const brand = b.subarray(8, 12).toString("latin1");
  if (BRANDS_VIDEO_MP4.has(brand)) return "video/mp4";
  if (BRANDS_AUDIO_MP4.has(brand)) return "audio/mp4";
  if (BRANDS_3GPP.has(brand)) return "video/3gpp";
  if (BRANDS_QUICKTIME.has(brand)) return "video/quicktime";
  return null;
}

/**
 * MP3 sem ID3: cabeçalho de quadro MPEG (sync de 11 bits, layer ≠ reservado, bitrate ≠ inválido).
 * O ADTS do AAC tem layer 00 e cai fora daqui.
 * @param {Buffer} b
 */
function quadroMp3(b) {
  if (b.length < 3 || b[0] !== 0xff || (b[1] & 0xe0) !== 0xe0) return false;
  const versao = (b[1] >> 3) & 0x03;
  const layer = (b[1] >> 1) & 0x03;
  const bitrate = b[2] >> 4;
  return versao !== 0x01 && layer !== 0x00 && bitrate !== 0x0f;
}

/** ADTS (AAC cru): sync de 12 bits e layer 00. @param {Buffer} b */
const quadroAdts = (b) => b.length >= 2 && b[0] === 0xff && (b[1] & 0xf6) === 0xf0;

const ZIP = [0x50, 0x4b, 0x03, 0x04];
const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const ASSINATURA_EOCD = 0x06054b50;
const ASSINATURA_CENTRAL = 0x02014b50;
// ZIP64 é recusado e o teto é 10000 entradas: Office de até 16 MB não precisa de ZIP64.
const MAX_ENTRADAS_ZIP = 10000;

/**
 * Nomes das entradas do diretório central de um zip (regra do financeiro): exige `PK\x03\x04` no
 * início e o End of Central Directory nos últimos 22 + 65535 bytes. ZIP64, diretório além do EOCD,
 * total 0 ou acima do teto, assinatura de entrada inválida ou leitura fora do diretório → null.
 * @param {Buffer} b
 * @returns {string[] | null}
 */
function nomesEntradasZip(b) {
  if (!inicia(b, ZIP) || b.length < 22) return null;
  let eocd = -1;
  for (let i = b.length - 22, min = Math.max(0, b.length - 22 - 0xffff); i >= min; i -= 1) {
    if (b.readUInt32LE(i) === ASSINATURA_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const total = b.readUInt16LE(eocd + 10);
  const tamanho = b.readUInt32LE(eocd + 12);
  const offset = b.readUInt32LE(eocd + 16);
  if (total === 0xffff || tamanho === 0xffffffff || offset === 0xffffffff) return null;
  if (offset + tamanho > eocd || total === 0 || total > MAX_ENTRADAS_ZIP) return null;
  const fim = offset + tamanho;
  /** @type {string[]} */
  const nomes = [];
  for (let p = offset, n = 0; n < total; n += 1) {
    if (p + 46 > fim || b.readUInt32LE(p) !== ASSINATURA_CENTRAL) return null;
    const tamanhoNome = b.readUInt16LE(p + 28);
    const proxima = p + 46 + tamanhoNome + b.readUInt16LE(p + 30) + b.readUInt16LE(p + 32);
    if (proxima > fim) return null;
    nomes.push(b.subarray(p + 46, p + 46 + tamanhoNome).toString("latin1"));
    p = proxima;
  }
  return nomes;
}

/**
 * OOXML pelos NOMES do diretório central: exige `[Content_Types].xml` e `word/` ou `xl/` (nunca os
 * dois). Um ZIP comum não é aceito.
 * @param {Buffer} b
 */
function tipoOoxml(b) {
  const nomes = nomesEntradasZip(b);
  if (!nomes || !nomes.includes("[Content_Types].xml")) return null;
  const word = nomes.some((n) => n.startsWith("word/"));
  const xl = nomes.some((n) => n.startsWith("xl/"));
  if (word && !xl) return MIME_DOCX;
  if (xl && !word) return MIME_XLSX;
  return null;
}

/**
 * DOC/XLS (OLE2) pelos nomes dos streams em UTF-16LE (regra do financeiro).
 * @param {Buffer} b
 */
function tipoOle(b) {
  /** @param {string} t */
  const contem = (t) => b.includes(Buffer.from(t, "utf16le"));
  const word = contem("WordDocument");
  const xls = contem("Workbook") || contem("Book");
  if (word && !xls) return MIME_DOC;
  if (xls && !word) return MIME_XLS;
  return null;
}

const MIME_PKCS12 = "application/x-pkcs12";
const OID_PKCS7 = Buffer.from([0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07]);
/** Janela de 64 bytes que começa no `30` do ContentInfo (a mesma do back), onde o OID PKCS#7 inteiro precisa caber. */
const JANELA_OID_PKCS7 = 64;

/**
 * PKCS#12 (PFX) pelo conteúdo: SEQUENCE (`30`) com comprimento curto, longo (`81`..`84`) ou BER
 * indefinido (`80`), INTEGER versão 3 (`02 01 03`), ContentInfo (`30`) e o OID PKCS#7 logo adiante.
 * Um ASN.1/DER qualquer (X.509 `.cer`) não casa.
 * @param {Buffer} b
 */
function ehPkcs12(b) {
  if (b.length < 2 || b[0] !== 0x30 || b[1] > 0x84) return false;
  const inicio = 2 + (b[1] > 0x80 ? b[1] - 0x80 : 0);
  return inicia(b, [0x02, 0x01, 0x03, 0x30], inicio) && b.subarray(inicio + 3, inicio + 3 + JANELA_OID_PKCS7).includes(OID_PKCS7);
}

/** @type {[string, (b: Buffer) => boolean][]} */
const ASSINATURAS = [
  [MIME_PKCS12, ehPkcs12],
  ["image/jpeg", (b) => inicia(b, [0xff, 0xd8, 0xff])],
  ["image/png", (b) => inicia(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
  ["image/webp", (b) => inicia(b, ascii("RIFF")) && inicia(b, ascii("WEBP"), 8)],
  ["image/gif", (b) => inicia(b, ascii("GIF87a")) || inicia(b, ascii("GIF89a"))],
  ["application/pdf", (b) => inicia(b, ascii("%PDF-"))],
  // Nota de voz do WhatsApp: Ogg com Opus (o OpusHead começa no byte 28 da primeira página).
  ["audio/ogg", (b) => inicia(b, ascii("OggS")) && inicia(b, ascii("OpusHead"), 28)],
  ["audio/mpeg", (b) => inicia(b, ascii("ID3")) || quadroMp3(b)],
  ["audio/aac", quadroAdts],
  ["audio/amr", (b) => inicia(b, ascii("#!AMR"))],
];

/**
 * Mimetype detectado pelos primeiros bytes (e, no ZIP, pelo diretório central), ou `null` quando
 * o conteúdo não é de um tipo aceito.
 * @param {Buffer} buffer
 * @returns {string | null}
 */
function detectarTipoPorConteudo(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return null;
  const achado = ASSINATURAS.find(([, casa]) => casa(buffer));
  if (achado) return achado[0];
  const iso = tipoIsoBmff(buffer);
  if (iso) return iso;
  if (inicia(buffer, ZIP)) return tipoOoxml(buffer);
  if (inicia(buffer, OLE)) return tipoOle(buffer);
  return null;
}

/**
 * Tipos declarados (já normalizados) que cada tipo detectado aceita. Um tipo declarado fora da
 * lista do detectado é divergência.
 * @type {Record<string, string[]>}
 */
const DECLARADOS_ACEITOS = {
  "image/jpeg": ["image/jpeg", "image/jpg", "image/pjpeg"],
  "image/png": ["image/png"],
  "image/webp": ["image/webp"],
  "image/gif": ["image/gif"],
  "application/pdf": ["application/pdf"],
  "audio/ogg": ["audio/ogg", "audio/opus", "application/ogg"],
  "audio/mpeg": ["audio/mpeg", "audio/mp3"],
  "audio/aac": ["audio/aac", "audio/aacp", "audio/x-aac"],
  "audio/amr": ["audio/amr"],
  "audio/mp4": ["audio/mp4", "audio/m4a", "audio/x-m4a"],
  "video/mp4": ["video/mp4"],
  "video/3gpp": ["video/3gpp", "audio/3gpp"],
  "video/quicktime": ["video/quicktime"],
  [MIME_DOCX]: [MIME_DOCX],
  [MIME_XLSX]: [MIME_XLSX],
  [MIME_DOC]: [MIME_DOC],
  [MIME_XLS]: [MIME_XLS],
  [MIME_PKCS12]: [MIME_PKCS12, "application/pkcs12"],
};

/** Declarações que não dizem o tipo: valem pelo conteúdo detectado. */
const DECLARADOS_GENERICOS = new Set(["", "application/octet-stream", "binary/octet-stream"]);

/**
 * `"audio/ogg; codecs=opus"` → `"audio/ogg"` (minúsculo, sem parâmetros).
 * @param {string | null | undefined} mimetype
 * @returns {string}
 */
function normalizarMimetype(mimetype) {
  return typeof mimetype === "string" ? mimetype.split(";")[0].trim().toLowerCase() : "";
}

/** @typedef {"MIDIA_VAZIA" | "ACIMA_DO_TETO" | "TIPO_NAO_RECONHECIDO" | "TIPO_DIVERGENTE"} MotivoRecusaMidia */
/**
 * @typedef {{ ok: true, mimetype: string, tamanho_bytes: number }
 *   | { ok: false, motivo: MotivoRecusaMidia }} ResultadoValidacao
 */

/**
 * Valida a mídia baixada: tamanho real até o teto, tipo reconhecido pelo conteúdo e compatível
 * com o declarado. Sem tipo declarado (ou `application/octet-stream`), vale o detectado. Um MP4
 * genérico declarado como `audio/mp4` (m4a) é o mesmo contêiner e sai como `audio/mp4`.
 * @param {Buffer} buffer
 * @param {string | null | undefined} mimetypeDeclarado
 * @param {number} tetoBytes
 * @returns {ResultadoValidacao}
 */
function validarMidia(buffer, mimetypeDeclarado, tetoBytes) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return { ok: false, motivo: "MIDIA_VAZIA" };
  if (buffer.length > tetoBytes) return { ok: false, motivo: "ACIMA_DO_TETO" };
  const detectado = detectarTipoPorConteudo(buffer);
  if (!detectado) return { ok: false, motivo: "TIPO_NAO_RECONHECIDO" };

  const declarado = normalizarMimetype(mimetypeDeclarado);
  /** @param {string} mimetype @returns {ResultadoValidacao} */
  const aceito = (mimetype) => ({ ok: true, mimetype, tamanho_bytes: buffer.length });
  if (DECLARADOS_GENERICOS.has(declarado)) return aceito(detectado);
  if (DECLARADOS_ACEITOS[detectado]?.includes(declarado)) return aceito(detectado);
  if (detectado === "video/mp4" && DECLARADOS_ACEITOS["audio/mp4"].includes(declarado)) return aceito("audio/mp4");
  return { ok: false, motivo: "TIPO_DIVERGENTE" };
}

/**
 * Duração REAL de um Ogg/Opus pelo conteúdo (o `seconds` do WhatsApp é declarado pelo remetente e
 * pode faltar ou mentir): granule position (int64 LE no byte 6) da ÚLTIMA página, menos o pre-skip
 * do OpusHead (uint16 LE no byte 38), em 48 kHz (RFC 7845). `null` se ilegível.
 * @param {Buffer} buffer
 * @returns {number | null} segundos
 */
function duracaoOggOpusSegundos(buffer) {
  if (detectarTipoPorConteudo(buffer) !== "audio/ogg" || buffer.length < 40) return null;
  const ultima = buffer.lastIndexOf("OggS");
  if (ultima + 27 > buffer.length || buffer[ultima + 4] !== 0) return null;
  const amostras = buffer.readBigInt64LE(ultima + 6) - BigInt(buffer.readUInt16LE(38));
  return amostras < 0n ? null : Number(amostras) / 48000;
}

module.exports = { detectarTipoPorConteudo, validarMidia, duracaoOggOpusSegundos, normalizarMimetype, MIME_DOCX, MIME_XLSX, MIME_DOC, MIME_XLS, MIME_PKCS12 };
