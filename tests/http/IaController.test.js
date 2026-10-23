// @ts-check
// POST /ia/sugestao-ticket (Fase 31, Task 31.1, contrato D1). Serviço da MiniMax com `fetch` falso,
// Baileys falso instalado só para provar que a rota nunca o toca (nenhum sendMessage, nenhuma instância),
// e nenhum fetch para o back. Nada de contexto, resposta da IA ou chave no console.
const { test, before, after, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const baileysFalso = require("../helpers/baileysFalso");

baileysFalso.instalarBaileysFalso();
const { registrarControllers, CONTROLLERS } = require("../../src/http");
const IaControllerPadrao = require("../../src/http/IaController");
const { criarIaController, ALLOWLIST_IA } = IaControllerPadrao;
const { criarPortaoIa } = require("../../src/ia/portaoIa");
const { criarDesligamento, MSG_REINICIANDO } = require("../../src/utils/desligamento");
const { criarApp } = require("../../src/index");

const TOKEN = "token-back-para-wa";
const CHAVE = "chave-minimax-de-teste";
const SEGREDO = "segredo-do-cliente-no-contexto";
const TIPOS = [
  { cod_tipo_resolucao: 3, nome: "Orientação ao cliente" },
  { cod_tipo_resolucao: 9, nome: "Correção de cadastro" },
];
const VALIDO = { campos: ["titulo", "descricao"], contexto: `[01/01 10:00] Cliente: ${SEGREDO}`, prazo_ms: 5000 };

const originais = { log: console.log, error: console.error, warn: console.warn, fetch: globalThis.fetch };
const ambiente = { token: process.env.WA_BACK_ADMIN_TOKEN, chave: process.env.MINIMAX_API_KEY };

/** @type {http.Server} */
let servidor;
let baseUrl = "";
let desligamento = criarDesligamento();
/** @type {ReturnType<typeof criarPortaoIa>} */
let portao;
/** @type {string[]} */
let saida = [];
/** @type {string[]} */
let fetchsDeSaida = [];
/** @type {{ url: string, init: any }[]} */
let chamadasMinimax = [];
/** @type {(init: any) => Promise<Response>} */
let minimax = async () => chat('{"titulo":"Erro ao emitir nota","descricao":"O cliente não consegue emitir."}');

/** @param {string} conteudo */
const chat = (conteudo) => Response.json({ choices: [{ message: { content: conteudo } }], base_resp: { status_code: 0 } });

before(async () => {
  process.env.WA_BACK_ADMIN_TOKEN = TOKEN;
  const app = express();
  /** @param {any} req @param {any} res @param {any} next */
  const delegar = (req, res, next) => {
    const sub = express();
    // O `express.json` global do app pula /ia/, como no src/index.js; aqui o controller lê o próprio corpo.
    registrarControllers(sub, [
      criarIaController({
        desligamento,
        portao,
        fetch: /** @type {typeof fetch} */ (async (url, init) => {
          chamadasMinimax.push({ url: String(url), init });
          return minimax(init);
        }),
      }),
    ]);
    sub(req, res, next);
  };
  app.use(delegar);
  servidor = http.createServer(app);
  await new Promise((resolve) => servidor.listen(0, "127.0.0.1", () => resolve(undefined)));
  const endereco = servidor.address();
  assert.ok(endereco && typeof endereco === "object");
  baseUrl = `http://127.0.0.1:${endereco.port}`;
  // Espião de qualquer fetch que não seja para o servidor de teste (inclui o back).
  globalThis.fetch = /** @type {any} */ (
    (/** @type {any} */ url, /** @type {any} */ init) => {
      const alvo = String(url);
      if (!alvo.startsWith(baseUrl)) fetchsDeSaida.push(alvo);
      return originais.fetch(url, init);
    }
  );
});
after(async () => {
  globalThis.fetch = originais.fetch;
  await new Promise((resolve) => servidor.close(() => resolve(undefined)));
  for (const [nome, valor] of Object.entries({ WA_BACK_ADMIN_TOKEN: ambiente.token, MINIMAX_API_KEY: ambiente.chave })) {
    if (valor === undefined) delete process.env[nome];
    else process.env[nome] = valor;
  }
});
beforeEach(() => {
  desligamento = criarDesligamento();
  portao = criarPortaoIa(1);
  process.env.MINIMAX_API_KEY = CHAVE;
  chamadasMinimax = [];
  fetchsDeSaida = [];
  saida = [];
  minimax = async () => chat('{"titulo":"Erro ao emitir nota","descricao":"O cliente não consegue emitir."}');
  for (const nivel of /** @type {const} */ (["log", "error", "warn"])) console[nivel] = (...a) => void saida.push(a.join(" "));
});
afterEach(() => {
  Object.assign(console, { log: originais.log, error: originais.error, warn: originais.warn });
  assert.equal(baileysFalso.sockets.length, 0, "a rota nunca cria nem usa socket do Baileys (nada de sendMessage)");
  assert.deepEqual(fetchsDeSaida, [], "a rota não chama o back nem outro serviço");
  const vazou = saida.filter((l) => l.includes(SEGREDO) || l.includes(CHAVE) || l.includes("Erro ao emitir nota") || l.includes("O cliente não consegue"));
  assert.deepEqual(vazou, [], "nenhum log leva o contexto, a resposta da IA ou a chave");
});

/**
 * @param {unknown} corpo
 * @param {{ token?: string | null, bruto?: string, tipo?: string }} [opcoes]
 */
async function postar(corpo, { token = TOKEN, bruto, tipo = "application/json" } = {}) {
  const resposta = await originais.fetch(`${baseUrl}/ia/sugestao-ticket`, {
    method: "POST",
    headers: { "Content-Type": tipo, ...(token ? { "X-Internal-Token": token } : {}) },
    body: bruto ?? JSON.stringify(corpo),
  });
  const texto = await resposta.text();
  return { status: resposta.status, retryAfter: resposta.headers.get("retry-after"), corpo: texto ? JSON.parse(texto) : null };
}

test("200 só com os campos pedidos, chamando a MiniMax uma vez com o prazo do pedido", async () => {
  const r = await postar(VALIDO);
  assert.equal(r.status, 200);
  assert.deepEqual(r.corpo, { titulo: "Erro ao emitir nota", descricao: "O cliente não consegue emitir." });
  assert.equal(chamadasMinimax.length, 1);
  const corpoMinimax = JSON.parse(chamadasMinimax[0].init.body);
  assert.match(corpoMinimax.messages[1].content, new RegExp(SEGREDO));
  assert.equal(chamadasMinimax[0].init.headers.Authorization, `Bearer ${CHAVE}`);
});

test("campo não pedido que a IA devolve é descartado; tipo fora da lista vira null; título longo cortado", async () => {
  minimax = async () => chat(JSON.stringify({ titulo: "palavra ".repeat(40), descricao: "   ", explicacao: "nao pedida", cod_tipo_resolucao: 77 }));
  const r = await postar({ campos: ["titulo", "descricao", "cod_tipo_resolucao"], contexto: "x", tipos_resolucao: TIPOS, prazo_ms: 5000 });
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.corpo).sort(), ["cod_tipo_resolucao", "titulo"]);
  assert.equal(r.corpo.cod_tipo_resolucao, null);
  assert.ok(r.corpo.titulo.length <= 150 && r.corpo.titulo.endsWith("palavra"));
});

