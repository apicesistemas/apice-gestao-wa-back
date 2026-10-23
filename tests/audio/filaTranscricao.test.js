// @ts-check
// Fila de transcrição (concorrência 1, uma nova tentativa em falha transitória) com a MiniMax e o
// back mockados no mesmo `fetch` falso: nenhuma chamada real. Usa o transcricaoService e o
// transcricaoInternoClient de verdade, então cobre o caminho áudio → MiniMax → `/interno/transcricao`.
const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { criarFilaTranscricao } = require("../../src/audio/filaTranscricao");
const arquivos = require("../helpers/arquivosMidia");
const { mp4ComAudio, lerAdts, AMOSTRAS_PADRAO } = require("../helpers/mp4Falso");

const VARS = ["CRM_BACK_URL", "CRM_BACK_SERVICE_TOKEN", "MINIMAX_API_KEY"];
/** @type {Record<string, string | undefined>} */
let envOriginal = {};
const fetchOriginal = globalThis.fetch;

beforeEach(() => {
  envOriginal = Object.fromEntries(VARS.map((nome) => [nome, process.env[nome]]));
  process.env.CRM_BACK_URL = "http://back.local:3500";
  process.env.CRM_BACK_SERVICE_TOKEN = "token-wa-para-back";
  process.env.MINIMAX_API_KEY = "chave-minimax-de-teste";
});

afterEach(() => {
  globalThis.fetch = fetchOriginal;
  for (const nome of VARS) {
    if (envOriginal[nome] === undefined) delete process.env[nome];
    else process.env[nome] = envOriginal[nome];
  }
});

const pausa = (/** @type {number} */ ms) => new Promise((resolve) => setTimeout(resolve, ms));
const erroTimeout = () => Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });

/**
 * `fetch` falso: a MiniMax responde com `minimax(n)` (n = número da chamada, a partir de 0) depois
 * de uma pausa, contando chamadas simultâneas; o back responde 200 e guarda o corpo.
 * @param {{ minimax?: (n: number, form: FormData) => Response | Error | Promise<Response | Error>, msMinimax?: number }} [opcoes]
 */
function instalarFetch({ minimax = () => Response.json({ text: "transcrito" }), msMinimax = 5 } = {}) {
  const estado = {
    /** @type {FormData[]} */
    chamadasMinimax: [],
    /** @type {any[]} */
    registros: [],
    ativas: 0,
    maxAtivas: 0,
  };
  globalThis.fetch = /** @type {typeof fetch} */ (
    async (url, init) => {
      const u = String(url);
      if (u.includes("minimax")) {
        const n = estado.chamadasMinimax.length;
        const form = /** @type {FormData} */ (init?.body);
        estado.chamadasMinimax.push(form);
        estado.ativas += 1;
        estado.maxAtivas = Math.max(estado.maxAtivas, estado.ativas);
        try {
          await pausa(msMinimax);
          const r = await minimax(n, form);
          if (r instanceof Error) throw r;
          return r;
        } finally {
          estado.ativas -= 1;
        }
      }
      if (u === "http://back.local:3500/interno/transcricao") {
        estado.registros.push(JSON.parse(String(init?.body)));
        return Response.json({ msg: "Transcrição registrada." });
      }
      throw new Error(`URL inesperada no teste: ${u}`);
    }
  );
  return estado;
}

const CONTEXTO = { hash_empresa: "hash-a", cod_equipe: "7" };
/** @param {Partial<import("../../src/audio/filaTranscricao").TarefaTranscricao>} [extra] */
const tarefaAudio = (extra = {}) => ({
  mensagem_wa_id: "3EB0PTT",
  buffer: arquivos.oggOpus(4),
  mimetype: "audio/ogg",
  duracao_segundos: 4,
  contexto: CONTEXTO,
  ...extra,
});

