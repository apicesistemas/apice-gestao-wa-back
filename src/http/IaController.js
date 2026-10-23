// @ts-check
// Sugestão de texto do ticket pela IA (Fase 31, Task 31.1), contrato D1. Só o back chama (token de
// serviço em `X-Internal-Token`, conferido ANTES de ler o corpo; 503 + Retry-After no desligamento).
//
// Canal: D
// Método e caminho: POST /ia/sugestao-ticket
// Quem chama / quem expõe: back waIaService.sugerirTicket → wa-back IaController
// Entrada JSON (allowlist; `express.json` próprio da rota, teto técnico de 512 kb; chave desconhecida → 400
//   sem chamar a MiniMax, inclusive hash_empresa, transcricao, nota_interna e sugestao_ia):
//   { campos: ("titulo" | "descricao" | "cod_tipo_resolucao" | "explicacao" | "classificacao")[] (1..5, sem repetição),
//     contexto: string (1..200000, já mascarado e cortado pelo back),
//     tipos_resolucao?: [{ cod_tipo_resolucao: inteiro > 0, nome: string 1..100 }] (1..100; obrigatório com "cod_tipo_resolucao"),
//     minimo_caracteres_explicacao?: inteiro 1..5000 (obrigatório com "explicacao"),
//     taxonomia?: objeto (obrigatória com "classificacao"; formato na seção da Fase 57 abaixo),
//     prazo_ms: inteiro 1000..120000 }
// Fluxo: portão de concorrência (MINIMAX_IA_CONCORRENCIA; a espera conta no prazo) → chat da MiniMax
//   (MINIMAX_MODELO_TEXTO) → parse defensivo e validação (titulo ≤ 150 cortado na palavra, descricao e explicacao
//   ≤ 5000, tipo fora da lista → null, campo não pedido descartado, nenhum campo útil → 502).
// Saída 2xx: 200 { titulo?, descricao?, cod_tipo_resolucao?: number | null, explicacao?, classificacao? } (só os pedidos)
// Erros: 400 { msg } · 401 · 502 { msg: "A resposta da IA não pôde ser usada.", codigo: "RESPOSTA_INVALIDA" } (inclui a recusa
//   4xx do provedor) · 503 { msg: "IA indisponível no momento.", codigo: "IA_INDISPONIVEL" } (sem chave, 429, 5xx, rede) ·
//   503 + Retry-After sem codigo (desligamento) · 504 { msg: "A IA não respondeu no prazo.", codigo: "PRAZO" } · 500 sem vazar o erro.
// Efeitos: nenhum. Não toca no instanciaManager nem no Baileys e não chama o back. O log leva só os campos pedidos, o
//   código e os milissegundos: nunca o contexto, a resposta da IA nem a chave.
// Compatibilidade: rota nova; publicar o wa-back antes do back.
//
// Avaliação diária da qualidade do atendimento (Fase 55, Task 55.1), contratos D1 e D2. Só o back chama (mesmo token,
// mesmo desligamento, mesmo teto de corpo). Nenhuma das duas rotas grava, toca no Baileys ou chama o back.
//
// Canal: D
// Método e caminho: POST /ia/avaliacao-atendimento
// Quem chama / quem expõe: back waIaService.avaliarAtendimento (job) → wa-back IaController
// Entrada JSON (allowlist; chave desconhecida, no topo ou no critério → 400 sem chamar a MiniMax):
//   { criterios: [{ codigo: /^[A-Z][A-Z0-9_]{1,29}$/, tipo: "NOTA" | "ALERTA", nome: 2..60, instrucao: 10..500, restrito: boolean }]
//       (1..20 itens, códigos únicos),
//     contexto: string 1..200000 (já mascarado, numerado [Ln] e cortado pelo back),
//     total_linhas: inteiro 1..5000,
//     prazo_ms: inteiro 1000..120000 }
// Fluxo: portão de LOTE (MINIMAX_IA_CONCORRENCIA_LOTE, nunca o das sugestões; a espera conta no prazo) → chat da MiniMax →
//   validação (código não pedido ou com o tipo trocado descartado, nota fora de 1..5 → null, linha fora da faixa descartada,
//   motivo ≤ 300 e recomendacao ≤ 600 cortados na palavra, nenhum critério válido → 502).
// Saída 2xx: 200 { notas: { [codigo]: 1..5 | null }, alertas: { [codigo]: { disparado, linhas, motivo? } }, recomendacao? }
// Erros: 400 { msg } · 401 · 502 RESPOSTA_INVALIDA · 503 IA_INDISPONIVEL · 503 + Retry-After sem codigo (desligamento) ·
//   504 PRAZO · 500 sem vazar o erro.
// Efeitos: nenhum. O log leva só o número de critérios, o código e os ms: nunca o contexto, as instruções nem a resposta da IA.
//   O wa-back NÃO mascara nomes (não os conhece): quem filtra a saída é o back.
// Compatibilidade: rota nova; publicar o wa-back antes do back.
//
// Canal: D
// Método e caminho: POST /ia/avaliacao-atendimento/previa
// Quem chama / quem expõe: back AvaliacaoIaCriterio.previa → wa-back IaController
// Entrada: { criterios } (a mesma validação do D1; qualquer outra chave → 400)
// Saída 2xx: 200 { sistema, usuario } (o prompt exato do D1, com a conversa trocada por um marcador e total_linhas = "N")
// Erros: 400 { msg } · 401 · 503 + Retry-After
// Efeitos: nenhum; não chama a MiniMax.
//
// Classificação dos tickets (Fase 57, Task 57.1), contrato D1 (alterado) e D3 (novo). Só o back chama; as mesmas garantias
// (token antes do corpo, 503 + Retry-After no desligamento, nada de Baileys, back ou log com contexto, nomes ou resposta).
//
// Canal: D
// Método e caminho: POST /ia/sugestao-ticket (D1 alterado)
// Entrada: "campos" passa a aceitar "classificacao" (1..5 campos). Chave nova "taxonomia", obrigatória com "classificacao":
//   { produtos: [{ cod_produto_suporte: int > 0, nome: 1..100, areas: [{ cod_area_produto: int > 0, nome: 1..100 }] (0..100) }] (1..50),
//     naturezas: [{ codigo: /^[A-Z][A-Z_]{1,29}$/, nome: 1..100, descricao: 1..300 }] (1..20) }
//   Allowlist em cada nível (ALLOWLIST_TAXONOMIA, _PRODUTO, _AREA, _NATUREZA); chave desconhecida → 400 sem chamar a MiniMax.
//   Ids e códigos repetidos na taxonomia → 400. "taxonomia" sem "classificacao" é validada e ignorada.
// Saída 2xx: a mesma, mais classificacao?: { cod_produto_suporte: int | null, cod_area_produto: int | null, natureza: string | null }
//   (id fora da taxonomia → null; área de outro produto → null; natureza fora da lista → null; a IA pode se abster com null).
//   Pedido só de "classificacao" com os três nulos → 502 RESPOSTA_INVALIDA.
// Compatibilidade: publicar o wa-back ANTES do back (um wa-back antigo responde 400 à chave "taxonomia").
//
// Canal: D
// Método e caminho: POST /ia/classificacao-ticket (D3)
// Quem chama / quem expõe: back waIaService.classificarTicket (rodada noturna) → wa-back IaController
// Entrada (ALLOWLIST_CLASSIFICACAO; chave desconhecida, inclusive hash_empresa, cod_ticket, nota_interna, explicacao, titulo e
//   descricao soltos → 400 sem chamar a MiniMax):
//   { taxonomia (o formato da D1), contexto: string 1..200000 (já mascarado e cortado pelo back), prazo_ms: inteiro 1000..120000 }
// Fluxo: portão de LOTE (MINIMAX_IA_CONCORRENCIA_LOTE, nunca o das sugestões; a espera conta no prazo) → chat da MiniMax →
//   a mesma validação da D1.
// Saída 2xx: 200 { cod_produto_suporte: int | null, cod_area_produto: int | null, natureza: string | null }
// Erros: 400 · 401 · 502 RESPOSTA_INVALIDA (os três nulos ou JSON inválido) · 503 IA_INDISPONIVEL · 503 + Retry-After · 504 PRAZO · 500
// Efeitos: nenhum. O log leva só o código e os ms. Compatibilidade: rota nova; o wa-back sobe antes do back.
const express = require("express");
const exigirTokenServico = require("./exigirTokenServico");
const sugestaoTicketService = require("../ia/sugestaoTicketService");
const avaliacaoAtendimentoService = require("../ia/avaliacaoAtendimentoService");
const classificacaoTicketService = require("../ia/classificacaoTicketService");
const { portaoPadrao, portaoLote: portaoLoteDoProcesso } = require("../ia/portaoIa");
const desligamentoDoProcesso = require("../utils/desligamento").padrao;