test("tipo da lista e explicação passam", async () => {
  minimax = async () => chat('```json\n{"cod_tipo_resolucao":9,"explicacao":"Corrigimos o cadastro do cliente."}\n```');
  const r = await postar({ campos: ["cod_tipo_resolucao", "explicacao"], contexto: "x", tipos_resolucao: TIPOS, minimo_caracteres_explicacao: 10, prazo_ms: 5000 });
  assert.deepEqual(r.corpo, { cod_tipo_resolucao: 9, explicacao: "Corrigimos o cadastro do cliente." });
});

test("nenhum campo útil → 502 RESPOSTA_INVALIDA; recusa 4xx do provedor → 502", async () => {
  minimax = async () => chat("{}");
  const vazio = await postar(VALIDO);
  assert.equal(vazio.status, 502);
  assert.deepEqual(vazio.corpo, { msg: "A resposta da IA não pôde ser usada.", codigo: "RESPOSTA_INVALIDA" });
  minimax = async () => new Response("recusou", { status: 400 });
  const recusa = await postar(VALIDO);
  assert.equal(recusa.status, 502);
  assert.equal(recusa.corpo.codigo, "RESPOSTA_INVALIDA");
});

test("sem MINIMAX_API_KEY, 429, 5xx e erro de rede → 503 IA_INDISPONIVEL", async () => {
  delete process.env.MINIMAX_API_KEY;
  const semChave = await postar(VALIDO);
  assert.equal(semChave.status, 503);
  assert.deepEqual(semChave.corpo, { msg: "IA indisponível no momento.", codigo: "IA_INDISPONIVEL" });
  assert.equal(semChave.retryAfter, null);
  assert.equal(chamadasMinimax.length, 0);
  process.env.MINIMAX_API_KEY = CHAVE;

  for (const resposta of [new Response("limite", { status: 429 }), new Response("erro", { status: 500 }), new Response("erro", { status: 502 })]) {
    minimax = async () => resposta;
    const r = await postar(VALIDO);
    assert.equal(r.status, 503);
    assert.equal(r.corpo.codigo, "IA_INDISPONIVEL");
  }
  minimax = async () => {
    throw new TypeError("fetch failed");
  };
  const rede = await postar(VALIDO);
  assert.equal(rede.status, 503);
  assert.equal(rede.corpo.codigo, "IA_INDISPONIVEL");
});