/** @type {number[]} */
let esperas = [];
const filaDeTeste = () => {
  esperas = [];
  return criarFilaTranscricao({ esperar: async (ms) => void esperas.push(ms) });
};

test("um áudio PTT gera a transcrição enviada ao back (MiniMax mockada)", async () => {
  const estado = instalarFetch({ minimax: () => Response.json({ text: " o boleto não abre " }) });
  const fila = filaDeTeste();

  const resultado = await fila.enfileirarTranscricao(tarefaAudio());

  assert.deepEqual(resultado, { status: "CONCLUIDA", texto: "o boleto não abre" });
  assert.equal(estado.chamadasMinimax.length, 1);
  const arquivo = /** @type {File} */ (estado.chamadasMinimax[0].get("file"));
  assert.equal(arquivo.type, "audio/ogg");
  assert.deepEqual(estado.registros, [
    { hash_empresa: "hash-a", cod_equipe: 7, mensagem_wa_id: "3EB0PTT", status: "CONCLUIDA", texto: "o boleto não abre" },
  ]);
});

test("um vídeo tem a trilha de áudio extraída antes da transcrição", async () => {
  const estado = instalarFetch({ minimax: () => Response.json({ text: "fala do vídeo" }) });
  const fila = filaDeTeste();
  const video = mp4ComAudio({ moovNoFim: true });

  const resultado = await fila.enfileirarTranscricao(tarefaAudio({ mensagem_wa_id: "3EB0VIDEO", buffer: video, mimetype: "video/mp4", duracao_segundos: 3 }));

  assert.deepEqual(resultado, { status: "CONCLUIDA", texto: "fala do vídeo" });
  const arquivo = /** @type {File} */ (estado.chamadasMinimax[0].get("file"));
  assert.equal(arquivo.type, "audio/aac", "a MiniMax recebe a trilha de áudio, não o MP4");
  const enviado = Buffer.from(await arquivo.arrayBuffer());
  assert.ok(!enviado.includes(Buffer.from("ftyp", "latin1")));
  assert.deepEqual(
    lerAdts(enviado).map((q) => q.conteudo),
    AMOSTRAS_PADRAO
  );
  assert.deepEqual(estado.registros, [{ hash_empresa: "hash-a", cod_equipe: 7, mensagem_wa_id: "3EB0VIDEO", status: "CONCLUIDA", texto: "fala do vídeo" }]);
});

test("uma falha da MiniMax (429/timeout) envia status PENDENTE depois de uma única nova tentativa", async () => {
  for (const falha of [() => new Response("conn limit (1041)", { status: 429 }), erroTimeout]) {
    const estado = instalarFetch({ minimax: () => falha() });
    const fila = filaDeTeste();
    const resultado = await fila.enfileirarTranscricao(tarefaAudio());
    assert.deepEqual(resultado, { status: "PENDENTE", texto: null });
    assert.equal(estado.chamadasMinimax.length, 2, "uma chamada + uma nova tentativa, nunca mais");
    assert.deepEqual(esperas, [2000], "espera antes da nova tentativa");
    assert.deepEqual(estado.registros, [{ hash_empresa: "hash-a", cod_equipe: 7, mensagem_wa_id: "3EB0PTT", status: "PENDENTE", texto: null }]);
  }
});

test("a nova tentativa que dá certo registra CONCLUIDA", async () => {
  const estado = instalarFetch({ minimax: (n) => (n === 0 ? new Response("limite", { status: 429 }) : Response.json({ text: "segunda vez" })) });
  const resultado = await filaDeTeste().enfileirarTranscricao(tarefaAudio());
  assert.deepEqual(resultado, { status: "CONCLUIDA", texto: "segunda vez" });
  assert.equal(estado.chamadasMinimax.length, 2);
  assert.equal(estado.registros[0].status, "CONCLUIDA");
});