/** Teto técnico do corpo JSON (o contexto vai até 200 000 caracteres, com UTF-8 e folga). */
const LIMITE_CORPO = "512kb";
/** Limites do contrato D1. */
const MAXIMO_CONTEXTO = 200000;
const MAXIMO_TIPOS = 100;
const MAXIMO_NOME_TIPO = 100;
const MAXIMO_MINIMO_EXPLICACAO = 5000;
const PRAZO_MINIMO_MS = 1000;
const PRAZO_MAXIMO_MS = 120000;
/** Limites do contrato D1 da avaliação (Fase 55). */
const MAXIMO_CRITERIOS = 20;
const MAXIMO_LINHAS = 5000;
const REGEX_CODIGO_CRITERIO = /^[A-Z][A-Z0-9_]{1,29}$/;
const LIMITE_NOME_CRITERIO = [2, 60];
const LIMITE_INSTRUCAO_CRITERIO = [10, 500];
/** Limites da taxonomia da Fase 57 (D1 e D3). */
const MAXIMO_PRODUTOS = 50;
const MAXIMO_AREAS = 100;
const MAXIMO_NATUREZAS = 20;
const LIMITE_NOME_TAXONOMIA = [1, 100];
const LIMITE_DESCRICAO_NATUREZA = [1, 300];
const REGEX_CODIGO_NATUREZA = /^[A-Z][A-Z_]{1,29}$/;

