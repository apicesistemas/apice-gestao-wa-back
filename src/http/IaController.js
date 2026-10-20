// @ts-check
// Sugestão de texto do ticket pela IA (Fase 31, Task 31.1), contrato D1. Só o back chama (token de
// serviço em `X-Internal-Token`, conferido ANTES de ler o corpo; 503 + Retry-After no desligamento).
//
// Canal: D
// Método e caminho: POST /ia/sugestao-ticket
// Quem chama / quem expõe: back waIaService.sugerirTicket → wa-back IaController
// Entrada JSON (allowlist; `express.json` próprio da rota, teto técnico de 512 kb; chave desconhecida → 400
//   sem chamar a MiniMax, inclusive hash_empresa, transcricao, nota_interna e sugestao_ia):
//   { campos: ("titulo" | "descricao" | "cod_tipo_resolucao" | "explicacao")[] (1..4, sem repetição),
//     contexto: string (1..200000, já mascarado e cortado pelo back),
//     tipos_resolucao?: [{ cod_tipo_resolucao: inteiro > 0, nome: string 1..100 }] (1..100; obrigatório com "cod_tipo_resolucao"),
//     minimo_caracteres_explicacao?: inteiro 1..5000 (obrigatório com "explicacao"),
//     prazo_ms: inteiro 1000..120000 }
// Fluxo: portão de concorrência (MINIMAX_IA_CONCORRENCIA; a espera conta no prazo) → chat da MiniMax
//   (MINIMAX_MODELO_TEXTO) → parse defensivo e validação (titulo ≤ 150 cortado na palavra, descricao e explicacao
//   ≤ 5000, tipo fora da lista → null, campo não pedido descartado, nenhum campo útil → 502).
// Saída 2xx: 200 { titulo?, descricao?, cod_tipo_resolucao?: number | null, explicacao? } (só os pedidos)
// Erros: 400 { msg } · 401 · 502 { msg: "A resposta da IA não pôde ser usada.", codigo: "RESPOSTA_INVALIDA" } (inclui a recusa
//   4xx do provedor) · 503 { msg: "IA indisponível no momento.", codigo: "IA_INDISPONIVEL" } (sem chave, 429, 5xx, rede) ·
//   503 + Retry-After sem codigo (desligamento) · 504 { msg: "A IA não respondeu no prazo.", codigo: "PRAZO" } · 500 sem vazar o erro.
// Efeitos: nenhum. Não toca no instanciaManager nem no Baileys e não chama o back. O log leva só os campos pedidos, o
//   código e os milissegundos: nunca o contexto, a resposta da IA nem a chave.
// Compatibilidade: rota nova; publicar o wa-back antes do back.
const express = require("express");
const exigirTokenServico = require("./exigirTokenServico");
const sugestaoTicketService = require("../ia/sugestaoTicketService");
const { portaoPadrao } = require("../ia/portaoIa");
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

const ALLOWLIST_IA = new Set(["campos", "contexto", "tipos_resolucao", "minimo_caracteres_explicacao", "prazo_ms"]);
const ALLOWLIST_TIPO = new Set(["cod_tipo_resolucao", "nome"]);

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
 * @returns {{ campos: string[], contexto: string, tipos_resolucao?: { cod_tipo_resolucao: number, nome: string }[], minimo_caracteres_explicacao?: number, prazo_ms: number }}
 * @throws {ErroRequisicao}
 */
function validarCorpo(corpo) {
  if (!corpo || typeof corpo !== "object" || Array.isArray(corpo)) throw recusar("Corpo da requisição inválido.");
  const c = /** @type {Record<string, unknown>} */ (corpo);
  for (const nome of Object.keys(c)) {
    if (!ALLOWLIST_IA.has(nome)) throw recusar(`Campo não permitido na sugestão: ${nome.slice(0, 40)}.`);
  }

  const campos = c.campos;
  if (!Array.isArray(campos) || campos.length < 1 || campos.length > sugestaoTicketService.CAMPOS_VALIDOS.length) throw recusar("Informe de 1 a 4 campos para a sugestão.");
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

  return { campos, contexto: c.contexto, tipos_resolucao: tipos, minimo_caracteres_explicacao: minimo, prazo_ms: /** @type {number} */ (c.prazo_ms) };
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
 *   portao?: Pick<ReturnType<typeof import("../ia/portaoIa").criarPortaoIa>, "executar">,
 *   fetch?: typeof fetch,
 *   agora?: () => number,
 * }} [opcoes] dependências (os testes injetam)
 * @returns {(server: import("express").Express) => void}
 */
function criarIaController({ desligamento = desligamentoDoProcesso, sugerir = sugestaoTicketService.sugerir, portao, fetch, agora = Date.now } = {}) {
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
        if (resultado.erro === "MINIMAX_TIMEOUT") res.status(504).json({ msg: MSG_PRAZO, codigo: "PRAZO" });
        else if (resultado.erro === "MINIMAX_RECUSOU" || resultado.erro === "RESPOSTA_INVALIDA") res.status(502).json({ msg: MSG_INVALIDA, codigo: "RESPOSTA_INVALIDA" });
        else res.status(503).json({ msg: MSG_INDISPONIVEL, codigo: "IA_INDISPONIVEL" });
      } catch (erro) {
        // Só o nome do erro: a mensagem poderia carregar trecho do contexto.
        console.error("[IA] Erro inesperado na sugestão do ticket:", erro instanceof Error ? erro.name : "erro");
        res.status(500).json({ msg: "Erro interno ao gerar a sugestão." });
      }
    });
  };
}

const IaController = criarIaController();

module.exports = Object.assign(IaController, { criarIaController, ALLOWLIST_IA });
