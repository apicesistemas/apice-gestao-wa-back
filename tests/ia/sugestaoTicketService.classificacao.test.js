// @ts-check
// Campo "classificacao" na sugestão do ticket (Fase 57, Task 57.1, contrato D1 alterado), com `fetch` falso.
// A sugestão sem o campo novo não muda (os testes de `sugestaoTicketService.test.js` seguem como estavam).
const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { sugerir, PROMPT_SISTEMA, CAMPOS_VALIDOS } = require("../../src/ia/sugestaoTicketService");
const { INSTRUCAO_CLASSIFICACAO } = require("../../src/ia/classificacaoTicketService");

const CHAVE = "chave-minimax-de-teste";
const SEGREDO_CONTEXTO = "segredo-do-cliente-no-contexto";
/** @type {import("../../src/ia/classificacaoTicketService").Taxonomia} */
const TAXONOMIA = {
  produtos: [
    { cod_produto_suporte: 1, nome: "ApiceERP", areas: [{ cod_area_produto: 10, nome: "Vendas" }] },
    { cod_produto_suporte: 3, nome: "GicWeb", areas: [] },
  ],
  naturezas: [
    { codigo: "USO_SISTEMA", nome: "Uso do sistema", descricao: "O cliente não sabe operar uma tela." },
    { codigo: "OUTROS", nome: "Outros", descricao: "Nenhuma das anteriores." },
  ],
};
const TIPOS = [{ cod_tipo_resolucao: 3, nome: "Orientação ao cliente" }];

/** @type {string | undefined} */
let chaveOriginal;
/** @type {string[]} */
let saida;
const originais = { log: console.log, error: console.error, warn: console.warn };
beforeEach(() => {
  chaveOriginal = process.env.MINIMAX_API_KEY;
  process.env.MINIMAX_API_KEY = CHAVE;
  saida = [];
  for (const nivel of /** @type {const} */ (["log", "error", "warn"])) console[nivel] = (...a) => void saida.push(a.join(" "));
});
afterEach(() => {
  Object.assign(console, originais);
  if (chaveOriginal === undefined) delete process.env.MINIMAX_API_KEY;
  else process.env.MINIMAX_API_KEY = chaveOriginal;
  assert.deepEqual(saida.filter((l) => l.includes(SEGREDO_CONTEXTO) || l.includes(CHAVE)), [], "nada sensível no console");
});

/** @param {string} conteudo */
function fetchFalso(conteudo) {
  /** @type {{ url: string, init: any }[]} */
  const chamadas = [];
  const fn = /** @type {typeof fetch} */ (
    async (url, init) => {
      chamadas.push({ url: String(url), init });
      return Response.json({ choices: [{ message: { content: conteudo } }], base_resp: { status_code: 0 } });
    }
  );
  return { fetch: fn, chamadas };
}
const base = { contexto: `[01/01 10:00] Cliente: ${SEGREDO_CONTEXTO}`, prazoMs: 5000 };

test("CAMPOS_VALIDOS ganha classificacao (1..5 campos)", () => {
  assert.deepEqual(CAMPOS_VALIDOS, ["titulo", "descricao", "cod_tipo_resolucao", "explicacao", "classificacao"]);
});

test("pedido com classificacao: instrução no sistema, taxonomia no usuário antes do contexto, saída validada", async () => {
  const f = fetchFalso('{"classificacao":{"cod_produto_suporte":1,"cod_area_produto":10,"natureza":"USO_SISTEMA"}}');
  const r = await sugerir({ ...base, campos: ["classificacao"], taxonomia: TAXONOMIA, fetch: f.fetch });
  assert.deepEqual(r, { sugestao: { classificacao: { cod_produto_suporte: 1, cod_area_produto: 10, natureza: "USO_SISTEMA" } } });
  const { messages } = JSON.parse(f.chamadas[0].init.body);
  assert.equal(messages[0].content, PROMPT_SISTEMA + INSTRUCAO_CLASSIFICACAO);
  assert.match(messages[1].content, /Chaves pedidas: "classificacao"\./);
  assert.ok(messages[1].content.indexOf("Produto 1: ApiceERP") < messages[1].content.indexOf("<<<CONTEXTO_DO_TICKET"));
  assert.match(messages[1].content, /USO_SISTEMA: Uso do sistema - /);
});

test("com os outros campos juntos: cada um validado; classificacao com ids fora da taxonomia vira null nos campos", async () => {
  const f = fetchFalso('{"titulo":"Erro ao emitir","cod_tipo_resolucao":3,"classificacao":{"cod_produto_suporte":1,"cod_area_produto":999,"natureza":"X"}}');
  const r = await sugerir({ ...base, campos: ["titulo", "cod_tipo_resolucao", "classificacao"], tipos_resolucao: TIPOS, taxonomia: TAXONOMIA, fetch: f.fetch });
  assert.deepEqual(r, { sugestao: { titulo: "Erro ao emitir", cod_tipo_resolucao: 3, classificacao: { cod_produto_suporte: 1, cod_area_produto: null, natureza: null } } });
});

test("classificacao toda nula: sozinha → RESPOSTA_INVALIDA; com outro campo útil, volta com os nulos", async () => {
  const nula = '"classificacao":{"cod_produto_suporte":null,"cod_area_produto":null,"natureza":null}';
  assert.deepEqual(await sugerir({ ...base, campos: ["classificacao"], taxonomia: TAXONOMIA, fetch: fetchFalso(`{${nula}}`).fetch }), { erro: "RESPOSTA_INVALIDA" });
  assert.deepEqual(await sugerir({ ...base, campos: ["classificacao"], taxonomia: TAXONOMIA, fetch: fetchFalso('{"classificacao":"texto"}').fetch }), { erro: "RESPOSTA_INVALIDA" });
  assert.deepEqual(await sugerir({ ...base, campos: ["classificacao"], taxonomia: TAXONOMIA, fetch: fetchFalso('{"titulo":"x"}').fetch }), { erro: "RESPOSTA_INVALIDA" }, "chave ausente");
  const junto = await sugerir({ ...base, campos: ["titulo", "classificacao"], taxonomia: TAXONOMIA, fetch: fetchFalso(`{"titulo":"Erro ao emitir",${nula}}`).fetch });
  assert.deepEqual(junto, { sugestao: { titulo: "Erro ao emitir", classificacao: { cod_produto_suporte: null, cod_area_produto: null, natureza: null } } });
});

test("classificacao não pedida: o campo da IA é descartado, o prompt e o pedido são os de sempre, sem taxonomia", async () => {
  const f = fetchFalso('{"titulo":"Erro ao emitir","classificacao":{"cod_produto_suporte":1,"cod_area_produto":10,"natureza":"OUTROS"}}');
  const r = await sugerir({ ...base, campos: ["titulo"], taxonomia: TAXONOMIA, fetch: f.fetch });
  assert.deepEqual(r, { sugestao: { titulo: "Erro ao emitir" } });
  const { messages } = JSON.parse(f.chamadas[0].init.body);
  assert.equal(messages[0].content, PROMPT_SISTEMA);
  assert.doesNotMatch(messages[1].content, /Produtos e áreas permitidos|Naturezas permitidas/);
});

test("classificacao pedida sem taxonomia → RESPOSTA_INVALIDA, sem chamar a MiniMax", async () => {
  const f = fetchFalso("{}");
  assert.deepEqual(await sugerir({ ...base, campos: ["classificacao"], fetch: f.fetch }), { erro: "RESPOSTA_INVALIDA" });
  assert.equal(f.chamadas.length, 0);
});
