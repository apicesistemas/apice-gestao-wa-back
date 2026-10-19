// @ts-check
// Miniatura da foto de perfil (Fase 32, Task 32.1), contrato D2. Só o back chama (token de serviço em
// `X-Internal-Token`); a rota só lê (IQ `profilePictureUrl` "preview" e um download https de host
// `*.whatsapp.net`). Nada de envio, nada em disco, nenhum cache de imagem e nenhuma chamada a `/interno/*`.
//
// Canal D — `POST /equipe/:cod_equipe/foto-perfil` (token de serviço + 503 no desligamento)
// Entrada JSON (allowlist; chave desconhecida, inclusive transcricao, nota_interna e explicacao, → 400 sem tocar o Baileys):
//   { hash_empresa: string,
//     jid: /^(\d{1,25}@lid|\d{8,15}@s\.whatsapp\.net|[\d-]{1,40}@g\.us)$/,
//     grupo_jid?: /^[\d-]{1,40}@g\.us$/ }   (com `grupo_jid`, o `jid` precisa estar nos participantes do grupo)
// Fluxo: socket da equipe (404 tenant, 409 desconectada) → com grupo_jid, participante fora do cache do grupo → 409
//   FORA_DO_GRUPO, sem IQ → profilePictureUrl(jid, "preview", prazo) → sem URL ou Boom 401/404 → SEM_FOTO → URL só https de
//   host `*.whatsapp.net` (senão SEM_FOTO) → fetch com prazo e `redirect: "error"`, leitura com teto técnico de 100 KB → tipo pelo
//   conteúdo (JPEG, PNG ou WebP; senão SEM_FOTO).
// 200 { situacao: "SEM_FOTO" } | { situacao: "COM_FOTO", mimetype, conteudo_base64 }
// Erros: 400 · 401 · 404 "Equipe não encontrada." · 409 { msg, codigo: "DESCONECTADA" | "FORA_DO_GRUPO" } ·
//   429 { msg: "O WhatsApp limitou as consultas. Tente mais tarde.", codigo: "LIMITE_WHATSAPP" } (rate-overlimit) · 502 ·
//   503 + Retry-After · 504 "A consulta da foto não respondeu." · 500 sem vazar o erro.
// O log leva só `cod_equipe` e o código: nunca a URL do CDN, JID nem LID.
const exigirTokenServico = require("./exigirTokenServico");
const { ErroEnvio, obterSocketDaEquipe } = require("../whatsapp/envio");
const { normalizarCodEquipe } = require("../whatsapp/BaileysAdapter");
const { ErroConsultaGrupo } = require("../whatsapp/nomeGrupo");
const { ErroGrupo } = require("../whatsapp/grupoGestao");
const { ErroFoto } = require("../whatsapp/fotoPerfil");
const { padrao: desligamentoDoProcesso } = require("../utils/desligamento");

const PADRAO_GRUPO = /^[\d-]{1,40}@g\.us$/;
const PADRAO_JID = /^(\d{1,25}@lid|\d{8,15}@s\.whatsapp\.net|[\d-]{1,40}@g\.us)$/;
/** Chaves aceitas no corpo (D2); qualquer outra (inclusive campo interno) é 400. */
const ALLOWLIST_FOTO = new Set(["hash_empresa", "jid", "grupo_jid"]);

/** @type {Record<import("../whatsapp/envio").CodigoErroEnvio, number>} */
const STATUS_DO_ERRO = {
  CONTEUDO_INVALIDO: 400,
  EQUIPE_NAO_ENCONTRADA: 404,
  EQUIPE_DESCONECTADA: 409,
  FALHA_ENVIO: 502,
  ENVIO_NAO_CONFIRMADO: 504,
};

const MSG_FALHA_FOTO = "Não foi possível consultar a foto.";

class ErroRequisicao extends Error {}

/**
 * Valida o corpo contra a allowlist do contrato D2. `grupo_jid` é opcional; `null` é 400.
 * @param {unknown} corpo
 * @returns {{ hash_empresa: unknown, jid: string, grupo_jid: string | undefined }}
 * @throws {ErroRequisicao}
 */
