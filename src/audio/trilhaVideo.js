// @ts-check
// Trilha de áudio de um vídeo (MP4, 3GP, QuickTime) ou de um M4A, extraída só em memória para a
// transcrição. A MiniMax ASR aceita wav, aiff, flac, alac, mp3, aac, opus e ogg, mas não o
// contêiner de vídeo: aqui o AAC da trilha `soun` sai como fluxo ADTS (`audio/aac`).
//
// Por que um demux em JS, e não ffmpeg: o SPEC proíbe mídia em disco, e o ffmpeg só lê de pipe
// (stdin) sem poder voltar no arquivo. Um MP4 com o `moov` no fim (sem "faststart") não abre por
// stdin, e a saída exigiria um binário de ~70 MB (`ffmpeg-static`) baixado no install. Como o
// vídeo inteiro já está num Buffer (o download validado da Task 4.2), o acesso aleatório é de
// graça: lemos `moov` onde estiver, achamos as amostras pela tabela (`stsc`/`stsz`/`stco`/`co64`)
// e só prefixamos cada quadro AAC com o cabeçalho ADTS de 7 bytes. Sem dependência, sem processo
// externo, igual no Windows e no Linux.
//
// Limites: só trilha AAC (a dos vídeos do WhatsApp). Outro codec (AMR do 3GP, Opus em MP4) é
// `CODEC_NAO_SUPORTADO`; MP4 fragmentado (`moof`, sem tabela de amostras no `moov`) cai em
// `SEM_TRILHA_AUDIO` ou `CONTEINER_INVALIDO`.

/** Tipo do Buffer devolvido por `extrairTrilhaAudio`. */
const MIMETYPE_TRILHA = "audio/aac";
/** O campo de tamanho do quadro ADTS tem 13 bits (cabeçalho incluído). */
const MAX_QUADRO_ADTS = 0x1fff;
const TAMANHO_CABECALHO_ADTS = 7;
/** objectTypeIndication do AAC no `esds`: MPEG-4 Audio (0x40) e MPEG-2 AAC Main/LC/SSR (0x66-0x68). */
const OTI_AAC = new Set([0x40, 0x66, 0x67, 0x68]);

/** @typedef {"CONTEINER_INVALIDO" | "SEM_TRILHA_AUDIO" | "CODEC_NAO_SUPORTADO"} CodigoErroTrilha */

class ErroTrilhaAudio extends Error {
  /**
   * @param {CodigoErroTrilha} codigo
   * @param {string} mensagem
   */
  constructor(codigo, mensagem) {
    super(mensagem);
    this.name = "ErroTrilhaAudio";
    this.codigo = codigo;
  }
}

/** @typedef {{ tipo: string, inicio: number, fim: number }} Caixa  inicio/fim do CONTEÚDO (sem cabeçalho) */

const invalido = () => new ErroTrilhaAudio("CONTEINER_INVALIDO", "Contêiner de vídeo inválido ou incompleto.");
const codecNaoSuportado = () => new ErroTrilhaAudio("CODEC_NAO_SUPORTADO", "A trilha de áudio do vídeo não está em AAC.");

/**
 * Caixas (boxes) ISO BMFF entre `inicio` e `fim`. Tamanho 1 = 64 bits, tamanho 0 = até o fim.
 * Uma caixa que passa do limite do pai (arquivo truncado) é contêiner inválido.
 * @param {Buffer} b
 * @param {number} inicio
 * @param {number} fim
 * @returns {Caixa[]}
 */
function lerCaixas(b, inicio, fim) {
  /** @type {Caixa[]} */
  const caixas = [];
  let p = inicio;
  while (p + 8 <= fim) {
    let tamanho = b.readUInt32BE(p);
    const tipo = b.toString("latin1", p + 4, p + 8);
    let cabecalho = 8;
    if (tamanho === 1) {
      if (p + 16 > fim) throw invalido();
      tamanho = Number(b.readBigUInt64BE(p + 8));
      cabecalho = 16;
    } else if (tamanho === 0) {
      tamanho = fim - p;
    }
    if (tamanho < cabecalho || p + tamanho > fim) throw invalido();
    caixas.push({ tipo, inicio: p + cabecalho, fim: p + tamanho });
    p += tamanho;
  }
  return caixas;
}