const ALLOWLIST_IA = new Set(["campos", "contexto", "tipos_resolucao", "minimo_caracteres_explicacao", "taxonomia", "prazo_ms"]);
const ALLOWLIST_TAXONOMIA = new Set(["produtos", "naturezas"]);
const ALLOWLIST_PRODUTO = new Set(["cod_produto_suporte", "nome", "areas"]);
const ALLOWLIST_AREA = new Set(["cod_area_produto", "nome"]);
const ALLOWLIST_NATUREZA = new Set(["codigo", "nome", "descricao"]);
const ALLOWLIST_CLASSIFICACAO = new Set(["taxonomia", "contexto", "prazo_ms"]);
const ALLOWLIST_TIPO = new Set(["cod_tipo_resolucao", "nome"]);
const ALLOWLIST_AVALIACAO = new Set(["criterios", "contexto", "total_linhas", "prazo_ms"]);
const ALLOWLIST_CRITERIO = new Set(["codigo", "tipo", "nome", "instrucao", "restrito"]);
const ALLOWLIST_PREVIA = new Set(["criterios"]);

const MSG_INDISPONIVEL = "IA indisponível no momento.";
const MSG_INVALIDA = "A resposta da IA não pôde ser usada.";
const MSG_PRAZO = "A IA não respondeu no prazo.";

class ErroRequisicao extends Error {}

/** @param {string} mensagem */
const recusar = (mensagem) => new ErroRequisicao(mensagem);

/** @param {unknown} v */
const ehInteiro = (v) => typeof v === "number" && Number.isInteger(v);

/**
 * Valida o corpo contra a allowlist do contrato D1.
 * @param {unknown} corpo
 * @returns {{ campos: string[], contexto: string, tipos_resolucao?: { cod_tipo_resolucao: number, nome: string }[], minimo_caracteres_explicacao?: number, taxonomia?: import("../ia/classificacaoTicketService").Taxonomia, prazo_ms: number }}
 * @throws {ErroRequisicao}
 */
