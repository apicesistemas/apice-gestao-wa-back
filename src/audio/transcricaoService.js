// @ts-check
// Transcrição de áudio pela MiniMax ASR. Base: o padrão já em produção no comandax_crm_wa_back e
// no apice-financeiro-wa-wa-back (`transcricaoService.js`): `POST {base}/speech_to_text`, modelo
// `asr-1.0`, multipart com `fetch`/`FormData`/`Blob` nativos (sem dependência), idioma no HEADER
// `language` (anomalia da MiniMax), resposta `{ text, duration }` confirmada contra a API real.
//
// Diferenças em relação às referências:
// - nunca rejeita: devolve `{ texto }` ou `{ erro, transitorio }`; a nova tentativa e a decisão
//   PENDENTE/FALHOU são da `filaTranscricao` (que também é quem serializa as chamadas);
// - converte o formato quando a API exige: a MiniMax aceita wav, aiff, flac, alac, mp3, aac, opus
//   e ogg, não o contêiner de vídeo. MP4/3GP/QuickTime/M4A passam pelo `extrairTrilhaAudio` e
//   vão como `audio/aac` (ADTS). AMR não tem conversão sem decodificador: falha definitiva.
//
// A chave (`MINIMAX_API_KEY`) só vai no header: nunca entra em log nem em erro. O corpo da
// resposta também não (pode ecoar a transcrição, que é conteúdo do cliente).
const { normalizarMimetype } = require("../whatsapp/tipoMidia");
const { extrairTrilhaAudio, ErroTrilhaAudio, MIMETYPE_TRILHA } = require("./trilhaVideo");

const URL_ASR = "https://api.minimax.io/v1/speech_to_text";
const MODELO_ASR = "asr-1.0";
/** Limites da própria API (acima deles a MiniMax responde 413/400): não são regra de negócio. */
const TAMANHO_MAXIMO_BYTES = 50 * 1024 * 1024;
const DURACAO_MAXIMA_SEGUNDOS = 500;
/** Prazo de uma chamada (envio + leitura do corpo). */
const PRAZO_PADRAO_MS = 60 * 1000;

/** Formatos que a MiniMax aceita direto, entre os que o `tipoMidia` detecta. Valor: extensão do nome. */
/** @type {Record<string, string>} */
const ACEITOS_DIRETO = { "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/aac": "aac" };
/** Contêineres ISO BMFF: o áudio sai da trilha AAC. */
const CONTEINERES_ISO = new Set(["audio/mp4", "video/mp4", "video/3gpp", "video/quicktime"]);

/**
 * @typedef {"SEM_CHAVE" | "AUDIO_VAZIO" | "AUDIO_GRANDE_DEMAIS" | "AUDIO_LONGO_DEMAIS" | "FORMATO_NAO_SUPORTADO"
 *   | "SEM_TRILHA_AUDIO" | "MINIMAX_LIMITE" | "MINIMAX_INDISPONIVEL" | "MINIMAX_TIMEOUT" | "MINIMAX_REDE"
 *   | "MINIMAX_RECUSOU" | "RESPOSTA_INVALIDA" | "TRANSCRICAO_VAZIA"} CodigoErroTranscricao
 */
/** @typedef {{ texto: string } | { erro: CodigoErroTranscricao, transitorio: boolean }} ResultadoTranscricao */
/** @typedef {{ duracaoSegundos?: number | null, fetch?: typeof fetch, prazoMs?: number }} OpcoesTranscricao */

/**
 * @param {CodigoErroTranscricao} erro
 * @param {boolean} [transitorio]
 * @returns {ResultadoTranscricao}
 */
const falha = (erro, transitorio = false) => ({ erro, transitorio });

/** @param {unknown} erro */
const ehTimeout = (erro) => erro instanceof Error && (erro.name === "TimeoutError" || erro.name === "AbortError");

/**
 * Áudio no formato aceito pela MiniMax, convertendo quando preciso.
 * @param {Buffer} buffer
 * @param {string} mimetype normalizado
 * @returns {{ ok: true, buffer: Buffer, mimetype: string, extensao: string } | { ok: false, resultado: ResultadoTranscricao }}
 */