test("prazo estourado na MiniMax → 504 PRAZO", async () => {
  minimax = async () => {
    throw Object.assign(new Error("timeout"), { name: "TimeoutError" });
  };
  const r = await postar(VALIDO);
  assert.equal(r.status, 504);
  assert.deepEqual(r.corpo, { msg: "A IA não respondeu no prazo.", codigo: "PRAZO" });
});

test("allowlist: chave desconhecida (inclusive hash_empresa, transcricao, nota_interna, sugestao_ia) → 400 sem chamar a MiniMax", async () => {
  assert.deepEqual([...ALLOWLIST_IA].sort(), ["campos", "contexto", "minimo_caracteres_explicacao", "prazo_ms", "taxonomia", "tipos_resolucao"]);
  for (const campo of ["hash_empresa", "transcricao", "nota_interna", "sugestao_ia", "explicacao", "cod_equipe", "qualquer"]) {
    const r = await postar({ ...VALIDO, [campo]: "x" });
    assert.equal(r.status, 400, campo);
    assert.match(r.corpo.msg, /Campo não permitido/);
  }
  assert.equal(chamadasMinimax.length, 0);
});

test("validação do corpo: cada violação → 400 sem chamar a MiniMax", async () => {
  const ok = { ...VALIDO };
  const comTipo = { campos: ["cod_tipo_resolucao"], contexto: "x", tipos_resolucao: TIPOS, prazo_ms: 5000 };
  const comExplicacao = { campos: ["explicacao"], contexto: "x", minimo_caracteres_explicacao: 10, prazo_ms: 5000 };
  const ruins = [
    { ...ok, campos: [] },
    { ...ok, campos: "titulo" },
    { ...ok, campos: ["titulo", "titulo"] },
    { ...ok, campos: ["titulo", "descricao", "cod_tipo_resolucao", "explicacao", "titulo"] },
    { ...ok, campos: ["nota_interna"] },
    { ...ok, campos: [3] },
    { ...ok, contexto: "" },
    { ...ok, contexto: 7 },
    { ...ok, contexto: "a".repeat(200001) },
    { ...ok, prazo_ms: 999 },
    { ...ok, prazo_ms: 120001 },
    { ...ok, prazo_ms: 5000.5 },
    { ...ok, prazo_ms: "5000" },
    { campos: ok.campos, contexto: ok.contexto },
    { ...comTipo, tipos_resolucao: undefined },
    { ...comTipo, tipos_resolucao: [] },
    { ...comTipo, tipos_resolucao: "x" },
    { ...comTipo, tipos_resolucao: Array.from({ length: 101 }, (_, i) => ({ cod_tipo_resolucao: i + 1, nome: "T" })) },
    { ...comTipo, tipos_resolucao: [null] },
    { ...comTipo, tipos_resolucao: [[1]] },
    { ...comTipo, tipos_resolucao: [{ cod_tipo_resolucao: 0, nome: "T" }] },
    { ...comTipo, tipos_resolucao: [{ cod_tipo_resolucao: 1.5, nome: "T" }] },
    { ...comTipo, tipos_resolucao: [{ cod_tipo_resolucao: 1, nome: "" }] },
    { ...comTipo, tipos_resolucao: [{ cod_tipo_resolucao: 1, nome: "n".repeat(101) }] },
    { ...comTipo, tipos_resolucao: [{ cod_tipo_resolucao: 1 }] },
    { ...comTipo, tipos_resolucao: [{ cod_tipo_resolucao: 1, nome: "T", hash_empresa: "h" }] },
    { ...comExplicacao, minimo_caracteres_explicacao: undefined },
    { ...comExplicacao, minimo_caracteres_explicacao: 0 },
    { ...comExplicacao, minimo_caracteres_explicacao: 5001 },
    { ...comExplicacao, minimo_caracteres_explicacao: "10" },
    { ...ok, minimo_caracteres_explicacao: 0 },
  ];
  for (const corpo of ruins) {
    const r = await postar(corpo);
    assert.equal(r.status, 400, JSON.stringify(corpo).slice(0, 120));
    assert.equal(typeof r.corpo.msg, "string");
  }
  for (const bruto of ["[]", "null", "3", '"texto"']) assert.equal((await postar(null, { bruto })).status, 400, bruto);
  assert.equal((await postar(null, { bruto: "{quebrado" })).status, 400);
  assert.equal((await postar(null, { bruto: "{}", tipo: "text/plain" })).status, 400, "sem JSON no content-type, o corpo vem vazio");
  assert.equal(chamadasMinimax.length, 0);
  // Limites exatos aceitos.
  minimax = async () => chat('{"cod_tipo_resolucao":3,"explicacao":"Texto da explicação."}');
  assert.equal((await postar({ ...comTipo, contexto: "a".repeat(200000), prazo_ms: 1000 })).status, 200);
  assert.equal((await postar({ ...comExplicacao, minimo_caracteres_explicacao: 5000, prazo_ms: 120000 })).status, 200);
});

