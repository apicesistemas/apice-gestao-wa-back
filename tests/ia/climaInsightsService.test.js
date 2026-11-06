// @ts-check
// Insights da pesquisa de clima (plano 2026-11-05-20-22-53, Task 1, contrato DCL1): o serviço isolado, sem o controller.
const { test, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const { gerarInsights, montarPedidoClima, validarInsights, PROMPT_SISTEMA_CLIMA } = require("../../src/ia/climaInsightsService");

const CHAVE = "chave-minimax-de-teste";
const ambiente = process.env.MINIMAX_API_KEY;

/** @type {import("../../src/ia/climaInsightsService").PedidoClima} */
const PEDIDO = {
  perguntas: [{ ref: "P1", tipo: "ABERTA", dimensao: "ENGAJAMENTO", texto: "O que ajuda?" }],
  resultados: {
    respondentes: 9,
    participacao_percentual: 60,
    baixa_confiabilidade: true,
    enps: { valor: 10, promotores: 40, neutros: 30, detratores: 30, variacao: null },
    dimensoes: [{ dimensao: "ENGAJAMENTO", favoravel: 50, neutro: 25, desfavoravel: 25, variacao_pp: null }],
    itens: [],
  },
  comentarios: [{ ref: "P1", texto: "Autonomia." }],
  acoes_anteriores: [],
};
const INSIGHTS = { temas: [{ dimensao: "ENGAJAMENTO", resumo: "Autonomia é valorizada." }], pontos_fortes: [], pontos_atencao: [], sugestoes: [] };

/** @type {{ url: string, init: any }[]} */
let chamadas = [];
/** @type {(init: any) => Promise<Response>} */
let minimax = async () => chat(JSON.stringify(INSIGHTS));
/** @param {string} conteudo */
const chat = (conteudo) => Response.json({ choices: [{ message: { content: conteudo } }], base_resp: { status_code: 0 } });
const fetchFalso = /** @type {typeof fetch} */ (
  async (url, init) => {
    chamadas.push({ url: String(url), init });
    return minimax(init);
  }
);

beforeEach(() => {
  process.env.MINIMAX_API_KEY = CHAVE;
  chamadas = [];
  minimax = async () => chat(JSON.stringify(INSIGHTS));
});
after(() => {
  if (ambiente === undefined) delete process.env.MINIMAX_API_KEY;
  else process.env.MINIMAX_API_KEY = ambiente;
});

test("gerarInsights devolve { insights }, com o prompt fixo e o teto de tokens do contrato", async () => {
  const r = await gerarInsights({ ...PEDIDO, prazoMs: 5000, fetch: fetchFalso });
  assert.deepEqual(r, { insights: INSIGHTS });
  const corpo = JSON.parse(chamadas[0].init.body);
  assert.equal(corpo.messages[0].content, PROMPT_SISTEMA_CLIMA);
  assert.equal(corpo.max_completion_tokens, 8192);
  assert.deepEqual(corpo.thinking, { type: "disabled" });
});

test("<think> sem </think> é removido até o fim: o JSON do raciocínio nunca vale como resposta", async () => {
  minimax = async () => chat(`${JSON.stringify(INSIGHTS)} <think>vou mudar: ${JSON.stringify({ pontos_fortes: ["do raciocínio"] })}`);
  assert.deepEqual(await gerarInsights({ ...PEDIDO, prazoMs: 5000, fetch: fetchFalso }), { insights: INSIGHTS });
  minimax = async () => chat(`<think>${JSON.stringify(INSIGHTS)}`);
  assert.deepEqual(await gerarInsights({ ...PEDIDO, prazoMs: 5000, fetch: fetchFalso }), { erro: "RESPOSTA_INVALIDA" });
});

test("nunca rejeita: pedido malformado vira RESPOSTA_INVALIDA sem chamar a MiniMax", async () => {
  const r = await gerarInsights(/** @type {any} */ ({ prazoMs: 5000, fetch: fetchFalso }));
  assert.deepEqual(r, { erro: "RESPOSTA_INVALIDA" });
  assert.equal(chamadas.length, 0);
});

test("erro tipado do provedor passa adiante sem texto", async () => {
  minimax = async () => new Response("limite", { status: 429 });
  assert.deepEqual(await gerarInsights({ ...PEDIDO, prazoMs: 5000, fetch: fetchFalso }), { erro: "MINIMAX_LIMITE" });
  delete process.env.MINIMAX_API_KEY;
  assert.deepEqual(await gerarInsights({ ...PEDIDO, prazoMs: 5000, fetch: fetchFalso }), { erro: "SEM_CHAVE" });
});

test("validarInsights: lista ausente vale [], nada útil vale null, dimensão desconhecida vale null", () => {
  const dims = new Set(["ENGAJAMENTO"]);
  assert.deepEqual(validarInsights({ pontos_fortes: ["a"] }, dims), { temas: [], pontos_fortes: ["a"], pontos_atencao: [], sugestoes: [] });
  assert.equal(validarInsights({}, dims), null);
  assert.equal(validarInsights({ temas: [{ dimensao: "OUTRA", resumo: "x" }] }, dims), null);
});

test("montarPedidoClima: pergunta, comentário e ação em uma linha só; ordem dos comentários preservada", () => {
  const { usuario } = montarPedidoClima({
    ...PEDIDO,
    perguntas: [{ ref: "P1", tipo: "ABERTA", dimensao: "ENGAJAMENTO", texto: "linha 1\nlinha 2" }],
    comentarios: [{ ref: "P1", texto: "segundo\n\n  assunto" }, { ref: "P1", texto: "primeiro" }],
  });
  assert.match(usuario, /P1 \| ABERTA \| ENGAJAMENTO \| linha 1 linha 2\n/);
  assert.match(usuario, /\[P1\] segundo assunto\n\[P1\] primeiro\n/);
});