function validarCorpo(corpo) {
  if (!corpo || typeof corpo !== "object" || Array.isArray(corpo)) throw recusar("Corpo da requisição inválido.");
  const c = /** @type {Record<string, unknown>} */ (corpo);
  for (const nome of Object.keys(c)) {
    if (!ALLOWLIST_IA.has(nome)) throw recusar(`Campo não permitido na sugestão: ${nome.slice(0, 40)}.`);
  }

  const campos = c.campos;
  if (!Array.isArray(campos) || campos.length < 1 || campos.length > sugestaoTicketService.CAMPOS_VALIDOS.length) throw recusar("Informe de 1 a 5 campos para a sugestão.");
  for (const campo of campos) {
    if (typeof campo !== "string" || !sugestaoTicketService.CAMPOS_VALIDOS.includes(campo)) throw recusar("Campo de sugestão inválido.");
  }
  if (new Set(campos).size !== campos.length) throw recusar("Campo de sugestão repetido.");

  if (typeof c.contexto !== "string" || c.contexto.length < 1 || c.contexto.length > MAXIMO_CONTEXTO) throw recusar("Contexto inválido.");

  if (!ehInteiro(c.prazo_ms) || /** @type {number} */ (c.prazo_ms) < PRAZO_MINIMO_MS || /** @type {number} */ (c.prazo_ms) > PRAZO_MAXIMO_MS) throw recusar("Prazo inválido.");

  /** @type {{ cod_tipo_resolucao: number, nome: string }[] | undefined} */
  let tipos;
  if (c.tipos_resolucao !== undefined) {
    const lista = c.tipos_resolucao;
    if (!Array.isArray(lista) || lista.length < 1 || lista.length > MAXIMO_TIPOS) throw recusar("Lista de tipos de resolução inválida.");
    tipos = lista.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) throw recusar("Tipo de resolução inválido.");
      const t = /** @type {Record<string, unknown>} */ (item);
      for (const nome of Object.keys(t)) if (!ALLOWLIST_TIPO.has(nome)) throw recusar("Tipo de resolução inválido.");
      if (!ehInteiro(t.cod_tipo_resolucao) || /** @type {number} */ (t.cod_tipo_resolucao) <= 0) throw recusar("Tipo de resolução inválido.");
      if (typeof t.nome !== "string" || t.nome.length < 1 || t.nome.length > MAXIMO_NOME_TIPO) throw recusar("Tipo de resolução inválido.");
      return { cod_tipo_resolucao: /** @type {number} */ (t.cod_tipo_resolucao), nome: t.nome };
    });
  }
  if (campos.includes("cod_tipo_resolucao") && !tipos) throw recusar("Informe os tipos de resolução para sugerir o tipo.");

  /** @type {number | undefined} */
  let minimo;
  if (c.minimo_caracteres_explicacao !== undefined) {
    const m = c.minimo_caracteres_explicacao;
    if (!ehInteiro(m) || /** @type {number} */ (m) < 1 || /** @type {number} */ (m) > MAXIMO_MINIMO_EXPLICACAO) throw recusar("Mínimo de caracteres da explicação inválido.");
    minimo = /** @type {number} */ (m);
  }
  if (campos.includes("explicacao") && minimo === undefined) throw recusar("Informe o mínimo de caracteres da explicação.");

  // A taxonomia presente é sempre validada (allowlist em todos os níveis); só é usada com "classificacao".
  const taxonomia = c.taxonomia === undefined ? undefined : validarTaxonomia(c.taxonomia);
  if (campos.includes("classificacao") && !taxonomia) throw recusar("Informe a taxonomia para sugerir a classificação.");

  return { campos, contexto: c.contexto, tipos_resolucao: tipos, minimo_caracteres_explicacao: minimo, taxonomia, prazo_ms: /** @type {number} */ (c.prazo_ms) };
}

/**
 * Confere as chaves do objeto contra a allowlist.
 * @param {unknown} corpo
 * @param {Set<string>} permitidas
 * @param {string} contexto trecho da mensagem ("na avaliação", "no critério")
 * @returns {Record<string, unknown>}
 * @throws {ErroRequisicao}
 */
function exigirChavesPermitidas(corpo, permitidas, contexto) {
  if (!corpo || typeof corpo !== "object" || Array.isArray(corpo)) throw recusar("Corpo da requisição inválido.");
  const c = /** @type {Record<string, unknown>} */ (corpo);
  for (const nome of Object.keys(c)) {
    if (!permitidas.has(nome)) throw recusar(`Campo não permitido ${contexto}: ${nome.slice(0, 40)}.`);
  }
  return c;
}

/**
 * Texto de critério como ele vai ao prompt (uma linha, aparado): confere o tamanho.
 * @param {unknown} valor
 * @param {number[]} limite [mínimo, máximo]
 */