test("corpo acima do teto técnico de 512 kb → 400, sem chamar a MiniMax", async () => {
  const r = await postar({ ...VALIDO, contexto: "é".repeat(300000) });
  assert.equal(r.status, 400);
  assert.match(r.corpo.msg, /grande demais/);
  assert.equal(chamadasMinimax.length, 0);
  // Um contexto de 200 000 caracteres ASCII (acima dos 100 kb do padrão do Express) passa.
  assert.equal((await postar({ ...VALIDO, contexto: "a".repeat(200000) })).status, 200);
});

test("401 sem token ou com token errado, antes de ler o corpo e sem chamar a MiniMax", async () => {
  assert.equal((await postar(VALIDO, { token: null })).status, 401);
  assert.equal((await postar(VALIDO, { token: "errado" })).status, 401);
  assert.equal((await postar(null, { token: null, bruto: "{quebrado" })).status, 401, "token vem antes do corpo");
  assert.equal(chamadasMinimax.length, 0);
});

test("durante o desligamento: 503 + Retry-After sem codigo, sem chamar a MiniMax; a requisição em andamento termina", async () => {
  /** @type {() => void} */
  let liberar = () => {};
  minimax = () => new Promise((resolve) => (liberar = () => resolve(chat('{"titulo":"Terminou"}'))));
  const emAndamento = postar({ ...VALIDO, campos: ["titulo"] });
  while (chamadasMinimax.length === 0) await new Promise((r) => setTimeout(r, 5));
  desligamento.marcarEncerrando();
  const recusada = await postar(VALIDO);
  assert.equal(recusada.status, 503);
  assert.deepEqual(recusada.corpo, { msg: MSG_REINICIANDO });
  assert.ok(Number(recusada.retryAfter) > 0);
  assert.equal(chamadasMinimax.length, 1, "o pedido recusado não chegou à MiniMax");
  liberar();
  const concluida = await emAndamento;
  assert.equal(concluida.status, 200);
  assert.deepEqual(concluida.corpo, { titulo: "Terminou" });
});

test("concorrência 1: a 2ª espera a 1ª; a espera conta no prazo (504 se passar) e um erro não trava a próxima", async () => {
  /** @type {(() => void)[]} */
  const liberar = [];
  minimax = () => new Promise((resolve) => liberar.push(() => resolve(chat('{"titulo":"Primeira"}'))));
  const primeira = postar({ ...VALIDO, campos: ["titulo"] });
  while (chamadasMinimax.length < 1) await new Promise((r) => setTimeout(r, 5));

  // A 2ª, com prazo curto, desiste na fila: 504 e a MiniMax só foi chamada uma vez.
  const curta = await postar({ ...VALIDO, prazo_ms: 1000 });
  assert.equal(curta.status, 504);
  assert.equal(curta.corpo.codigo, "PRAZO");
  assert.equal(chamadasMinimax.length, 1);

  // A 3ª, com prazo folgado, espera e roda depois da 1ª.
  minimax = async () => chat('{"titulo":"Terceira"}');
  const terceira = postar({ ...VALIDO, campos: ["titulo"] });
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(chamadasMinimax.length, 1, "a 3ª ainda espera a vaga");
  liberar[0]();
  assert.deepEqual((await primeira).corpo, { titulo: "Primeira" });
  assert.deepEqual((await terceira).corpo, { titulo: "Terceira" });

  // Erro na MiniMax não trava a vaga.
  minimax = async () => new Response("erro", { status: 500 });
  assert.equal((await postar(VALIDO)).status, 503);
  minimax = async () => chat('{"titulo":"Depois do erro"}');
  assert.deepEqual((await postar({ ...VALIDO, campos: ["titulo"] })).corpo, { titulo: "Depois do erro" });
});