/**
 * @param {Buffer} b
 * @param {Caixa | undefined} pai
 * @param {string} tipo
 * @returns {Caixa | undefined}
 */
function filho(b, pai, tipo) {
  return pai ? lerCaixas(b, pai.inicio, pai.fim).find((c) => c.tipo === tipo) : undefined;
}

/**
 * Caminho de caixas obrigatório (ex.: mdia → minf → stbl); ausência é contêiner inválido.
 * @param {Buffer} b
 * @param {Caixa} raiz
 * @param {string[]} tipos
 * @returns {Caixa}
 */
function caminho(b, raiz, tipos) {
  let atual = raiz;
  for (const tipo of tipos) {
    const proximo = filho(b, atual, tipo);
    if (!proximo) throw invalido();
    atual = proximo;
  }
  return atual;
}

/**
 * Descritor MPEG-4 do `esds`: tag de 1 byte e tamanho em até 4 bytes de 7 bits.
 * @param {Buffer} b
 * @param {number} p
 * @param {number} limite
 * @returns {{ tag: number, inicio: number, fim: number }}
 */
function lerDescritor(b, p, limite) {
  if (p >= limite) throw codecNaoSuportado();
  const tag = b[p];
  let tamanho = 0;
  let q = p + 1;
  for (let i = 0; i < 4; i += 1) {
    if (q >= limite) throw invalido();
    const byte = b[q];
    q += 1;
    tamanho = (tamanho << 7) | (byte & 0x7f);
    if ((byte & 0x80) === 0) break;
  }
  if (q + tamanho > limite) throw invalido();
  return { tag, inicio: q, fim: q + tamanho };
}

/**
 * AudioSpecificConfig do `esds` (ES_Descriptor → DecoderConfigDescriptor → DecoderSpecificInfo).
 * @param {Buffer} b
 * @param {Caixa} esds
 * @returns {Buffer}
 */
function audioSpecificConfig(b, esds) {
  const es = lerDescritor(b, esds.inicio + 4, esds.fim); // + versão/flags da full box
  if (es.tag !== 0x03) throw codecNaoSuportado();
  let p = es.inicio + 2; // ES_ID
  const flags = b[p];
  p += 1;
  if (flags & 0x80) p += 2; // dependsOn_ES_ID
  if (flags & 0x40) p += 1 + b[p]; // URL
  if (flags & 0x20) p += 2; // OCR_ES_Id
  const config = lerDescritor(b, p, es.fim);
  if (config.tag !== 0x04 || !OTI_AAC.has(b[config.inicio])) throw codecNaoSuportado();
  const especifico = lerDescritor(b, config.inicio + 13, config.fim);
  if (especifico.tag !== 0x05 || especifico.fim - especifico.inicio < 2) throw codecNaoSuportado();
  return b.subarray(especifico.inicio, especifico.fim);
}

/**
 * Perfil, frequência e canais do ADTS a partir do AudioSpecificConfig. HE-AAC (objeto 5 ou 29)
 * sinaliza a extensão SBR explicitamente: o ADTS leva o núcleo (objeto e frequência do AAC-LC), e
 * o decodificador detecta o SBR pelo conteúdo.
 * @param {Buffer} asc
 * @returns {{ perfil: number, indiceFrequencia: number, canais: number }}
 */
