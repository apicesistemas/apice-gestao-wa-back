// @ts-check
// Consulta de um telefone para iniciar conversa privada, sem grupo (Fase 44, Task 44.1, contrato D1).
// Só o back chama (token de serviço em `X-Internal-Token`), e a rota não envia nada: só um `onWhatsApp`.
//
// Canal D — `POST /equipe/:cod_equipe/contato/consultar` (token de serviço + 503 + Retry-After no desligamento; sem trava de grupo)
// Entrada JSON (allowlist; chave desconhecida, inclusive transcricao, nota_interna, explicacao e sugestao_ia, → 400 sem tocar o Baileys):
//   { hash_empresa: string, telefone: /^55\d{10,11}$/ }
// Fluxo: socket da equipe (404 de outro tenant, 409 DESCONECTADA) → UM onWhatsApp (prazo técnico de consulta; ausente → 409
//   SEM_WHATSAPP) → o jid DEVOLVIDO (9º dígito) igual ao da equipe → 400 PROPRIO_NUMERO → lid = o da consulta ou o do
//   resolvedor, e o par LID <-> telefone é aprendido.
// 200 { jid_privado: string (telefone@s.whatsapp.net DEVOLVIDO), lid: string | null, telefone: string (dígitos do jid devolvido) }
// Erros (sempre `{ msg }`): 400 · 400 { msg, codigo: "PROPRIO_NUMERO" } · 401 · 404 "Equipe não encontrada." ·
//   409 { msg, codigo: "DESCONECTADA" | "SEM_WHATSAPP" } · 502 "Não foi possível consultar o número." · 503 + Retry-After ·
//   504 "A consulta do número não respondeu." · 500 sem vazar o erro.
// Nenhum sendMessage e nada em /interno/*. O log leva só `cod_equipe` e o código: nunca telefone, JID nem LID.
const exigirTokenServico = require("./exigirTokenServico");
const { ErroEnvio, obterSocketDaEquipe } = require("../whatsapp/envio");
const { normalizarCodEquipe } = require("../whatsapp/BaileysAdapter");
const { ErroConsultaGrupo } = require("../whatsapp/nomeGrupo");
const { ErroGrupo } = require("../whatsapp/grupoGestao");
const { padrao: desligamentoDoProcesso } = require("../utils/desligamento");

/** Telefone BR com DDI: 55 + DDD + número (10 ou 11 dígitos). */
const PADRAO_TELEFONE = /^55\d{10,11}$/;
/** Chaves aceitas no corpo; qualquer outra (inclusive campo interno) é 400. */
const ALLOWLIST_CONSULTA = new Set(["hash_empresa", "telefone"]);
const MSG_TELEFONE = "Telefone inválido: confira o DDD e o número.";

/** @type {Record<import("../whatsapp/nomeGrupo").CodigoErroGrupo, { status: number, msg: string }>} */
const RESPOSTA_DO_ERRO_CONSULTA = {
  GRUPO_NAO_ENCONTRADO: { status: 502, msg: "Não foi possível consultar o número." },
  PRAZO_ESGOTADO: { status: 504, msg: "A consulta do número não respondeu." },
  FALHA: { status: 502, msg: "Não foi possível consultar o número." },
};

/** @type {Record<import("../whatsapp/envio").CodigoErroEnvio, number>} */
const STATUS_DO_ERRO = {
  CONTEUDO_INVALIDO: 400,
  EQUIPE_NAO_ENCONTRADA: 404,
  EQUIPE_DESCONECTADA: 409,
  FALHA_ENVIO: 502,
  ENVIO_NAO_CONFIRMADO: 504,
};

class ErroRequisicao extends Error {}

/**
 * Valida o corpo contra a allowlist do contrato D1.
 * @param {unknown} corpo
 * @returns {{ hash_empresa: unknown, telefone: string }}
 * @throws {ErroRequisicao}
 */
