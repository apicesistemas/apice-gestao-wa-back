// @ts-check
// Participantes de um grupo (Task 17.1), para o livechat montar as menções do atendente. Só o back
// chama (token de serviço em `X-Internal-Token`), e a rota não tem efeito no WhatsApp: só lê o
// `groupMetadata` (cache da equipe, consulta única por grupo, prazo curto).
//
// Canal D — `POST /equipe/:cod_equipe/grupo/participantes` (o JID do grupo vai no corpo, não na URL)
// Entrada JSON: { hash_empresa: string, chat_jid: string /^[\d-]{1,40}@g\.us$/ }
// 200 { participantes: [{ jid, lid, telefone, admin }] }: `jid` é o `id` do participante no
//   endereçamento do grupo (LID ou telefone), o que vai em `mentionedJid`; sem o número da própria
//   equipe e sem nome.
// Erros (sempre `{ msg }`):
//   400 "Informe o hash_empresa da equipe." | "Grupo inválido." | "Código da equipe inválido."
//   401 sem token · 404 "Equipe não encontrada." (outro tenant) · 404 "Grupo não encontrado." (número fora do grupo)
//   409 "O WhatsApp da equipe não está conectado." · 503 + Retry-After (desligamento)
//   504 "A consulta dos participantes não respondeu." · 502 "Não foi possível consultar os participantes."
// O log leva só o `cod_equipe` e o código do erro, nunca JID, LID ou telefone.
const exigirTokenServico = require("./exigirTokenServico");
const { ErroEnvio, obterSocketDaEquipe } = require("../whatsapp/envio");
const { normalizarCodEquipe } = require("../whatsapp/BaileysAdapter");
const { ehProprio } = require("../whatsapp/mencoesEntrada");
const { ErroConsultaGrupo } = require("../whatsapp/nomeGrupo");
const desligamentoDoProcesso = require("../utils/desligamento").padrao;

const PADRAO_GRUPO = /^[\d-]{1,40}@g\.us$/;

/** @type {Record<import("../whatsapp/envio").CodigoErroEnvio, number>} */
const STATUS_DO_ERRO = {
  CONTEUDO_INVALIDO: 400,
  EQUIPE_NAO_ENCONTRADA: 404,
  EQUIPE_DESCONECTADA: 409,
  FALHA_ENVIO: 502,
  ENVIO_NAO_CONFIRMADO: 504,
};

/** @type {Record<import("../whatsapp/nomeGrupo").CodigoErroGrupo, { status: number, msg: string }>} */
const RESPOSTA_DO_ERRO_GRUPO = {
  GRUPO_NAO_ENCONTRADO: { status: 404, msg: "Grupo não encontrado." },
  PRAZO_ESGOTADO: { status: 504, msg: "A consulta dos participantes não respondeu." },
  FALHA: { status: 502, msg: "Não foi possível consultar os participantes." },
};

/**
 * @param {import("../whatsapp/envio").ManagerEnvio} [manager]
 * @param {{ desligamento?: Pick<import("../utils/desligamento").Desligamento, "recusarDuranteEncerramento"> }} [opcoes]
 * @returns {(server: import("express").Express) => void}
 */
function criarGrupoController(manager, { desligamento = desligamentoDoProcesso } = {}) {
  /** @returns {import("../whatsapp/envio").ManagerEnvio} */
  const obterManager = () => manager ?? /** @type {import("../whatsapp/envio").ManagerEnvio} */ (/** @type {unknown} */ (require("../whatsapp/instanciaManager")));
  /** @type {import("express").RequestHandler} */
  const recusarDuranteEncerramento = (req, res, next) => desligamento.recusarDuranteEncerramento(req, res, next);

  return function GrupoController(server) {
    server.post("/equipe/:cod_equipe/grupo/participantes", exigirTokenServico, recusarDuranteEncerramento, async (req, res) => {
      let cod;
      try {
        cod = normalizarCodEquipe(req.params.cod_equipe);
      } catch {
        res.status(400).json({ msg: "Código da equipe inválido." });
        return;
      }
      try {
        const corpo = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
        // O grupo inválido é 400 mesmo com a equipe desconectada (nunca 409).
        if (typeof corpo.chat_jid !== "string" || !PADRAO_GRUPO.test(corpo.chat_jid)) {
          res.status(400).json({ msg: "Grupo inválido." });
          return;
        }
        const { adapter, socket } = obterSocketDaEquipe(obterManager(), cod, corpo.hash_empresa);
        const consultar = /** @type {{ obterParticipantesGrupo?: (chatJid: string) => Promise<import("../whatsapp/nomeGrupo").ParticipanteGrupo[]> }} */ (adapter).obterParticipantesGrupo;
        if (typeof consultar !== "function") throw new ErroConsultaGrupo("FALHA");
        const todos = await consultar.call(adapter, corpo.chat_jid);
        const participantes = todos.filter((p) => !ehProprio(p, { jid: socket.user?.id, lid: socket.user?.lid })).map(({ jid, lid, telefone, admin }) => ({ jid, lid, telefone, admin }));
        res.status(200).json({ participantes });
      } catch (erro) {
        if (erro instanceof ErroEnvio) {
          res.status(STATUS_DO_ERRO[erro.codigo] ?? 500).json({ msg: erro.message });
          return;
        }
        if (erro instanceof ErroConsultaGrupo) {
          const { status, msg } = RESPOSTA_DO_ERRO_GRUPO[erro.codigo];
          console.error(`[GRUPO] Consulta de participantes da equipe ${cod} falhou: ${erro.codigo}`);
          res.status(status).json({ msg });
          return;
        }
        console.error(`[GRUPO] Erro inesperado na consulta de participantes da equipe ${cod}:`, erro instanceof Error ? erro.name : "erro");
        res.status(500).json({ msg: "Erro interno ao consultar os participantes." });
      }
    });
  };
}

const GrupoController = criarGrupoController();

module.exports = Object.assign(GrupoController, { criarGrupoController });