const textoNoLimite = (valor, [minimo, maximo]) => {
  if (typeof valor !== "string") return false;
  const tamanho = valor.replace(/\s+/g, " ").trim().length;
  return tamanho >= minimo && tamanho <= maximo;
};

/**
 * Valida a lista de critérios (D1 e D2).
 * @param {unknown} lista
 * @returns {import("../ia/avaliacaoAtendimentoService").CriterioAvaliacao[]}
 * @throws {ErroRequisicao}
 */
function validarCriterios(lista) {
  if (!Array.isArray(lista) || lista.length < 1 || lista.length > MAXIMO_CRITERIOS) throw recusar(`Informe de 1 a ${MAXIMO_CRITERIOS} critérios.`);
  /** @type {Set<string>} */
  const codigos = new Set();
  return lista.map((item) => {
    const c = exigirChavesPermitidas(item, ALLOWLIST_CRITERIO, "no critério");
    if (typeof c.codigo !== "string" || !REGEX_CODIGO_CRITERIO.test(c.codigo)) throw recusar("Código do critério inválido.");
    if (codigos.has(c.codigo)) throw recusar("Código do critério repetido.");
    codigos.add(c.codigo);
    if (c.tipo !== "NOTA" && c.tipo !== "ALERTA") throw recusar("Tipo do critério inválido.");
    if (!textoNoLimite(c.nome, LIMITE_NOME_CRITERIO)) throw recusar("O nome do critério tem de 2 a 60 caracteres.");
    if (!textoNoLimite(c.instrucao, LIMITE_INSTRUCAO_CRITERIO)) throw recusar("A instrução do critério tem de 10 a 500 caracteres.");
    if (typeof c.restrito !== "boolean") throw recusar("Informe se o critério é restrito.");
    return { codigo: c.codigo, tipo: c.tipo, nome: /** @type {string} */ (c.nome), instrucao: /** @type {string} */ (c.instrucao), restrito: c.restrito };
  });
}

/**
 * Valida a taxonomia (D1 e D3): allowlist em cada nível, tamanhos, ids positivos e sem repetição.
 * @param {unknown} bruto
 * @returns {import("../ia/classificacaoTicketService").Taxonomia}
 * @throws {ErroRequisicao}
 */
function validarTaxonomia(bruto) {
  const t = exigirChavesPermitidas(bruto, ALLOWLIST_TAXONOMIA, "na taxonomia");
  const { produtos, naturezas } = t;
  if (!Array.isArray(produtos) || produtos.length < 1 || produtos.length > MAXIMO_PRODUTOS) throw recusar(`Informe de 1 a ${MAXIMO_PRODUTOS} produtos.`);
  if (!Array.isArray(naturezas) || naturezas.length < 1 || naturezas.length > MAXIMO_NATUREZAS) throw recusar(`Informe de 1 a ${MAXIMO_NATUREZAS} naturezas.`);

  /** @param {unknown} id */
  const idValido = (id) => ehInteiro(id) && /** @type {number} */ (id) > 0;
  const idsProdutos = new Set();
  const idsAreas = new Set();
  const produtosValidos = produtos.map((item) => {
    const p = exigirChavesPermitidas(item, ALLOWLIST_PRODUTO, "no produto");
    if (!idValido(p.cod_produto_suporte) || idsProdutos.has(p.cod_produto_suporte)) throw recusar("Produto inválido ou repetido.");
    idsProdutos.add(p.cod_produto_suporte);
    if (!textoNoLimite(p.nome, LIMITE_NOME_TAXONOMIA)) throw recusar("O nome do produto tem de 1 a 100 caracteres.");
    if (!Array.isArray(p.areas) || p.areas.length > MAXIMO_AREAS) throw recusar(`Informe de 0 a ${MAXIMO_AREAS} áreas por produto.`);
    const areas = p.areas.map((a) => {
      const area = exigirChavesPermitidas(a, ALLOWLIST_AREA, "na área");
      if (!idValido(area.cod_area_produto) || idsAreas.has(area.cod_area_produto)) throw recusar("Área inválida ou repetida.");
      idsAreas.add(area.cod_area_produto);
      if (!textoNoLimite(area.nome, LIMITE_NOME_TAXONOMIA)) throw recusar("O nome da área tem de 1 a 100 caracteres.");
      return { cod_area_produto: /** @type {number} */ (area.cod_area_produto), nome: /** @type {string} */ (area.nome) };
    });
    return { cod_produto_suporte: /** @type {number} */ (p.cod_produto_suporte), nome: /** @type {string} */ (p.nome), areas };
  });

  const codigos = new Set();
  const naturezasValidas = naturezas.map((item) => {
    const n = exigirChavesPermitidas(item, ALLOWLIST_NATUREZA, "na natureza");
    if (typeof n.codigo !== "string" || !REGEX_CODIGO_NATUREZA.test(n.codigo) || codigos.has(n.codigo)) throw recusar("Código da natureza inválido ou repetido.");
    codigos.add(n.codigo);
    if (!textoNoLimite(n.nome, LIMITE_NOME_TAXONOMIA)) throw recusar("O nome da natureza tem de 1 a 100 caracteres.");
    if (!textoNoLimite(n.descricao, LIMITE_DESCRICAO_NATUREZA)) throw recusar("A descrição da natureza tem de 1 a 300 caracteres.");
    return { codigo: n.codigo, nome: /** @type {string} */ (n.nome), descricao: /** @type {string} */ (n.descricao) };
  });
  return { produtos: produtosValidos, naturezas: naturezasValidas };
}