test("erro definitivo (formato não suportado, 400) envia FALHOU sem nova tentativa", async () => {
  const estado = instalarFetch({ minimax: () => new Response("arquivo inválido", { status: 400 }) });
  const fila = filaDeTeste();
  const amr = Buffer.concat([Buffer.from("#!AMR\n", "latin1"), Buffer.alloc(32)]);

  assert.deepEqual(await fila.enfileirarTranscricao(tarefaAudio({ mensagem_wa_id: "3EB0AMR", buffer: amr, mimetype: "audio/amr" })), { status: "FALHOU", texto: null });
  assert.equal(estado.chamadasMinimax.length, 0);
  assert.deepEqual(await fila.enfileirarTranscricao(tarefaAudio({ mensagem_wa_id: "3EB0400" })), { status: "FALHOU", texto: null });
  assert.equal(estado.chamadasMinimax.length, 1);
  assert.deepEqual(esperas, []);
  assert.deepEqual(
    estado.registros.map((r) => [r.mensagem_wa_id, r.status, r.texto]),
    [
      ["3EB0AMR", "FALHOU", null],
      ["3EB0400", "FALHOU", null],
    ]
  );
});

test("sem a chave da MiniMax a transcrição fica PENDENTE, sem chamar a API nem tentar de novo", async () => {
  delete process.env.MINIMAX_API_KEY;
  const estado = instalarFetch();
  assert.deepEqual(await filaDeTeste().enfileirarTranscricao(tarefaAudio()), { status: "PENDENTE", texto: null });
  assert.equal(estado.chamadasMinimax.length, 0);
  assert.deepEqual(esperas, []);
  assert.equal(estado.registros[0].status, "PENDENTE");
});

test("seis áudios simultâneos são processados em série, sem chamadas paralelas", async () => {
  const estado = instalarFetch({ minimax: (n) => Response.json({ text: `áudio ${n + 1}` }), msMinimax: 15 });
  const fila = filaDeTeste();
  const ids = ["A1", "A2", "A3", "A4", "A5", "A6"];

  const resultados = await Promise.all(ids.map((id) => fila.enfileirarTranscricao(tarefaAudio({ mensagem_wa_id: id }))));

  assert.equal(estado.chamadasMinimax.length, 6);
  assert.equal(estado.maxAtivas, 1, "nunca duas chamadas à MiniMax ao mesmo tempo");
  assert.deepEqual(
    resultados.map((r) => r.texto),
    ["áudio 1", "áudio 2", "áudio 3", "áudio 4", "áudio 5", "áudio 6"]
  );
  assert.deepEqual(
    estado.registros.map((r) => [r.mensagem_wa_id, r.texto]).sort(),
    ids.map((id, i) => [id, `áudio ${i + 1}`])
  );
});

test("a espera da nova tentativa segura a vez: o próximo áudio não chama a MiniMax no meio dela", async () => {
  /** @type {string[]} */
  const ordem = [];
  instalarFetch({
    minimax: (n, form) => {
      ordem.push(`minimax:${n}`);
      return n === 0 ? new Response("limite", { status: 429 }) : Response.json({ text: "ok" });
    },
    msMinimax: 1,
  });
  const fila = criarFilaTranscricao({
    esperar: async () => {
      ordem.push("espera");
      await pausa(10);
    },
  });
  await Promise.all([fila.enfileirarTranscricao(tarefaAudio({ mensagem_wa_id: "B1" })), fila.enfileirarTranscricao(tarefaAudio({ mensagem_wa_id: "B2" }))]);
  assert.deepEqual(ordem, ["minimax:0", "espera", "minimax:1", "minimax:2"]);
});