function validarCorpo(corpo) {
  if (!corpo || typeof corpo !== "object" || Array.isArray(corpo)) throw new ErroRequisicao("Corpo da requisição inválido.");
  const c = /** @type {Record<string, unknown>} */ (corpo);
  for (const nome of Object.keys(c)) {
    if (!ALLOWLIST_CONSULTA.has(nome)) throw new ErroRequisicao(`Campo não permitido na consulta do número: ${nome.slice(0, 40)}.`);
  }
  if (typeof c.telefone !== "string" || !PADRAO_TELEFONE.test(c.telefone)) throw new ErroRequisicao(MSG_TELEFONE);
  return { hash_empresa: c.hash_empresa, telefone: c.telefone };
}

/**
 * @param {import("../whatsapp/envio").ManagerEnvio} [manager]
 * @param {{
 *   desligamento?: Pick<import("../utils/desligamento").Desligamento, "recusarDuranteEncerramento">,
 *   msPrazoConsulta?: number,
 * }} [opcoes] estado de desligamento e prazo técnico da consulta do número (os testes injetam)
 * @returns {(server: import("express").Express) => void}
 */
function criarContatoController(manager, { desligamento = desligamentoDoProcesso, msPrazoConsulta } = {}) {
  /** @returns {import("../whatsapp/envio").ManagerEnvio} */
  const obterManager = () => manager ?? /** @type {import("../whatsapp/envio").ManagerEnvio} */ (/** @type {unknown} */ (require("../whatsapp/instanciaManager")));
  /** @type {import("express").RequestHandler} */
  const recusarDuranteEncerramento = (req, res, next) => desligamento.recusarDuranteEncerramento(req, res, next);

  return function ContatoController(server) {
    server.post("/equipe/:cod_equipe/contato/consultar", exigirTokenServico, recusarDuranteEncerramento, async (req, res) => {
      let cod;
      try {
        cod = normalizarCodEquipe(/** @type {string} */ (req.params.cod_equipe));
      } catch {
        res.status(400).json({ msg: "Código da equipe inválido." });
        return;
      }
      try {
        const dados = validarCorpo(req.body);
        const { adapter } = obterSocketDaEquipe(obterManager(), cod, dados.hash_empresa);
        const resolver = /** @type {{ resolverContatoTelefone?: import("../whatsapp/BaileysAdapter").BaileysAdapter["resolverContatoTelefone"] }} */ (adapter).resolverContatoTelefone;
        if (typeof resolver !== "function") throw new ErroConsultaGrupo("FALHA");
        const contato = await resolver.call(adapter, dados.telefone, { msPrazoConsulta });
        res.status(200).json(contato);
      } catch (erro) {
        if (erro instanceof ErroRequisicao) {
          res.status(400).json({ msg: erro.message });
          return;
        }
        if (erro instanceof ErroGrupo) {
          if (erro.codigo === "PROPRIO_NUMERO") res.status(400).json({ msg: erro.message, codigo: erro.codigo });
          else res.status(409).json({ msg: erro.message, codigo: erro.codigo });
          return;
        }
        if (erro instanceof ErroEnvio) {
          if (erro.codigo === "EQUIPE_DESCONECTADA") res.status(409).json({ msg: erro.message, codigo: "DESCONECTADA" });
          else res.status(STATUS_DO_ERRO[erro.codigo] ?? 500).json({ msg: erro.message });
          return;
        }
        if (erro instanceof ErroConsultaGrupo) {
          const { status, msg } = RESPOSTA_DO_ERRO_CONSULTA[erro.codigo];
          console.error(`[CONTATO] Consulta de número da equipe ${cod} falhou: ${erro.codigo}`);
          res.status(status).json({ msg });
          return;
        }
        console.error(`[CONTATO] Erro inesperado na consulta de número da equipe ${cod}:`, erro instanceof Error ? erro.name : "erro");
        res.status(500).json({ msg: "Erro interno ao consultar o número." });
      }
    });
  };
}

const ContatoController = criarContatoController();

module.exports = Object.assign(ContatoController, { criarContatoController, ALLOWLIST_CONSULTA });