/**
 * Valida o corpo contra a allowlist do contrato D3 (classificação do ticket).
 * @param {unknown} corpo
 * @returns {{ taxonomia: import("../ia/classificacaoTicketService").Taxonomia, contexto: string, prazo_ms: number }}
 * @throws {ErroRequisicao}
 */
function validarCorpoClassificacao(corpo) {
  const c = exigirChavesPermitidas(corpo, ALLOWLIST_CLASSIFICACAO, "na classificação");
  const taxonomia = validarTaxonomia(c.taxonomia);
  if (typeof c.contexto !== "string" || c.contexto.length < 1 || c.contexto.length > MAXIMO_CONTEXTO) throw recusar("Contexto inválido.");
  const prazo = c.prazo_ms;
  if (!ehInteiro(prazo) || /** @type {number} */ (prazo) < PRAZO_MINIMO_MS || /** @type {number} */ (prazo) > PRAZO_MAXIMO_MS) throw recusar("Prazo inválido.");
  return { taxonomia, contexto: c.contexto, prazo_ms: /** @type {number} */ (prazo) };
}

/**
 * Valida o corpo contra a allowlist do contrato D1 da avaliação.
 * @param {unknown} corpo
 * @returns {{ criterios: import("../ia/avaliacaoAtendimentoService").CriterioAvaliacao[], contexto: string, total_linhas: number, prazo_ms: number }}
 * @throws {ErroRequisicao}
 */
function validarCorpoAvaliacao(corpo) {
  const c = exigirChavesPermitidas(corpo, ALLOWLIST_AVALIACAO, "na avaliação");
  const criterios = validarCriterios(c.criterios);
  if (typeof c.contexto !== "string" || c.contexto.length < 1 || c.contexto.length > MAXIMO_CONTEXTO) throw recusar("Contexto inválido.");
  const linhas = c.total_linhas;
  if (!ehInteiro(linhas) || /** @type {number} */ (linhas) < 1 || /** @type {number} */ (linhas) > MAXIMO_LINHAS) throw recusar("Total de linhas inválido.");
  const prazo = c.prazo_ms;
  if (!ehInteiro(prazo) || /** @type {number} */ (prazo) < PRAZO_MINIMO_MS || /** @type {number} */ (prazo) > PRAZO_MAXIMO_MS) throw recusar("Prazo inválido.");
  return { criterios, contexto: c.contexto, total_linhas: /** @type {number} */ (linhas), prazo_ms: /** @type {number} */ (prazo) };
}

/**
 * Responde o erro tipado da MiniMax (comum às duas IAs): 504 prazo, 502 resposta inutilizável, 503 indisponível.
 * @param {import("express").Response} res
 * @param {string} erro
 */
function responderErroIa(res, erro) {
  if (erro === "MINIMAX_TIMEOUT") res.status(504).json({ msg: MSG_PRAZO, codigo: "PRAZO" });
  else if (erro === "MINIMAX_RECUSOU" || erro === "RESPOSTA_INVALIDA") res.status(502).json({ msg: MSG_INVALIDA, codigo: "RESPOSTA_INVALIDA" });
  else res.status(503).json({ msg: MSG_INDISPONIVEL, codigo: "IA_INDISPONIVEL" });
}