test("uma falha ao registrar no back (rota ainda inexistente) só loga: a fila nunca rejeita e segue", async () => {
  const estado = instalarFetch();
  globalThis.fetch = /** @type {typeof fetch} */ (
    async (url, init) => {
      if (String(url).includes("minimax")) {
        estado.chamadasMinimax.push(/** @type {FormData} */ (init?.body));
        return Response.json({ text: "texto" });
      }
      return new Response(JSON.stringify({ msg: "Rota não encontrada." }), { status: 404 });
    }
  );
  const fila = filaDeTeste();
  assert.deepEqual(await fila.enfileirarTranscricao(tarefaAudio({ mensagem_wa_id: "C1" })), { status: "CONCLUIDA", texto: "texto" });
  assert.deepEqual(await fila.enfileirarTranscricao(tarefaAudio({ mensagem_wa_id: "C2" })), { status: "CONCLUIDA", texto: "texto" });
  assert.equal(estado.chamadasMinimax.length, 2);
});

test("um transcrever que lança (defesa) vira FALHOU e não trava a fila", async () => {
  /** @type {any[]} */
  const registros = [];
  let n = 0;
  const fila = criarFilaTranscricao({
    esperar: async () => {},
    transcrever: async () => {
      n += 1;
      if (n === 1) throw new Error("bug inesperado");
      return { texto: "depois do bug" };
    },
    registrarTranscricao: async (id, resultado) => void registros.push([id, resultado.status]),
  });
  assert.deepEqual(await fila.enfileirarTranscricao(tarefaAudio({ mensagem_wa_id: "D1" })), { status: "FALHOU", texto: null });
  assert.deepEqual(await fila.enfileirarTranscricao(tarefaAudio({ mensagem_wa_id: "D2" })), { status: "CONCLUIDA", texto: "depois do bug" });
  assert.deepEqual(registros, [
    ["D1", "FALHOU"],
    ["D2", "CONCLUIDA"],
  ]);
});

test("a tarefa de um vídeo guarda só a trilha de áudio: o buffer enfileirado é menor que o vídeo e não o compartilha", async () => {
  /** @type {{ buffer: Buffer, mimetype: string }[]} */
  const recebidos = [];
  /** @type {any[]} */
  const registros = [];
  const fila = criarFilaTranscricao({
    esperar: async () => {},
    transcrever: async (buffer, mimetype) => {
      recebidos.push({ buffer, mimetype });
      return recebidos.length === 1 ? { erro: "MINIMAX_LIMITE", transitorio: true } : { texto: "fala do vídeo" };
    },
    registrarTranscricao: async (id, resultado) => void registros.push([id, resultado.status]),
  });
  const video = mp4ComAudio({ moovNoFim: true });

  const promessa = fila.enfileirarTranscricao(tarefaAudio({ mensagem_wa_id: "V1", buffer: video, mimetype: "video/mp4", duracao_segundos: 3 }));
  // Depois de enfileirar, o vídeo inteiro não pode mais estar na tarefa: nem na nova tentativa.
  assert.deepEqual(await promessa, { status: "CONCLUIDA", texto: "fala do vídeo" });
  assert.equal(recebidos.length, 2);
  for (const { buffer, mimetype } of recebidos) {
    assert.equal(mimetype, "audio/aac");
    assert.ok(buffer.length < video.length, "a trilha é menor que o vídeo");
    assert.notEqual(buffer.buffer, video.buffer, "não compartilha a memória do vídeo");
    assert.ok(!buffer.includes(Buffer.from("ftyp", "latin1")));
    assert.deepEqual(
      lerAdts(buffer).map((q) => q.conteudo),
      AMOSTRAS_PADRAO
    );
  }
  assert.equal(recebidos[0].buffer, recebidos[1].buffer, "as duas tentativas usam a mesma trilha");
  assert.deepEqual(registros, [["V1", "CONCLUIDA"]]);
});

