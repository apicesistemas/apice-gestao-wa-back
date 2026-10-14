// @ts-check
// Transcrição pela MiniMax ASR com `fetch` falso: nenhum teste chama a MiniMax real. `transcrever`
// nunca rejeita: devolve `{ texto }` ou `{ erro, transitorio }` (a nova tentativa é da fila).
const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { transcrever, DURACAO_MAXIMA_SEGUNDOS, TAMANHO_MAXIMO_BYTES } = require("../../src/audio/transcricaoService");
const arquivos = require("../helpers/arquivosMidia");
const { mp4ComAudio, lerAdts, AMOSTRAS_PADRAO } = require("../helpers/mp4Falso");

const CHAVE = "chave-minimax-de-teste";
/** @type {string | undefined} */
let chaveOriginal;
beforeEach(() => {
  chaveOriginal = process.env.MINIMAX_API_KEY;
  process.env.MINIMAX_API_KEY = CHAVE;
});
afterEach(() => {
  if (chaveOriginal === undefined) delete process.env.MINIMAX_API_KEY;
  else process.env.MINIMAX_API_KEY = chaveOriginal;
});

/**
 * `fetch` falso que devolve as respostas na ordem (a última se repete) e guarda as chamadas.
 * @param {...(Response | Error)} respostas
 */
function fetchFalso(...respostas) {
  /** @type {{ url: string, init: any }[]} */
  const chamadas = [];
  const fn = /** @type {typeof fetch} */ (
    async (url, init) => {
      chamadas.push({ url: String(url), init });
      const r = respostas[Math.min(chamadas.length - 1, respostas.length - 1)];
      if (r instanceof Error) throw r;
      return r;
    }
  );
  return { fetch: fn, chamadas };
}

const erroTimeout = () => Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });

test("transcreve um OGG/Opus: POST speech_to_text com asr-1.0, Bearer, idioma pt no header e prazo", async () => {
  const f = fetchFalso(Response.json({ text: "  bom dia, o sistema travou  ", duration: 4.2 }));
  const ogg = arquivos.oggOpus(4);
  const r = await transcrever(ogg, "audio/ogg", { fetch: f.fetch });
  assert.deepEqual(r, { texto: "bom dia, o sistema travou" });
  assert.equal(f.chamadas.length, 1);
  const { url, init } = f.chamadas[0];
  assert.equal(url, "https://api.minimax.io/v1/speech_to_text");
  assert.equal(init.method, "POST");
  assert.equal(init.headers.Authorization, `Bearer ${CHAVE}`);
  assert.equal(init.headers.language, "pt");
  assert.equal(init.headers["Content-Type"], undefined, "o boundary do multipart é do fetch");
  assert.ok(init.signal instanceof AbortSignal);
  const form = /** @type {FormData} */ (init.body);
  assert.equal(form.get("model"), "asr-1.0");
  assert.equal(form.get("response_format"), "json");
  const arquivo = /** @type {File} */ (form.get("file"));
  assert.equal(arquivo.type, "audio/ogg");
  assert.equal(arquivo.name, "audio.ogg");
  assert.deepEqual(Buffer.from(await arquivo.arrayBuffer()), ogg);
});

test("MP3 vai direto, com o nome audio.mp3", async () => {
  const f = fetchFalso(Response.json({ text: "oi" }));
  assert.deepEqual(await transcrever(arquivos.mp3(), "audio/mpeg", { fetch: f.fetch }), { texto: "oi" });
  const arquivo = /** @type {File} */ (f.chamadas[0].init.body.get("file"));
  assert.equal(arquivo.name, "audio.mp3");
  assert.equal(arquivo.type, "audio/mpeg");
});

test("vídeo MP4 e áudio M4A são convertidos: a MiniMax recebe a trilha AAC em ADTS, nunca o contêiner", async () => {
  for (const [buffer, mimetype] of /** @type {[Buffer, string][]} */ ([
    [mp4ComAudio(), "video/mp4"],
    [mp4ComAudio({ comVideo: false, brand: "M4A " }), "audio/mp4"],
  ])) {
    const f = fetchFalso(Response.json({ text: "transcrição do vídeo" }));
    assert.deepEqual(await transcrever(buffer, mimetype, { fetch: f.fetch }), { texto: "transcrição do vídeo" });
    const arquivo = /** @type {File} */ (f.chamadas[0].init.body.get("file"));
    assert.equal(arquivo.type, "audio/aac");
    assert.equal(arquivo.name, "audio.aac");
    const quadros = lerAdts(Buffer.from(await arquivo.arrayBuffer()));
    assert.deepEqual(
      quadros.map((q) => q.conteudo),
      AMOSTRAS_PADRAO
    );
  }
});

test("formato que a MiniMax não aceita e que não dá para converter (AMR) falha definitivo, sem chamar a API", async () => {
  const f = fetchFalso(Response.json({ text: "não deveria" }));
  const amr = Buffer.concat([Buffer.from("#!AMR\n", "latin1"), Buffer.alloc(32)]);
  assert.deepEqual(await transcrever(amr, "audio/amr", { fetch: f.fetch }), { erro: "FORMATO_NAO_SUPORTADO", transitorio: false });
  assert.equal(f.chamadas.length, 0);
});