function parametrosAdts(asc) {
  let bit = 0;
  /** @param {number} n */
  const ler = (n) => {
    let valor = 0;
    for (let i = 0; i < n; i += 1) {
      const byte = asc[bit >> 3];
      if (byte === undefined) throw codecNaoSuportado();
      valor = (valor << 1) | ((byte >> (7 - (bit & 7))) & 1);
      bit += 1;
    }
    return valor;
  };
  let objeto = ler(5);
  const indiceFrequencia = ler(4);
  if (indiceFrequencia === 15) throw codecNaoSuportado(); // frequência explícita: não cabe no ADTS
  const canais = ler(4);
  if (objeto === 5 || objeto === 29) {
    if (ler(4) === 15) ler(24);
    objeto = ler(5);
  }
  // ADTS só tem 2 bits de perfil (objetos 1 a 4); canais 0 (PCE) ou acima de 7 não cabem.
  if (objeto < 1 || objeto > 4 || canais < 1 || canais > 7) throw codecNaoSuportado();
  return { perfil: objeto - 1, indiceFrequencia, canais };
}

/**
 * @param {{ perfil: number, indiceFrequencia: number, canais: number }} p
 * @param {number} tamanhoQuadro conteúdo + cabeçalho
 */
function cabecalhoAdts({ perfil, indiceFrequencia, canais }, tamanhoQuadro) {
  return Buffer.from([
    0xff,
    0xf1, // sync, MPEG-4, layer 0, sem CRC
    (perfil << 6) | (indiceFrequencia << 2) | (canais >> 2),
    ((canais & 0x03) << 6) | (tamanhoQuadro >> 11),
    (tamanhoQuadro >> 3) & 0xff,
    ((tamanhoQuadro & 0x07) << 5) | 0x1f, // buffer fullness 0x7FF (VBR)
    0xfc, // fim do buffer fullness, 1 quadro raw
  ]);
}

/**
 * Amostras da trilha, na ordem, pela tabela de amostras do `stbl`.
 * @param {Buffer} b
 * @param {Caixa} stbl
 * @returns {Buffer[]}
 */
function amostrasDaTrilha(b, stbl) {
  const stsz = caminho(b, stbl, ["stsz"]);
  const stsc = caminho(b, stbl, ["stsc"]);
  const stco = filho(b, stbl, "stco");
  const co64 = filho(b, stbl, "co64");
  const tabelaOffsets = stco ?? co64;
  if (!tabelaOffsets) throw invalido();

  const tamanhoFixo = b.readUInt32BE(stsz.inicio + 4);
  const totalAmostras = b.readUInt32BE(stsz.inicio + 8);
  if (totalAmostras === 0) throw new ErroTrilhaAudio("SEM_TRILHA_AUDIO", "O vídeo não tem áudio.");
  if (tamanhoFixo === 0 && stsz.inicio + 12 + totalAmostras * 4 > stsz.fim) throw invalido();

  const totalChunks = b.readUInt32BE(tabelaOffsets.inicio + 4);
  const largura = stco ? 4 : 8;
  if (tabelaOffsets.inicio + 8 + totalChunks * largura > tabelaOffsets.fim) throw invalido();
  /** @param {number} i índice 0 do chunk */
  const offsetChunk = (i) =>
    stco ? b.readUInt32BE(tabelaOffsets.inicio + 8 + i * 4) : Number(b.readBigUInt64BE(tabelaOffsets.inicio + 8 + i * 8));

  const entradasStsc = b.readUInt32BE(stsc.inicio + 4);
  if (entradasStsc === 0 || stsc.inicio + 8 + entradasStsc * 12 > stsc.fim) throw invalido();
  /** @param {number} i @returns {[number, number]} [primeiro chunk (base 1), amostras por chunk] */
  const entradaStsc = (i) => [b.readUInt32BE(stsc.inicio + 8 + i * 12), b.readUInt32BE(stsc.inicio + 12 + i * 12)];

  /** @type {Buffer[]} */
  const amostras = [];
  let entrada = 0;
  for (let chunk = 0; chunk < totalChunks && amostras.length < totalAmostras; chunk += 1) {
    while (entrada + 1 < entradasStsc && entradaStsc(entrada + 1)[0] <= chunk + 1) entrada += 1;
    const porChunk = entradaStsc(entrada)[1];
    let offset = offsetChunk(chunk);
    for (let s = 0; s < porChunk && amostras.length < totalAmostras; s += 1) {
      const tamanho = tamanhoFixo || b.readUInt32BE(stsz.inicio + 12 + amostras.length * 4);
      if (offset + tamanho > b.length || tamanho + TAMANHO_CABECALHO_ADTS > MAX_QUADRO_ADTS) throw invalido();
      amostras.push(b.subarray(offset, offset + tamanho));
      offset += tamanho;
    }
  }
  if (amostras.length < totalAmostras) throw invalido();
  return amostras;
}