function prepararAudio(buffer, mimetype) {
  if (ACEITOS_DIRETO[mimetype]) return { ok: true, buffer, mimetype, extensao: ACEITOS_DIRETO[mimetype] };
  if (!CONTEINERES_ISO.has(mimetype)) return { ok: false, resultado: falha("FORMATO_NAO_SUPORTADO") };
  try {
    return { ok: true, buffer: extrairTrilhaAudio(buffer), mimetype: MIMETYPE_TRILHA, extensao: "aac" };
  } catch (erro) {
    const semAudio = erro instanceof ErroTrilhaAudio && erro.codigo === "SEM_TRILHA_AUDIO";
    return { ok: false, resultado: falha(semAudio ? "SEM_TRILHA_AUDIO" : "FORMATO_NAO_SUPORTADO") };
  }
}

/**
 * Transcreve um áudio (ou a trilha de áudio de um vídeo) pela MiniMax ASR, em pt. Uma chamada
 * só, sem nova tentativa. Falha fechada: texto vazio nunca é sucesso. O corpo da resposta é lido
 * aqui dentro: a conexão com a MiniMax só é liberada no fim do corpo (senão a próxima da fila abre
 * outra conexão e volta o 429 "conn limit").
 * @param {Buffer} buffer
 * @param {string | null | undefined} mimetype tipo DETECTADO pelo conteúdo
 * @param {OpcoesTranscricao} [opcoes] `duracaoSegundos` conhecida; `fetch` e `prazoMs` para testes
 * @returns {Promise<ResultadoTranscricao>} nunca rejeita
 */
async function transcrever(buffer, mimetype, { duracaoSegundos = null, fetch = globalThis.fetch, prazoMs = PRAZO_PADRAO_MS } = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return falha("AUDIO_VAZIO");
  if (buffer.length > TAMANHO_MAXIMO_BYTES) return falha("AUDIO_GRANDE_DEMAIS");
  if (typeof duracaoSegundos === "number" && duracaoSegundos > DURACAO_MAXIMA_SEGUNDOS) return falha("AUDIO_LONGO_DEMAIS");
  const chave = process.env.MINIMAX_API_KEY || "";
  if (!chave) return falha("SEM_CHAVE");

  const audio = prepararAudio(buffer, normalizarMimetype(mimetype));
  if (!audio.ok) return audio.resultado;

  const form = new FormData();
  form.append("model", MODELO_ASR);
  form.append("file", new Blob([audio.buffer], { type: audio.mimetype }), `audio.${audio.extensao}`);
  form.append("response_format", "json");

  /** @type {Response} */
  let resposta;
  /** @type {string} */
  let corpo;
  try {
    // Sem Content-Type: o fetch gera o boundary do multipart.
    resposta = await fetch(URL_ASR, {
      method: "POST",
      headers: { Authorization: `Bearer ${chave}`, language: "pt" },
      body: form,
      signal: AbortSignal.timeout(prazoMs),
    });
    corpo = await resposta.text();
  } catch (erro) {
    return falha(ehTimeout(erro) ? "MINIMAX_TIMEOUT" : "MINIMAX_REDE", true);
  }

  if (resposta.status === 429) return falha("MINIMAX_LIMITE", true);
  if (resposta.status >= 500) return falha("MINIMAX_INDISPONIVEL", true);
  if (!resposta.ok) return falha("MINIMAX_RECUSOU");

  /** @type {any} */
  let json;
  try {
    json = JSON.parse(corpo);
  } catch {
    return falha("RESPOSTA_INVALIDA");
  }
  const texto = typeof json?.text === "string" ? json.text.trim() : "";
  if (!texto) return falha("TRANSCRICAO_VAZIA");
  return { texto };
}

module.exports = { transcrever, TAMANHO_MAXIMO_BYTES, DURACAO_MAXIMA_SEGUNDOS };