test("vídeo sem trilha de áudio ou com codec que não é AAC falha definitivo, sem chamar a API", async () => {
  const f = fetchFalso(Response.json({ text: "não deveria" }));
  assert.deepEqual(await transcrever(mp4ComAudio({ comAudio: false }), "video/mp4", { fetch: f.fetch }), { erro: "SEM_TRILHA_AUDIO", transitorio: false });
  assert.deepEqual(await transcrever(mp4ComAudio({ codec: "samr" }), "video/3gpp", { fetch: f.fetch }), { erro: "FORMATO_NAO_SUPORTADO", transitorio: false });
  assert.deepEqual(await transcrever(Buffer.from("lixo"), "video/mp4", { fetch: f.fetch }), { erro: "FORMATO_NAO_SUPORTADO", transitorio: false });
  assert.equal(f.chamadas.length, 0);
});

test("limites da MiniMax: áudio acima de 500 s ou de 50 MB, ou vazio, falha definitivo sem chamar a API", async () => {
  const f = fetchFalso(Response.json({ text: "não deveria" }));
  assert.equal(DURACAO_MAXIMA_SEGUNDOS, 500);
  assert.equal(TAMANHO_MAXIMO_BYTES, 50 * 1024 * 1024);
  assert.deepEqual(await transcrever(arquivos.oggOpus(3), "audio/ogg", { fetch: f.fetch, duracaoSegundos: 501 }), { erro: "AUDIO_LONGO_DEMAIS", transitorio: false });
  const grande = Buffer.concat([arquivos.oggOpus(3), Buffer.alloc(TAMANHO_MAXIMO_BYTES)]);
  assert.deepEqual(await transcrever(grande, "audio/ogg", { fetch: f.fetch }), { erro: "AUDIO_GRANDE_DEMAIS", transitorio: false });
  assert.deepEqual(await transcrever(Buffer.alloc(0), "audio/ogg", { fetch: f.fetch }), { erro: "AUDIO_VAZIO", transitorio: false });
  assert.equal(f.chamadas.length, 0);
});

test("sem MINIMAX_API_KEY não chama a API e devolve SEM_CHAVE", async () => {
  delete process.env.MINIMAX_API_KEY;
  const f = fetchFalso(Response.json({ text: "não deveria" }));
  assert.deepEqual(await transcrever(arquivos.oggOpus(3), "audio/ogg", { fetch: f.fetch }), { erro: "SEM_CHAVE", transitorio: false });
  assert.equal(f.chamadas.length, 0);
});

test("429, 5xx, timeout e falha de rede são transitórios; uma chamada só (a nova tentativa é da fila)", async () => {
  /** @type {[Response | Error, string][]} */
  const casos = [
    [new Response("conn limit (1041)", { status: 429 }), "MINIMAX_LIMITE"],
    [new Response("erro", { status: 503 }), "MINIMAX_INDISPONIVEL"],
    [erroTimeout(), "MINIMAX_TIMEOUT"],
    [new TypeError("fetch failed"), "MINIMAX_REDE"],
  ];
  for (const [resposta, codigo] of casos) {
    const f = fetchFalso(resposta);
    assert.deepEqual(await transcrever(arquivos.oggOpus(3), "audio/ogg", { fetch: f.fetch }), { erro: codigo, transitorio: true });
    assert.equal(f.chamadas.length, 1);
  }
});

test("4xx (exceto 429), JSON inválido e texto vazio são definitivos", async () => {
  /** @type {[Response, string][]} */
  const casos = [
    [new Response("formato inválido", { status: 400 }), "MINIMAX_RECUSOU"],
    [new Response("<html>", { status: 200 }), "RESPOSTA_INVALIDA"],
    [Response.json({ text: "   " }), "TRANSCRICAO_VAZIA"],
    [Response.json({}), "TRANSCRICAO_VAZIA"],
  ];
  for (const [resposta, codigo] of casos) {
    const f = fetchFalso(resposta);
    assert.deepEqual(await transcrever(arquivos.oggOpus(3), "audio/ogg", { fetch: f.fetch }), { erro: codigo, transitorio: false });
  }
});

test("o corpo da resposta é lido antes de devolver (a conexão com a MiniMax só fecha no fim do corpo)", async () => {
  let corpoLido = false;
  const resposta = new Response(
    new ReadableStream({
      pull(controller) {
        controller.enqueue(new TextEncoder().encode(JSON.stringify({ text: "ok" })));
        controller.close();
        corpoLido = true;
      },
    })
  );
  const f = fetchFalso(resposta);
  const r = await transcrever(arquivos.oggOpus(3), "audio/ogg", { fetch: f.fetch });
  assert.deepEqual(r, { texto: "ok" });
  assert.equal(corpoLido, true);
});
