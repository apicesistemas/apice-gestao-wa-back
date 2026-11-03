// @ts-check
// Avaliação do atendimento comercial pela MiniMax (Fase 91, Task 91.1, contratos DC1 e DC2): prompt próprio,
// prévia com o marcador da linha do tempo e chamada com `fetch` falso. A validação da resposta é a do D1.
const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const {
  avaliarComercial,
  previaComercial,
  PROMPT_SISTEMA_COMERCIAL,
  CONTEXTO_PREVIA_COMERCIAL,
} = require("../../src/ia/avaliacaoComercialService");
const { montarPedido, PROMPT_SISTEMA, CONTEXTO_PREVIA } = require("../../src/ia/avaliacaoAtendimentoService");

/** @type {import("../../src/ia/avaliacaoAtendimentoService").CriterioAvaliacao[]} */
const CRITERIOS = [
  { codigo: "TEMPO_RESPOSTA", tipo: "NOTA", nome: "Tempo de resposta", instrucao: "A empresa respondeu em tempo razoável?", restrito: false },
  { codigo: "PROMESSA_SEM_RETORNO", tipo: "ALERTA", nome: "Promessa sem retorno", instrucao: "A empresa prometeu retornar e não retornou.", restrito: false },
];

const ambiente = { chave: process.env.MINIMAX_API_KEY };
beforeEach(() => {
  process.env.MINIMAX_API_KEY = "chave-de-teste";
});
afterEach(() => {
  if (ambiente.chave === undefined) delete process.env.MINIMAX_API_KEY;
  else process.env.MINIMAX_API_KEY = ambiente.chave;
});

/** @param {string} conteudo */
const chat = (conteudo) => Response.json({ choices: [{ message: { content: conteudo } }], base_resp: { status_code: 0 } });

test("PROMPT_SISTEMA_COMERCIAL: rótulos, avaliação só da Empresa e dos Registros, carimbos, recomendação ao responsável", () => {
  assert.notEqual(PROMPT_SISTEMA_COMERCIAL, PROMPT_SISTEMA);
  for (const rotulo of ['"Empresa"', '"Contato"', '"Registro do comercial']) assert.ok(PROMPT_SISTEMA_COMERCIAL.includes(rotulo), rotulo);
  assert.match(PROMPT_SISTEMA_COMERCIAL, /^2\. Avalie só as falas da "Empresa" e os "Registros do comercial"\. As falas do "Contato" servem de contexto\. Nunca avalie o contato\./m);
  assert.match(PROMPT_SISTEMA_COMERCIAL, /^2a\. O tempo de resposta sai só dos carimbos/m);
  assert.match(PROMPT_SISTEMA_COMERCIAL, /^7\. .*dirigida ao responsável pela oportunidade/m);
  // Regras 3 e 8 do prompt do suporte, adaptadas ao comercial.
  assert.match(PROMPT_SISTEMA_COMERCIAL, /^3\. Baseie-se só no que está escrito na linha do tempo\. Não invente fatos e não suponha o que aconteceu fora dela/m);
  assert.match(PROMPT_SISTEMA_COMERCIAL, /^8\. Nunca escreva nomes de pessoas ou de empresas, telefones, e-mails, documentos, senhas, números de nota, protocolo, pedido ou conta, nem qualquer sequência de números\./m);
  assert.ok(PROMPT_SISTEMA_COMERCIAL.includes("<<<CONVERSA_DO_ATENDIMENTO e FIM_CONVERSA_DO_ATENDIMENTO>>>"));
  assert.ok(PROMPT_SISTEMA_COMERCIAL.endsWith('{"notas":{"<CODIGO>":<1 a 5 ou null>},"alertas":{"<CODIGO>":{"disparado":<true ou false>,"linhas":[<n>],"motivo":"<texto>"}},"recomendacao":"<texto>"}'));
});

test("PROMPT_SISTEMA_COMERCIAL: sem critério restrito, sem rótulos do suporte e sem dado da oportunidade", () => {
  assert.ok(!PROMPT_SISTEMA_COMERCIAL.includes("RESTRITO"));
  assert.ok(!PROMPT_SISTEMA_COMERCIAL.includes('"Suporte"'));
  assert.ok(!PROMPT_SISTEMA_COMERCIAL.includes('"Cliente"'));
  assert.ok(!PROMPT_SISTEMA_COMERCIAL.includes("Participante"));
});

test("previaComercial: o sistema do comercial, o usuário do D1 e o marcador da linha do tempo no lugar do contexto", () => {
  const p = previaComercial(CRITERIOS);
  assert.equal(p.sistema, PROMPT_SISTEMA_COMERCIAL);
  assert.equal(CONTEXTO_PREVIA_COMERCIAL, "(aqui entra a linha do tempo da oportunidade, mascarada e numerada)");
  assert.deepEqual(p, montarPedido({ criterios: CRITERIOS, contexto: CONTEXTO_PREVIA_COMERCIAL, total_linhas: "N" }, PROMPT_SISTEMA_COMERCIAL));
  assert.ok(p.usuario.includes("A conversa tem N linhas."));
  assert.ok(p.usuario.includes(`<<<CONVERSA_DO_ATENDIMENTO\n${CONTEXTO_PREVIA_COMERCIAL}\nFIM_CONVERSA_DO_ATENDIMENTO>>>`));
  assert.notEqual(CONTEXTO_PREVIA_COMERCIAL, CONTEXTO_PREVIA);
});

test("avaliarComercial: chama a MiniMax uma vez com o sistema do comercial e valida como o D1", async () => {
  /** @type {any[]} */
  const corpos = [];
  const fetchFalso = /** @type {typeof fetch} */ (
    async (_url, init) => {
      corpos.push(JSON.parse(String(init?.body)));
      return chat(JSON.stringify({ notas: { TEMPO_RESPOSTA: 4, FANTASMA: 5 }, alertas: { PROMESSA_SEM_RETORNO: { disparado: true, linhas: [2, 99], motivo: "Prometeu e não voltou." } }, recomendacao: "Responda mais rápido." }));
    }
  );
  const r = await avaliarComercial({ criterios: CRITERIOS, contexto: "[L1] [14/10 09:02] Contato: oi", total_linhas: 3, prazoMs: 5000, fetch: fetchFalso });
  assert.deepEqual(r, {
    avaliacao: {
      notas: { TEMPO_RESPOSTA: 4 },
      alertas: { PROMESSA_SEM_RETORNO: { disparado: true, linhas: [2], motivo: "Prometeu e não voltou." } },
      recomendacao: "Responda mais rápido.",
    },
  });
  assert.equal(corpos.length, 1);
  assert.deepEqual(corpos[0].messages[0], { role: "system", content: PROMPT_SISTEMA_COMERCIAL });
  assert.equal(corpos[0].messages[1].content, montarPedido({ criterios: CRITERIOS, contexto: "[L1] [14/10 09:02] Contato: oi", total_linhas: 3 }, PROMPT_SISTEMA_COMERCIAL).usuario);
});

test("avaliarComercial: sem chave → IA indisponível, sem chamar o fetch; nunca rejeita", async () => {
  delete process.env.MINIMAX_API_KEY;
  let chamou = false;
  const r = await avaliarComercial({ criterios: CRITERIOS, contexto: "x", total_linhas: 1, prazoMs: 1000, fetch: /** @type {typeof fetch} */ (async () => ((chamou = true), chat("{}"))) });
  assert.ok("erro" in r);
  assert.equal(chamou, false);
});
