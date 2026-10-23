// @ts-check
// POST /ia/sugestao-ticket com "classificacao" (D1 alterado) e POST /ia/classificacao-ticket (D3), Fase 57, Task 57.1.
// MiniMax com `fetch` falso, Baileys falso instalado só para provar que as rotas nunca o tocam, nenhum fetch para o
// back, e nenhum log com contexto, nomes da taxonomia ou resposta da IA.
const { test, before, after, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const baileysFalso = require("../helpers/baileysFalso");

baileysFalso.instalarBaileysFalso();
const { registrarControllers } = require("../../src/http");
const { criarIaController, ALLOWLIST_IA, ALLOWLIST_CLASSIFICACAO, ALLOWLIST_TAXONOMIA, ALLOWLIST_PRODUTO, ALLOWLIST_AREA, ALLOWLIST_NATUREZA } = require("../../src/http/IaController");
const { criarPortaoIa } = require("../../src/ia/portaoIa");
const { PROMPT_CLASSIFICACAO } = require("../../src/ia/classificacaoTicketService");
const { criarDesligamento, MSG_REINICIANDO } = require("../../src/utils/desligamento");
const { criarApp } = require("../../src/index");

const TOKEN = "token-back-para-wa";
const CHAVE = "chave-minimax-de-teste";
const SEGREDO = "segredo-do-cliente-no-contexto";
const SEGREDO_NOME = "nome-secreto-do-produto";
const TAXONOMIA = {
  produtos: [
    {
      cod_produto_suporte: 1,
      nome: `ApiceERP ${SEGREDO_NOME}`,
      areas: [
        { cod_area_produto: 10, nome: "Vendas" },
        { cod_area_produto: 11, nome: "Estoque" },
      ],
    },
    { cod_produto_suporte: 2, nome: "ApiceFiscal", areas: [{ cod_area_produto: 20, nome: "Emissão" }] },
    { cod_produto_suporte: 3, nome: "GicWeb", areas: [] },
  ],
  naturezas: [
    { codigo: "USO_SISTEMA", nome: "Uso do sistema", descricao: "O cliente não sabe operar uma tela." },
    { codigo: "OUTROS", nome: "Outros", descricao: "Nenhuma das anteriores." },
  ],
};
const CONTEXTO = `[01/01 10:00] Cliente: ${SEGREDO}`;
const D3 = { taxonomia: TAXONOMIA, contexto: CONTEXTO, prazo_ms: 5000 };
const D1 = { campos: ["classificacao"], contexto: CONTEXTO, taxonomia: TAXONOMIA, prazo_ms: 5000 };
const RESPOSTA_D3 = '{"cod_produto_suporte":1,"cod_area_produto":11,"natureza":"USO_SISTEMA"}';
const ESCOLHA = { cod_produto_suporte: 1, cod_area_produto: 11, natureza: "USO_SISTEMA" };

const originais = { log: console.log, error: console.error, warn: console.warn, fetch: globalThis.fetch };
const ambiente = { token: process.env.WA_BACK_ADMIN_TOKEN, chave: process.env.MINIMAX_API_KEY };

/** @type {http.Server} */
let servidor;
let baseUrl = "";
let desligamento = criarDesligamento();
/** @type {ReturnType<typeof criarPortaoIa>} */
let portao;
/** @type {ReturnType<typeof criarPortaoIa>} */
let portaoLote;
/** @type {string[]} */
let saida = [];
/** @type {string[]} */
let fetchsDeSaida = [];
/** @type {{ url: string, init: any }[]} */
let chamadasMinimax = [];
/** @type {(init: any) => Promise<Response>} */
let minimax = async () => chat(RESPOSTA_D3);

/** @param {string} conteudo */
const chat = (conteudo) => Response.json({ choices: [{ message: { content: conteudo } }], base_resp: { status_code: 0 } });
/** @param {number} ms */
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
/** @param {(t: any) => void} alterar @returns {any} cópia da taxonomia alterada */
const taxonomiaCom = (alterar) => {
  const copia = structuredClone(TAXONOMIA);
  alterar(copia);
  return copia;
};

before(async () => {
  process.env.WA_BACK_ADMIN_TOKEN = TOKEN;
  const app = express();
  /** @param {any} req @param {any} res @param {any} next */
  const delegar = (req, res, next) => {
    const sub = express();
    registrarControllers(sub, [
      criarIaController({
        desligamento,
        portao,
        portaoLote,
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
  portaoLote = criarPortaoIa(1);
  process.env.MINIMAX_API_KEY = CHAVE;
  chamadasMinimax = [];
  fetchsDeSaida = [];
  saida = [];
  minimax = async () => chat(RESPOSTA_D3);
  for (const nivel of /** @type {const} */ (["log", "error", "warn"])) console[nivel] = (...a) => void saida.push(a.join(" "));
});
afterEach(() => {
  Object.assign(console, { log: originais.log, error: originais.error, warn: originais.warn });
  assert.equal(baileysFalso.sockets.length, 0, "as rotas nunca criam nem usam socket do Baileys (nada de sendMessage)");
  assert.deepEqual(fetchsDeSaida, [], "as rotas não chamam o back nem outro serviço");
  const vazou = saida.filter((l) => [SEGREDO, SEGREDO_NOME, "Vendas", "Estoque", "ApiceFiscal", "Uso do sistema", CHAVE].some((s) => l.includes(s)));
  assert.deepEqual(vazou, [], "nenhum log leva o contexto, os nomes da taxonomia, a resposta da IA ou a chave");
});

/**
 * @param {string} caminho
 * @param {unknown} corpo
 * @param {{ token?: string | null, bruto?: string, tipo?: string }} [opcoes]
 */
async function postarEm(caminho, corpo, { token = TOKEN, bruto, tipo = "application/json" } = {}) {
  const resposta = await originais.fetch(`${baseUrl}${caminho}`, {
    method: "POST",
    headers: { "Content-Type": tipo, ...(token ? { "X-Internal-Token": token } : {}) },
    body: bruto ?? JSON.stringify(corpo),
  });
  const texto = await resposta.text();
  return { status: resposta.status, retryAfter: resposta.headers.get("retry-after"), corpo: texto ? JSON.parse(texto) : null };
}
/** @type {(corpo: unknown, opcoes?: Parameters<typeof postarEm>[2]) => ReturnType<typeof postarEm>} */
const postarD3 = (corpo, opcoes) => postarEm("/ia/classificacao-ticket", corpo, opcoes);
/** @type {(corpo: unknown, opcoes?: Parameters<typeof postarEm>[2]) => ReturnType<typeof postarEm>} */
const postarD1 = (corpo, opcoes) => postarEm("/ia/sugestao-ticket", corpo, opcoes);

test("D3: 200 com os três campos validados, uma chamada à MiniMax com o prompt fixo e a taxonomia", async () => {
  const r = await postarD3(D3);
  assert.equal(r.status, 200);
  assert.deepEqual(r.corpo, ESCOLHA);
  assert.equal(chamadasMinimax.length, 1);
  assert.equal(chamadasMinimax[0].init.headers.Authorization, `Bearer ${CHAVE}`);
  const { messages } = JSON.parse(chamadasMinimax[0].init.body);
  assert.deepEqual(messages[0], { role: "system", content: PROMPT_CLASSIFICACAO });
  assert.match(messages[1].content, /^Produtos e áreas permitidos/);
  assert.match(messages[1].content, /Produto 1: ApiceERP nome-secreto-do-produto\n {2}Área 10: Vendas\n {2}Área 11: Estoque/);
  assert.match(messages[1].content, /Produto 3: GicWeb\n {2}\(este produto não tem áreas/);
  assert.match(messages[1].content, /OUTROS: Outros - Nenhuma das anteriores\./);
  assert.match(messages[1].content, /<<<CONTEXTO_DO_TICKET\n\[01\/01 10:00\] Cliente: segredo-do-cliente-no-contexto\nFIM_CONTEXTO_DO_TICKET>>>$/);
});

test("D3: id fora da lista → null, área de outro produto → null, natureza desconhecida → null; resposta sem texto", async () => {
  minimax = async () => chat('{"cod_produto_suporte":1,"cod_area_produto":20,"natureza":"INVENTADA","motivo":"texto da IA","explicacao":"x"}');
  const area = await postarD3(D3);
  assert.equal(area.status, 200);
  assert.deepEqual(area.corpo, { cod_produto_suporte: 1, cod_area_produto: null, natureza: null });
  minimax = async () => chat('{"cod_produto_suporte":77,"cod_area_produto":10,"natureza":"OUTROS"}');
  const produto = await postarD3(D3);
  assert.deepEqual(produto.corpo, { cod_produto_suporte: null, cod_area_produto: null, natureza: "OUTROS" });
});

test("D3: os três nulos, tudo fora da taxonomia, JSON inválido e recusa 4xx do provedor → 502 RESPOSTA_INVALIDA", async () => {
  for (const conteudo of ['{"cod_produto_suporte":null,"cod_area_produto":null,"natureza":null}', '{"cod_produto_suporte":99,"cod_area_produto":98,"natureza":"X"}', "isto não é JSON"]) {
    minimax = async () => chat(conteudo);
    const r = await postarD3(D3);
    assert.equal(r.status, 502, conteudo);
    assert.deepEqual(r.corpo, { msg: "A resposta da IA não pôde ser usada.", codigo: "RESPOSTA_INVALIDA" });
  }
  minimax = async () => new Response("recusou", { status: 400 });
  assert.equal((await postarD3(D3)).status, 502);
});

test("D3: sem MINIMAX_API_KEY, 429, 5xx e erro de rede → 503 IA_INDISPONIVEL; prazo na MiniMax → 504 PRAZO", async () => {
  delete process.env.MINIMAX_API_KEY;
  const semChave = await postarD3(D3);
  assert.equal(semChave.status, 503);
  assert.deepEqual(semChave.corpo, { msg: "IA indisponível no momento.", codigo: "IA_INDISPONIVEL" });
  assert.equal(semChave.retryAfter, null);
  assert.equal(chamadasMinimax.length, 0);
  process.env.MINIMAX_API_KEY = CHAVE;
  for (const resposta of [new Response("limite", { status: 429 }), new Response("erro", { status: 500 })]) {
    minimax = async () => resposta;
    assert.equal((await postarD3(D3)).corpo.codigo, "IA_INDISPONIVEL");
  }
  minimax = async () => {
    throw new TypeError("fetch failed");
  };
  assert.equal((await postarD3(D3)).status, 503);
  minimax = async () => {
    throw Object.assign(new Error("timeout"), { name: "TimeoutError" });
  };
  const prazo = await postarD3(D3);
  assert.equal(prazo.status, 504);
  assert.deepEqual(prazo.corpo, { msg: "A IA não respondeu no prazo.", codigo: "PRAZO" });
});

test("D3: allowlist do topo (inclusive hash_empresa, cod_ticket, nota_interna, explicacao, titulo, descricao soltos) → 400 sem chamar a MiniMax", async () => {
  assert.deepEqual([...ALLOWLIST_CLASSIFICACAO].sort(), ["contexto", "prazo_ms", "taxonomia"]);
  for (const campo of ["hash_empresa", "cod_ticket", "cod_equipe", "nota_interna", "explicacao", "titulo", "descricao", "campos", "sugestao_ia", "qualquer"]) {
    const r = await postarD3({ ...D3, [campo]: "x" });
    assert.equal(r.status, 400, campo);
    assert.match(r.corpo.msg, /Campo não permitido na classificação/);
  }
  assert.equal(chamadasMinimax.length, 0);
});

test("allowlist em cada nível da taxonomia, na D3 e na D1 → 400 sem chamar a MiniMax", async () => {
  assert.deepEqual([...ALLOWLIST_TAXONOMIA].sort(), ["naturezas", "produtos"]);
  assert.deepEqual([...ALLOWLIST_PRODUTO].sort(), ["areas", "cod_produto_suporte", "nome"]);
  assert.deepEqual([...ALLOWLIST_AREA].sort(), ["cod_area_produto", "nome"]);
  assert.deepEqual([...ALLOWLIST_NATUREZA].sort(), ["codigo", "descricao", "nome"]);
  const desconhecidas = ["hash_empresa", "cod_equipe", "ativo", "ordem", "nota_interna", "especificacao", "exige_area", "qualquer"];
  /** @type {[string, (t: any, campo: string) => void, RegExp][]} */
  const niveis = [
    ["taxonomia", (t, campo) => (t[campo] = "x"), /Campo não permitido na taxonomia/],
    ["produto", (t, campo) => (t.produtos[0][campo] = "x"), /Campo não permitido no produto/],
    ["área", (t, campo) => (t.produtos[0].areas[0][campo] = "x"), /Campo não permitido na área/],
    ["natureza", (t, campo) => (t.naturezas[0][campo] = "x"), /Campo não permitido na natureza/],
  ];
  for (const [nivel, alterar, mensagem] of niveis) {
    for (const campo of desconhecidas) {
      const taxonomia = taxonomiaCom((t) => alterar(t, campo));
      for (const [enviar, corpo] of /** @type {const} */ ([
        [postarD3, { ...D3, taxonomia }],
        [postarD1, { ...D1, taxonomia }],
      ])) {
        const r = await enviar(corpo);
        assert.equal(r.status, 400, `${nivel}.${campo}`);
        assert.match(r.corpo.msg, mensagem);
      }
    }
  }
  assert.equal(chamadasMinimax.length, 0);
});

test("taxonomia inválida (tamanhos, ids, códigos, repetidos, tipos) → 400 sem chamar a MiniMax, na D3 e na D1", async () => {
  const produto = (/** @type {number} */ n) => ({ cod_produto_suporte: n, nome: `P${n}`, areas: [] });
  const natureza = (/** @type {string} */ codigo) => ({ codigo, nome: "N", descricao: "D" });
  const ruins = [
    undefined,
    null,
    "x",
    [],
    {},
    { produtos: TAXONOMIA.produtos },
    { naturezas: TAXONOMIA.naturezas },
    taxonomiaCom((t) => (t.produtos = [])),
    taxonomiaCom((t) => (t.produtos = "x")),
    taxonomiaCom((t) => (t.produtos = Array.from({ length: 51 }, (_, i) => produto(i + 1)))),
    taxonomiaCom((t) => (t.produtos = [null])),
    taxonomiaCom((t) => (t.produtos = [[1]])),
    ...[0, -1, 1.5, "1", null, undefined].map((id) => taxonomiaCom((t) => (t.produtos[0].cod_produto_suporte = id))),
    taxonomiaCom((t) => (t.produtos[1].cod_produto_suporte = 1)),
    ...["", "   ", "n".repeat(101), 7, null].map((nome) => taxonomiaCom((t) => (t.produtos[0].nome = nome))),
    taxonomiaCom((t) => delete t.produtos[0].areas),
    taxonomiaCom((t) => (t.produtos[0].areas = "x")),
    taxonomiaCom((t) => (t.produtos[0].areas = Array.from({ length: 101 }, (_, i) => ({ cod_area_produto: i + 1, nome: "A" })))),
    taxonomiaCom((t) => (t.produtos[0].areas = [null])),
    ...[0, -3, 2.5, "10", null].map((id) => taxonomiaCom((t) => (t.produtos[0].areas[0].cod_area_produto = id))),
    taxonomiaCom((t) => (t.produtos[0].areas[1].cod_area_produto = 10)),
    taxonomiaCom((t) => (t.produtos[1].areas[0].cod_area_produto = 10)),
    ...["", "   ", "n".repeat(101), 7].map((nome) => taxonomiaCom((t) => (t.produtos[0].areas[0].nome = nome))),
    taxonomiaCom((t) => (t.naturezas = [])),
    taxonomiaCom((t) => (t.naturezas = "x")),
    taxonomiaCom((t) => (t.naturezas = Array.from({ length: 21 }, (_, i) => natureza(`NAT_${String.fromCharCode(65 + i)}`)))),
    taxonomiaCom((t) => (t.naturezas = [null])),
    ...["a", "A", "1AB", "_AB", "AB-C", "Abc", "A".repeat(31), "ÇAO", "AB1", "", 7, null].map((codigo) => taxonomiaCom((t) => (t.naturezas[0].codigo = codigo))),
    taxonomiaCom((t) => (t.naturezas[1].codigo = "USO_SISTEMA")),
    ...["", "  ", "n".repeat(101), 7].map((nome) => taxonomiaCom((t) => (t.naturezas[0].nome = nome))),
    ...["", "  ", "d".repeat(301), 7, undefined].map((descricao) => taxonomiaCom((t) => (t.naturezas[0].descricao = descricao))),
  ];
  for (const taxonomia of ruins) {
    for (const [enviar, corpo] of /** @type {const} */ ([
      [postarD3, { ...D3, taxonomia }],
      [postarD1, { ...D1, taxonomia }],
    ])) {
      const r = await enviar(corpo);
      assert.equal(r.status, 400, JSON.stringify(taxonomia)?.slice(0, 140));
      assert.equal(typeof r.corpo.msg, "string");
    }
  }
  assert.equal(chamadasMinimax.length, 0);
});

test("D3: contexto, prazo e corpo inválidos → 400 sem chamar a MiniMax", async () => {
  const ruins = [
    { ...D3, taxonomia: undefined },
    { ...D3, contexto: "" },
    { ...D3, contexto: 7 },
    { ...D3, contexto: undefined },
    { ...D3, contexto: "a".repeat(200001) },
    { ...D3, prazo_ms: 999 },
    { ...D3, prazo_ms: 120001 },
    { ...D3, prazo_ms: 5000.5 },
    { ...D3, prazo_ms: "5000" },
    { ...D3, prazo_ms: undefined },
  ];
  for (const corpo of ruins) assert.equal((await postarD3(corpo)).status, 400, JSON.stringify(corpo).slice(0, 120));
  for (const bruto of ["[]", "null", "3", '"texto"']) assert.equal((await postarD3(null, { bruto })).status, 400, bruto);
  assert.equal((await postarD3(null, { bruto: "{quebrado" })).status, 400);
  assert.equal((await postarD3(null, { bruto: "{}", tipo: "text/plain" })).status, 400);
  const grande = await postarD3({ ...D3, contexto: "é".repeat(300000) });
  assert.equal(grande.status, 400);
  assert.match(grande.corpo.msg, /grande demais/);
  assert.equal(chamadasMinimax.length, 0);
});

test("limites exatos da taxonomia são aceitos: 50 produtos, 100 áreas, 20 naturezas, nomes de 100 e descrição de 300", async () => {
  const produtos = Array.from({ length: 50 }, (_, i) => ({
    cod_produto_suporte: i + 1,
    nome: "p".repeat(100),
    areas: i === 0 ? Array.from({ length: 100 }, (_, j) => ({ cod_area_produto: j + 1, nome: "a".repeat(100) })) : [],
  }));
  const naturezas = Array.from({ length: 20 }, (_, i) => ({ codigo: `NA${String.fromCharCode(65 + i)}`, nome: "n".repeat(100), descricao: "d".repeat(300) }));
  minimax = async () => chat('{"cod_produto_suporte":50,"cod_area_produto":null,"natureza":"NAA"}');
  const d3 = await postarD3({ ...D3, taxonomia: { produtos, naturezas }, contexto: "a".repeat(200000), prazo_ms: 1000 });
  assert.equal(d3.status, 200);
  assert.deepEqual(d3.corpo, { cod_produto_suporte: 50, cod_area_produto: null, natureza: "NAA" });
  minimax = async () => chat('{"classificacao":{"cod_produto_suporte":50,"cod_area_produto":null,"natureza":"NAA"}}');
  const d1 = await postarD1({ ...D1, taxonomia: { produtos, naturezas }, prazo_ms: 120000 });
  assert.equal(d1.status, 200);
  minimax = async () => chat(RESPOSTA_D3);
  const minimo = await postarD3({ ...D3, taxonomia: { produtos: [{ cod_produto_suporte: 1, nome: "P", areas: [] }], naturezas: [{ codigo: "AB", nome: "N", descricao: "D" }] } });
  assert.equal(minimo.status, 200);
});

test("D3: 401 sem token ou com token errado, antes de ler o corpo", async () => {
  assert.equal((await postarD3(D3, { token: null })).status, 401);
  assert.equal((await postarD3(D3, { token: "errado" })).status, 401);
  assert.equal((await postarD3(null, { token: null, bruto: "{quebrado" })).status, 401, "token vem antes do corpo");
  assert.equal(chamadasMinimax.length, 0);
});

test("D3: durante o desligamento, 503 + Retry-After sem chamar a MiniMax; a classificação em andamento termina", async () => {
  /** @type {() => void} */
  let liberar = () => {};
  minimax = () => new Promise((resolve) => (liberar = () => resolve(chat(RESPOSTA_D3))));
  const emAndamento = postarD3(D3);
  while (chamadasMinimax.length === 0) await esperar(5);
  desligamento.marcarEncerrando();
  const recusada = await postarD3(D3);
  assert.equal(recusada.status, 503);
  assert.deepEqual(recusada.corpo, { msg: MSG_REINICIANDO });
  assert.ok(Number(recusada.retryAfter) > 0);
  assert.equal(chamadasMinimax.length, 1, "o pedido recusado não chegou à MiniMax");
  liberar();
  assert.equal((await emAndamento).status, 200);
});

test("D3 usa o portão de LOTE: uma classificação em curso não atrasa a sugestão interativa, e a 2ª classificação espera a 1ª", async () => {
  /** @type {(() => void)[]} */
  const liberar = [];
  minimax = (init) => {
    if (String(init.body).includes("classificador interno")) return new Promise((resolve) => liberar.push(() => resolve(chat(RESPOSTA_D3))));
    return Promise.resolve(chat('{"titulo":"Erro ao emitir nota"}'));
  };
  const primeira = postarD3(D3);
  while (chamadasMinimax.length < 1) await esperar(5);

  const inicio = Date.now();
  const sugestao = await postarD1({ campos: ["titulo"], contexto: CONTEXTO, prazo_ms: 5000 });
  assert.equal(sugestao.status, 200);
  assert.deepEqual(sugestao.corpo, { titulo: "Erro ao emitir nota" });
  assert.ok(Date.now() - inicio < 1000);
  assert.equal(chamadasMinimax.length, 2);

  // A 2ª classificação espera a vaga do lote; com o prazo curto, desiste (504) sem chamar a MiniMax.
  const curta = await postarD3({ ...D3, prazo_ms: 1000 });
  assert.equal(curta.status, 504);
  assert.equal(curta.corpo.codigo, "PRAZO");
  assert.equal(chamadasMinimax.length, 2);

  liberar[0]();
  assert.equal((await primeira).status, 200);
});

test("D1: a classificação usa o portão das sugestões, e o do lote ocupado não a atrasa", async () => {
  /** @type {() => void} */
  let soltarLote = () => {};
  minimax = (init) => {
    if (String(init.body).includes("classificador interno")) return new Promise((resolve) => (soltarLote = () => resolve(chat(RESPOSTA_D3))));
    return Promise.resolve(chat(`{"classificacao":${RESPOSTA_D3}}`));
  };
  const lote = postarD3(D3);
  while (chamadasMinimax.length < 1) await esperar(5);
  const r = await postarD1(D1);
  assert.equal(r.status, 200);
  soltarLote();
  assert.equal((await lote).status, 200);
});

test("D1: 'classificacao' devolve o campo validado, com a taxonomia no pedido e a instrução no sistema", async () => {
  minimax = async () => chat(`{"titulo":"Erro ao emitir","cod_tipo_resolucao":3,"classificacao":${RESPOSTA_D3},"extra":"x"}`);
  const r = await postarD1({
    ...D1,
    campos: ["titulo", "cod_tipo_resolucao", "classificacao"],
    tipos_resolucao: [{ cod_tipo_resolucao: 3, nome: "Orientação ao cliente" }],
  });
  assert.equal(r.status, 200);
  assert.deepEqual(r.corpo, { titulo: "Erro ao emitir", cod_tipo_resolucao: 3, classificacao: ESCOLHA });
  const { messages } = JSON.parse(chamadasMinimax[0].init.body);
  assert.match(messages[0].content, /"classificacao": um objeto/);
  assert.match(messages[1].content, /Chaves pedidas: "titulo", "cod_tipo_resolucao", "classificacao"\./);
  assert.match(messages[1].content, /Produto 2: ApiceFiscal\n {2}Área 20: Emissão/);
});

test("D1: id fora da taxonomia → null, área de outro produto → null, natureza desconhecida → null; os três nulos sozinhos → 502", async () => {
  minimax = async () => chat('{"classificacao":{"cod_produto_suporte":2,"cod_area_produto":10,"natureza":"INVENTADA"}}');
  const r = await postarD1(D1);
  assert.equal(r.status, 200);
  assert.deepEqual(r.corpo, { classificacao: { cod_produto_suporte: 2, cod_area_produto: null, natureza: null } });
  minimax = async () => chat('{"classificacao":{"cod_produto_suporte":99,"cod_area_produto":98,"natureza":"X"}}');
  const nulos = await postarD1(D1);
  assert.equal(nulos.status, 502);
  assert.deepEqual(nulos.corpo, { msg: "A resposta da IA não pôde ser usada.", codigo: "RESPOSTA_INVALIDA" });
});

test("D1: 'classificacao' sem taxonomia → 400; taxonomia sem 'classificacao' é validada e ignorada (o pedido segue o de sempre)", async () => {
  const semTaxonomia = await postarD1({ campos: ["classificacao"], contexto: CONTEXTO, prazo_ms: 5000 });
  assert.equal(semTaxonomia.status, 400);
  assert.equal(chamadasMinimax.length, 0);
  minimax = async () => chat('{"titulo":"Erro ao emitir nota"}');
  const ignorada = await postarD1({ campos: ["titulo"], contexto: CONTEXTO, taxonomia: TAXONOMIA, prazo_ms: 5000 });
  assert.equal(ignorada.status, 200);
  assert.deepEqual(ignorada.corpo, { titulo: "Erro ao emitir nota" });
  assert.doesNotMatch(JSON.parse(chamadasMinimax[0].init.body).messages[1].content, /Produtos e áreas permitidos/);
});

test("D1: os cinco campos são aceitos e a lista de campos de 6 continua recusada", async () => {
  assert.deepEqual([...ALLOWLIST_IA].sort(), ["campos", "contexto", "minimo_caracteres_explicacao", "prazo_ms", "taxonomia", "tipos_resolucao"]);
  minimax = async () => chat(`{"titulo":"T","descricao":"D","cod_tipo_resolucao":3,"explicacao":"Explicação.","classificacao":${RESPOSTA_D3}}`);
  const todos = await postarD1({
    ...D1,
    campos: ["titulo", "descricao", "cod_tipo_resolucao", "explicacao", "classificacao"],
    tipos_resolucao: [{ cod_tipo_resolucao: 3, nome: "Orientação" }],
    minimo_caracteres_explicacao: 10,
  });
  assert.equal(todos.status, 200);
  assert.deepEqual(Object.keys(todos.corpo).sort(), ["classificacao", "cod_tipo_resolucao", "descricao", "explicacao", "titulo"]);
  const demais = await postarD1({ ...D1, campos: ["titulo", "descricao", "cod_tipo_resolucao", "explicacao", "classificacao", "titulo"] });
  assert.equal(demais.status, 400);
});

test("o log leva só o código e os ms (D3) e os campos pedidos, o código e os ms (D1)", async () => {
  await postarD3(D3);
  assert.ok(saida.some((l) => /^\[IA\] Classificação do ticket: codigo=OK ms=\d+$/.test(l)), saida.join("|"));
  minimax = async () => new Response("limite", { status: 429 });
  await postarD3(D3);
  assert.ok(saida.some((l) => /^\[IA\] Classificação do ticket: codigo=MINIMAX_LIMITE ms=\d+$/.test(l)));
  minimax = async () => chat(`${SEGREDO} sem json`);
  await postarD3(D3);
  assert.ok(saida.some((l) => /codigo=RESPOSTA_INVALIDA ms=\d+$/.test(l)));
  for (const l of saida) assert.match(l, /^\[IA\] Classificação do ticket: codigo=[A-Z_]+ ms=\d+$/);
  saida.length = 0;
  minimax = async () => chat(`{"classificacao":${RESPOSTA_D3}}`);
  await postarD1(D1);
  assert.equal(saida.length, 1);
  assert.match(saida[0], /^\[IA\] Sugestão do ticket: campos=classificacao codigo=OK ms=\d+$/);
});

test("imprevisto no portão vira 500 genérico, sem vazar o erro nem o contexto", async () => {
  const quebrado = {
    executar: async () => {
      throw new Error(`explodiu com ${SEGREDO} e ${SEGREDO_NOME}`);
    },
  };
  const app = express();
  registrarControllers(app, [criarIaController({ desligamento: criarDesligamento(), portaoLote: quebrado })]);
  const srv = http.createServer(app);
  await new Promise((resolve) => srv.listen(0, "127.0.0.1", () => resolve(undefined)));
  try {
    const { port } = /** @type {import("node:net").AddressInfo} */ (srv.address());
    const resposta = await originais.fetch(`http://127.0.0.1:${port}/ia/classificacao-ticket`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Internal-Token": TOKEN },
      body: JSON.stringify(D3),
    });
    assert.equal(resposta.status, 500);
    assert.deepEqual(await resposta.json(), { msg: "Erro interno ao classificar o ticket." });
    assert.ok(saida.some((l) => l.includes("Erro inesperado na classificação do ticket: Error")));
  } finally {
    await new Promise((resolve) => srv.close(() => resolve(undefined)));
  }
});

test("sem portão injetado, o controller usa o portão de lote do processo e o serviço real (sem chave: não sai da máquina)", async () => {
  const app = express();
  registrarControllers(app, [criarIaController({ desligamento: criarDesligamento() })]);
  const srv = http.createServer(app);
  await new Promise((resolve) => srv.listen(0, "127.0.0.1", () => resolve(undefined)));
  try {
    const { port } = /** @type {import("node:net").AddressInfo} */ (srv.address());
    delete process.env.MINIMAX_API_KEY;
    const resposta = await originais.fetch(`http://127.0.0.1:${port}/ia/classificacao-ticket`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Internal-Token": TOKEN },
      body: JSON.stringify(D3),
    });
    assert.equal(resposta.status, 503);
  } finally {
    await new Promise((resolve) => srv.close(() => resolve(undefined)));
  }
});

test("o app real não aplica o json global à rota nova (contexto de 150 kb chega ao serviço)", async () => {
  const srv = http.createServer(criarApp());
  await new Promise((resolve) => srv.listen(0, "127.0.0.1", () => resolve(undefined)));
  try {
    const { port } = /** @type {import("node:net").AddressInfo} */ (srv.address());
    delete process.env.MINIMAX_API_KEY;
    const resposta = await originais.fetch(`http://127.0.0.1:${port}/ia/classificacao-ticket`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Internal-Token": TOKEN },
      body: JSON.stringify({ ...D3, contexto: "a".repeat(150000) }),
    });
    assert.equal(resposta.status, 503, "chegou ao serviço (sem chave), não parou no limite do json global");
  } finally {
    await new Promise((resolve) => srv.close(() => resolve(undefined)));
  }
});