/**
 * `stbl` da primeira trilha de áudio (`hdlr` = `soun`) do `moov`.
 * @param {Buffer} b
 * @returns {Caixa} o `stbl` da trilha
 */
function trilhaDeAudio(b) {
  const moov = lerCaixas(b, 0, b.length).find((c) => c.tipo === "moov");
  if (!moov) throw invalido();
  for (const trak of lerCaixas(b, moov.inicio, moov.fim).filter((c) => c.tipo === "trak")) {
    const mdia = filho(b, trak, "mdia");
    const hdlr = filho(b, mdia, "hdlr");
    if (mdia && hdlr && b.toString("latin1", hdlr.inicio + 8, hdlr.inicio + 12) === "soun") return caminho(b, mdia, ["minf", "stbl"]);
  }
  throw new ErroTrilhaAudio("SEM_TRILHA_AUDIO", "O vídeo não tem trilha de áudio.");
}

/**
 * `esds` da sample entry `mp4a` (direto ou, no QuickTime, dentro de `wave`).
 * @param {Buffer} b
 * @param {Caixa} stbl
 * @returns {Caixa}
 */
function esdsDaTrilha(b, stbl) {
  const stsd = caminho(b, stbl, ["stsd"]);
  const [entrada] = lerCaixas(b, stsd.inicio + 8, stsd.fim); // + versão/flags e entry_count
  if (!entrada) throw invalido();
  if (entrada.tipo !== "mp4a") throw codecNaoSuportado();
  // SampleEntry (8) + AudioSampleEntry (20); QuickTime v1 tem +16 bytes e v2, +36.
  const versao = b.readUInt16BE(entrada.inicio + 8);
  const inicioFilhos = entrada.inicio + 28 + (versao === 1 ? 16 : versao === 2 ? 36 : 0);
  const filhos = lerCaixas(b, inicioFilhos, entrada.fim);
  const esds = filhos.find((c) => c.tipo === "esds") ?? filho(b, filhos.find((c) => c.tipo === "wave"), "esds");
  if (!esds) throw codecNaoSuportado();
  return esds;
}

/**
 * Extrai a trilha de áudio AAC de um vídeo (ou M4A) em memória e a devolve como fluxo ADTS
 * (`audio/aac`). Nada é gravado em disco e nenhum processo externo é aberto.
 * @param {Buffer} bufferVideo
 * @returns {Buffer} áudio AAC/ADTS
 * @throws {ErroTrilhaAudio} `CONTEINER_INVALIDO`, `SEM_TRILHA_AUDIO` ou `CODEC_NAO_SUPORTADO`
 */
function extrairTrilhaAudio(bufferVideo) {
  if (!Buffer.isBuffer(bufferVideo) || bufferVideo.length < 8) throw invalido();
  try {
    const stbl = trilhaDeAudio(bufferVideo);
    const parametros = parametrosAdts(audioSpecificConfig(bufferVideo, esdsDaTrilha(bufferVideo, stbl)));
    const amostras = amostrasDaTrilha(bufferVideo, stbl);
    return Buffer.concat(amostras.flatMap((a) => [cabecalhoAdts(parametros, a.length + TAMANHO_CABECALHO_ADTS), a]));
  } catch (erro) {
    if (erro instanceof ErroTrilhaAudio) throw erro;
    throw invalido(); // leitura fora do buffer (RangeError) em arquivo truncado ou corrompido
  }
}

module.exports = { extrairTrilhaAudio, ErroTrilhaAudio, MIMETYPE_TRILHA };