function validarCorpo(corpo) {
  if (!corpo || typeof corpo !== "object" || Array.isArray(corpo)) throw new ErroRequisicao("Corpo da requisição inválido.");
  const c = /** @type {Record<string, unknown>} */ (corpo);
  for (const nome of Object.keys(c)) {
    if (!ALLOWLIST_FOTO.has(nome)) throw new ErroRequisicao(`Campo não permitido na consulta da foto: ${nome.slice(0, 40)}.`);
  }
  if (typeof c.jid !== "string" || !PADRAO_JID.test(c.jid)) throw new ErroRequisicao("Contato inválido.");
  const grupo = c.grupo_jid;
  if (grupo !== undefined && (typeof grupo !== "string" || !PADRAO_GRUPO.test(grupo))) throw new ErroRequisicao("Grupo inválido.");
  return { hash_empresa: c.hash_empresa, jid: c.jid, grupo_jid: /** @type {string | undefined} */ (grupo) };
}

/**
 * @param {import("../whatsapp/envio").ManagerEnvio} [manager]
 * @param {{ desligamento?: Pick<import("../utils/desligamento").Desligamento, "recusarDuranteEncerramento">, msPrazo?: number }} [opcoes] estado de desligamento e prazo técnico da consulta (os testes injetam)
 * @returns {(server: import("express").Express) => void}
 */
function criarFotoPerfilController(manager, { desligamento = desligamentoDoProcesso, msPrazo } = {}) {
  /** @returns {import("../whatsapp/envio").ManagerEnvio} */
  const obterManager = () => manager ?? /** @type {import("../whatsapp/envio").ManagerEnvio} */ (/** @type {unknown} */ (require("../whatsapp/instanciaManager")));
  /** @type {import("express").RequestHandler} */
  const recusarDuranteEncerramento = (req, res, next) => desligamento.recusarDuranteEncerramento(req, res, next);

  return function FotoPerfilController(server) {
    server.post("/equipe/:cod_equipe/foto-perfil", exigirTokenServico, recusarDuranteEncerramento, async (req, res) => {
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
        const obter = /** @type {{ obterFotoPerfil?: import("../whatsapp/BaileysAdapter").BaileysAdapter["obterFotoPerfil"] }} */ (adapter).obterFotoPerfil;
        if (typeof obter !== "function") throw new ErroFoto("FALHA");
        const foto = await obter.call(adapter, dados.jid, { grupoJid: dados.grupo_jid, msPrazo });
        res.status(200).json(foto);
      } catch (erro) {
        if (erro instanceof ErroRequisicao) {
          res.status(400).json({ msg: erro.message });
          return;
        }
        if (erro instanceof ErroEnvio) {
          if (erro.codigo === "EQUIPE_DESCONECTADA") res.status(409).json({ msg: erro.message, codigo: "DESCONECTADA" });
          else res.status(STATUS_DO_ERRO[erro.codigo] ?? 500).json({ msg: erro.message });
          return;
        }
        if (erro instanceof ErroGrupo) {
          // DESCONECTADA (caiu no meio) ou FORA_DO_GRUPO; os demais códigos não existem nesta rota.
          if (erro.codigo === "DESCONECTADA" || erro.codigo === "FORA_DO_GRUPO") {
            res.status(409).json({ msg: erro.message, codigo: erro.codigo });
            return;
          }
        }
        if (erro instanceof ErroConsultaGrupo) {
          // O cache de participantes do grupo: equipe fora dele ou grupo que o WhatsApp não devolve → o jid não está nele.
          console.error(`[FOTO] Consulta do grupo da equipe ${cod} falhou: ${erro.codigo}`);
          if (erro.codigo === "GRUPO_NAO_ENCONTRADO") res.status(409).json({ msg: "Participante não encontrado no grupo.", codigo: "FORA_DO_GRUPO" });
          else if (erro.codigo === "PRAZO_ESGOTADO") res.status(504).json({ msg: "A consulta da foto não respondeu." });
          else res.status(502).json({ msg: MSG_FALHA_FOTO });
          return;
        }
        if (erro instanceof ErroFoto) {
          console.error(`[FOTO] Consulta de foto da equipe ${cod} falhou: ${erro.codigo}`);
          if (erro.codigo === "LIMITE_WHATSAPP") res.status(429).json({ msg: erro.message, codigo: erro.codigo });
          else if (erro.codigo === "PRAZO_ESGOTADO") res.status(504).json({ msg: erro.message });
          else res.status(502).json({ msg: erro.message });
          return;
        }
        console.error(`[FOTO] Erro inesperado na consulta de foto da equipe ${cod}:`, erro instanceof Error ? erro.name : "erro");
        res.status(500).json({ msg: "Erro interno ao consultar a foto." });
      }
    });
  };
}

const FotoPerfilController = criarFotoPerfilController();

module.exports = Object.assign(FotoPerfilController, { criarFotoPerfilController, ALLOWLIST_FOTO });