/**
 * Lê o corpo JSON com o teto técnico da rota (o express.json global pula as rotas de ia).
 * @type {import("express").RequestHandler}
 */
function lerJson(req, res, next) {
  return express.json({ limit: LIMITE_CORPO })(req, res, (erro) => {
    if (!erro) {
      next();
      return;
    }
    const tipo = /** @type {{ type?: unknown }} */ (erro)?.type;
    if (tipo === "entity.too.large") res.status(400).json({ msg: "Corpo da requisição grande demais." });
    else res.status(400).json({ msg: "Corpo da requisição inválido." });
  });
}

/**
 * @param {{
 *   desligamento?: Pick<import("../utils/desligamento").Desligamento, "recusarDuranteEncerramento">,
 *   sugerir?: typeof sugestaoTicketService.sugerir,
 *   avaliar?: typeof avaliacaoAtendimentoService.avaliar,
 *   classificar?: typeof classificacaoTicketService.classificar,
 *   portao?: Pick<ReturnType<typeof import("../ia/portaoIa").criarPortaoIa>, "executar">,
 *   portaoLote?: Pick<ReturnType<typeof import("../ia/portaoIa").criarPortaoIa>, "executar">,
 *   fetch?: typeof fetch,
 *   agora?: () => number,
 * }} [opcoes] dependências (os testes injetam)
 * @returns {(server: import("express").Express) => void}
 */