test("vídeo sem trilha de áudio aproveitável (sem áudio ou contêiner inválido) vira FALHOU na hora, sem chamar a MiniMax", async () => {
  const estado = instalarFetch();
  const fila = filaDeTeste();
  const semAudio = mp4ComAudio({ comAudio: false });
  const truncado = mp4ComAudio({ moovNoFim: true }).subarray(0, 40);

  assert.deepEqual(await fila.enfileirarTranscricao(tarefaAudio({ mensagem_wa_id: "V2", buffer: semAudio, mimetype: "video/mp4" })), { status: "FALHOU", texto: null });
  assert.deepEqual(await fila.enfileirarTranscricao(tarefaAudio({ mensagem_wa_id: "V3", buffer: truncado, mimetype: "video/3gpp" })), { status: "FALHOU", texto: null });
  assert.equal(estado.chamadasMinimax.length, 0);
  assert.deepEqual(esperas, []);
  assert.deepEqual(
    estado.registros.map((r) => [r.mensagem_wa_id, r.status, r.texto]),
    [
      ["V2", "FALHOU", null],
      ["V3", "FALHOU", null],
    ]
  );
});

test("o áudio (ogg, M4A) segue inteiro na tarefa: só o vídeo é reduzido à trilha", async () => {
  /** @type {Buffer[]} */
  const recebidos = [];
  const fila = criarFilaTranscricao({
    transcrever: async (buffer) => (recebidos.push(buffer), { texto: "ok" }),
    registrarTranscricao: async () => {},
  });
  const ogg = arquivos.oggOpus(2);
  await fila.enfileirarTranscricao(tarefaAudio({ buffer: ogg }));
  assert.equal(recebidos[0], ogg);
});

test("o vídeo e a tarefa original são liberados da memória enquanto a tarefa espera a vez na fila", async () => {
  // gc() sem --expose-gc: o V8 liga o flag em tempo de execução e o `vm` entrega a função.
  require("node:v8").setFlagsFromString("--expose-gc");
  const gc = require("node:vm").runInNewContext("gc");
  /** @type {() => void} */
  let liberarPrimeira = () => {};
  const portao = new Promise((resolve) => (liberarPrimeira = () => resolve(undefined)));
  /** @type {Buffer[]} */
  const recebidos = [];
  const fila = criarFilaTranscricao({
    esperar: async () => {},
    transcrever: async (buffer) => {
      recebidos.push(buffer);
      if (recebidos.length === 1) await portao; // a 1ª segura a fila; a do vídeo espera atrás dela
      return { texto: "ok" };
    },
    registrarTranscricao: async () => {},
  });

  // O vídeo e a tarefa só existem dentro desta função: ao voltar, o teste não guarda nenhuma referência.
  const enfileirarVideo = () => {
    const video = mp4ComAudio({ moovNoFim: true });
    const tarefa = tarefaAudio({ mensagem_wa_id: "LIB2", buffer: video, mimetype: "video/mp4" });
    const refs = { video: new WeakRef(video), tarefa: new WeakRef(tarefa) };
    return { refs, promessa: fila.enfileirarTranscricao(tarefa) };
  };

  const primeira = fila.enfileirarTranscricao(tarefaAudio({ mensagem_wa_id: "LIB1" }));
  const { refs, promessa } = enfileirarVideo();
  await pausa(10); // a 1ª já está na MiniMax (no portão); o WeakRef só solta depois do job atual
  for (let i = 0; i < 5; i += 1) {
    gc();
    await pausa(5);
  }
  assert.equal(recebidos.length, 1, "o vídeo ainda espera a vez");
  assert.equal(refs.video.deref(), undefined, "o vídeo inteiro não fica retido enquanto espera");
  assert.equal(refs.tarefa.deref(), undefined, "a tarefa original (com o vídeo) não fica retida enquanto espera");

  liberarPrimeira();
  assert.deepEqual(await Promise.all([primeira, promessa]), [
    { status: "CONCLUIDA", texto: "ok" },
    { status: "CONCLUIDA", texto: "ok" },
  ]);
  assert.equal(recebidos[1].length > 0 && recebidos[1].includes(Buffer.from("ftyp", "latin1")), false, "a MiniMax recebe a trilha, não o vídeo");
});