test("imprevisto no portão vira 500 genérico, sem vazar o erro", async () => {
  const quebrado = { executar: async () => { throw new Error(`explodiu com ${SEGREDO}`); } };
  const app = express();
  registrarControllers(app, [criarIaController({ desligamento: criarDesligamento(), portao: quebrado })]);
  const srv = http.createServer(app);
  await new Promise((resolve) => srv.listen(0, "127.0.0.1", () => resolve(undefined)));
  try {
    const { port } = /** @type {import("node:net").AddressInfo} */ (srv.address());
    const resposta = await originais.fetch(`http://127.0.0.1:${port}/ia/sugestao-ticket`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Internal-Token": TOKEN },
      body: JSON.stringify(VALIDO),
    });
    assert.equal(resposta.status, 500);
    const corpo = await resposta.json();
    assert.deepEqual(corpo, { msg: "Erro interno ao gerar a sugestão." });
  } finally {
    await new Promise((resolve) => srv.close(() => resolve(undefined)));
  }
});

test("o log leva só os campos, o código e os ms", async () => {
  await postar({ ...VALIDO, campos: ["titulo", "descricao"] });
  assert.ok(saida.some((l) => /^\[IA\] Sugestão do ticket: campos=titulo,descricao codigo=OK ms=\d+$/.test(l)), saida.join("|"));
  minimax = async () => new Response("limite", { status: 429 });
  await postar(VALIDO);
  assert.ok(saida.some((l) => /codigo=MINIMAX_LIMITE ms=\d+$/.test(l)));
});

test("sem portão injetado, o controller usa o portão do processo e o serviço real (fetch global)", async () => {
  const app = express();
  registrarControllers(app, [criarIaController({ desligamento: criarDesligamento() })]);
  const srv = http.createServer(app);
  await new Promise((resolve) => srv.listen(0, "127.0.0.1", () => resolve(undefined)));
  try {
    const { port } = /** @type {import("node:net").AddressInfo} */ (srv.address());
    delete process.env.MINIMAX_API_KEY; // sem chave: não sai da máquina
    const resposta = await originais.fetch(`http://127.0.0.1:${port}/ia/sugestao-ticket`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Internal-Token": TOKEN },
      body: JSON.stringify(VALIDO),
    });
    assert.equal(resposta.status, 503);
  } finally {
    await new Promise((resolve) => srv.close(() => resolve(undefined)));
  }
});

test("grafia em maiúsculas (/IA/...) não passa pelo json global: 401 sem token antes de ler o corpo", async () => {
  const srv = http.createServer(criarApp());
  await new Promise((resolve) => srv.listen(0, "127.0.0.1", () => resolve(undefined)));
  try {
    const { port } = /** @type {import("node:net").AddressInfo} */ (srv.address());
    for (const caminho of ["/IA/sugestao-ticket", "/Ia/sugestao-ticket"]) {
      const quebrado = await originais.fetch(`http://127.0.0.1:${port}${caminho}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{quebrado" });
      assert.equal(quebrado.status, 401, caminho);
      const grande = await originais.fetch(`http://127.0.0.1:${port}${caminho}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contexto: "a".repeat(150000) }) });
      assert.equal(grande.status, 401, caminho);
    }
  } finally {
    await new Promise((resolve) => srv.close(() => resolve(undefined)));
  }
});

test("a rota está na tabela de controllers e o app real pula o json global só em /ia/", async () => {
  assert.ok(CONTROLLERS.includes(IaControllerPadrao));
  const app = criarApp();
  const srv = http.createServer(app);
  await new Promise((resolve) => srv.listen(0, "127.0.0.1", () => resolve(undefined)));
  try {
    const { port } = /** @type {import("node:net").AddressInfo} */ (srv.address());
    delete process.env.MINIMAX_API_KEY;
    // 150 kb: acima do padrão de 100 kb do express.json global, mas dentro do teto da rota.
    const resposta = await originais.fetch(`http://127.0.0.1:${port}/ia/sugestao-ticket`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Internal-Token": TOKEN },
      body: JSON.stringify({ ...VALIDO, contexto: "a".repeat(150000) }),
    });
    assert.equal(resposta.status, 503, "chegou ao serviço (sem chave), não parou no limite do json global");
  } finally {
    await new Promise((resolve) => srv.close(() => resolve(undefined)));
  }
});