function criarIaController({ desligamento = desligamentoDoProcesso, sugerir = sugestaoTicketService.sugerir, avaliar = avaliacaoAtendimentoService.avaliar, classificar = classificacaoTicketService.classificar, portao, portaoLote, fetch, agora = Date.now } = {}) {
  /** @type {import("express").RequestHandler} */
  const recusarDuranteEncerramento = (req, res, next) => desligamento.recusarDuranteEncerramento(req, res, next);

  return function IaController(server) {
    server.post("/ia/sugestao-ticket", exigirTokenServico, recusarDuranteEncerramento, lerJson, async (req, res) => {
      let dados;
      try {
        dados = validarCorpo(req.body);
      } catch (erro) {
        // validarCorpo só lança ErroRequisicao (mensagens fixas, sem eco do conteúdo).
        res.status(400).json({ msg: /** @type {Error} */ (erro).message });
        return;
      }

      const inicio = agora();
      const pedidos = dados.campos.join(",");
      /** @param {string} codigo */
      const registrar = (codigo) => console.log(`[IA] Sugestão do ticket: campos=${pedidos} codigo=${codigo} ms=${agora() - inicio}`);
      try {
        const vez = await (portao ?? portaoPadrao()).executar(dados.prazo_ms, (restanteMs) =>
          sugerir({
            campos: dados.campos,
            contexto: dados.contexto,
            tipos_resolucao: dados.tipos_resolucao,
            minimo_caracteres_explicacao: dados.minimo_caracteres_explicacao,
            taxonomia: dados.taxonomia,
            prazoMs: restanteMs,
            ...(fetch ? { fetch } : {}),
          }),
        );
        if (vez.prazoEsgotado) {
          registrar("PRAZO");
          res.status(504).json({ msg: MSG_PRAZO, codigo: "PRAZO" });
          return;
        }
        /** @type {import("../ia/sugestaoTicketService").ResultadoSugestao} */
        const resultado = vez.valor;
        if ("sugestao" in resultado) {
          registrar("OK");
          res.status(200).json(resultado.sugestao);
          return;
        }
        registrar(resultado.erro);
        responderErroIa(res, resultado.erro);
      } catch (erro) {
        // Só o nome do erro: a mensagem poderia carregar trecho do contexto.
        console.error("[IA] Erro inesperado na sugestão do ticket:", erro instanceof Error ? erro.name : "erro");
        res.status(500).json({ msg: "Erro interno ao gerar a sugestão." });
      }
    });

    server.post("/ia/avaliacao-atendimento", exigirTokenServico, recusarDuranteEncerramento, lerJson, async (req, res) => {
      let dados;
      try {
        dados = validarCorpoAvaliacao(req.body);
      } catch (erro) {
        // Só lança ErroRequisicao (mensagens fixas, sem eco do conteúdo).
        res.status(400).json({ msg: /** @type {Error} */ (erro).message });
        return;
      }

      const inicio = agora();
      const { criterios, contexto, total_linhas: totalLinhas, prazo_ms: prazoMs } = dados;
      /** @param {string} codigo */
      const registrar = (codigo) => console.log(`[IA] Avaliação do atendimento: criterios=${criterios.length} codigo=${codigo} ms=${agora() - inicio}`);
      try {
        const vez = await (portaoLote ?? portaoLoteDoProcesso()).executar(prazoMs, (restanteMs) =>
          avaliar({ criterios, contexto, total_linhas: totalLinhas, prazoMs: restanteMs, ...(fetch ? { fetch } : {}) }),
        );
        if (vez.prazoEsgotado) {
          registrar("PRAZO");
          res.status(504).json({ msg: MSG_PRAZO, codigo: "PRAZO" });
          return;
        }
        /** @type {import("../ia/avaliacaoAtendimentoService").ResultadoAvaliacao} */
        const resultado = vez.valor;
        if ("avaliacao" in resultado) {
          registrar("OK");
          res.status(200).json(resultado.avaliacao);
          return;
        }
        registrar(resultado.erro);
        responderErroIa(res, resultado.erro);
      } catch (erro) {
        // Só o nome do erro: a mensagem poderia carregar trecho do contexto.
        console.error("[IA] Erro inesperado na avaliação do atendimento:", erro instanceof Error ? erro.name : "erro");
        res.status(500).json({ msg: "Erro interno ao avaliar o atendimento." });
      }
    });

    server.post("/ia/classificacao-ticket", exigirTokenServico, recusarDuranteEncerramento, lerJson, async (req, res) => {
      let dados;
      try {
        dados = validarCorpoClassificacao(req.body);
      } catch (erro) {
        // Só lança ErroRequisicao (mensagens fixas, sem eco do conteúdo).
        res.status(400).json({ msg: /** @type {Error} */ (erro).message });
        return;
      }

      const inicio = agora();
      const { taxonomia, contexto, prazo_ms: prazoMs } = dados;
      /** @param {string} codigo */
      const registrar = (codigo) => console.log(`[IA] Classificação do ticket: codigo=${codigo} ms=${agora() - inicio}`);
      try {
        const vez = await (portaoLote ?? portaoLoteDoProcesso()).executar(prazoMs, (restanteMs) =>
          classificar({ taxonomia, contexto, prazoMs: restanteMs, ...(fetch ? { fetch } : {}) }),
        );
        if (vez.prazoEsgotado) {
          registrar("PRAZO");
          res.status(504).json({ msg: MSG_PRAZO, codigo: "PRAZO" });
          return;
        }
        /** @type {import("../ia/classificacaoTicketService").ResultadoClassificacao} */
        const resultado = vez.valor;
        if ("classificacao" in resultado) {
          registrar("OK");
          res.status(200).json(resultado.classificacao);
          return;
        }
        registrar(resultado.erro);
        responderErroIa(res, resultado.erro);
      } catch (erro) {
        // Só o nome do erro: a mensagem poderia carregar trecho do contexto.
        console.error("[IA] Erro inesperado na classificação do ticket:", erro instanceof Error ? erro.name : "erro");
        res.status(500).json({ msg: "Erro interno ao classificar o ticket." });
      }
    });

    server.post("/ia/avaliacao-atendimento/previa", exigirTokenServico, recusarDuranteEncerramento, lerJson, (req, res) => {
      try {
        const c = exigirChavesPermitidas(req.body, ALLOWLIST_PREVIA, "na prévia");
        res.status(200).json(avaliacaoAtendimentoService.previa(validarCriterios(c.criterios)));
      } catch (erro) {
        // validarCriterios e exigirChavesPermitidas só lançam ErroRequisicao.
        res.status(400).json({ msg: /** @type {Error} */ (erro).message });
      }
    });
  };
}

const IaController = criarIaController();

module.exports = Object.assign(IaController, {
  criarIaController,
  ALLOWLIST_IA,
  ALLOWLIST_AVALIACAO,
  ALLOWLIST_CRITERIO,
  ALLOWLIST_CLASSIFICACAO,
  ALLOWLIST_TAXONOMIA,
  ALLOWLIST_PRODUTO,
  ALLOWLIST_AREA,
  ALLOWLIST_NATUREZA,
});
