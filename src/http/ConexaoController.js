// @ts-check
// Conexão WhatsApp por equipe. Só o back chama estas rotas (token de serviço em `X-Internal-Token`);
// o back já conferiu que a equipe é do tenant do usuário antes de repassar a chamada.
const instanciaManager = require("../whatsapp/instanciaManager");
const { normalizarCodEquipe } = require("../whatsapp/BaileysAdapter");
const exigirTokenServico = require("./exigirTokenServico");
const desligamentoDoProcesso = require("../utils/desligamento").padrao;

/** @typedef {Pick<typeof instanciaManager, "conectar" | "obter" | "desconectar" | "remover">} ManagerConexao */

/**
 * @param {unknown} valor
 * @returns {string | null}
 */
function codEquipeValido(valor) {
  try {
    return normalizarCodEquipe(/** @type {string} */ (valor));
  } catch {
    return null;
  }
}

/**
 * Monta o controller sobre um manager (o do processo, ou o dos testes).
 * @param {ManagerConexao} [manager]
 * @param {{ desligamento?: Pick<import("../utils/desligamento").Desligamento, "recusarDuranteEncerramento"> }} [opcoes]
 *   estado de desligamento (padrão: o do processo): durante o desligamento, conectar responde 503
 *   (um socket aberto no meio do encerramento ficaria sem fechar)
 * @returns {(server: import("express").Express) => void}
 */
function criarConexaoController(manager = instanciaManager, { desligamento = desligamentoDoProcesso } = {}) {
  /** @type {import("express").RequestHandler} */
  const recusarDuranteEncerramento = (req, res, next) => desligamento.recusarDuranteEncerramento(req, res, next);

  return function ConexaoController(server) {
    server.post("/equipe/:cod_equipe/conectar", exigirTokenServico, recusarDuranteEncerramento, async (req, res) => {
      const cod = codEquipeValido(req.params.cod_equipe);
      if (!cod) {
        res.status(400).json({ msg: "Código da equipe inválido." });
        return;
      }
      const hashEmpresa = req.body?.hash_empresa;
      if (typeof hashEmpresa !== "string" || hashEmpresa.trim() === "") {
        res.status(400).json({ msg: "Informe o hash_empresa da equipe." });
        return;
      }

      try {
        const instancia = await manager.conectar(cod, hashEmpresa);
        res.status(200).json({
          msg: "Conexão da equipe iniciada.",
          cod_equipe: Number(cod),
          ...instancia.obterStatusConexao(),
        });
      } catch (erro) {
        if (erro instanceof instanciaManager.ErroConexaoEquipe && erro.codigo === "EQUIPE_OUTRA_EMPRESA") {
          res.status(409).json({ msg: "Esta equipe já está conectada por outra empresa." });
          return;
        }
        console.error(`[CONEXAO] Falha ao conectar a equipe ${cod}:`, erro instanceof Error ? erro.message : erro);
        res.status(500).json({ msg: "Erro ao conectar o WhatsApp da equipe." });
      }
    });

    /**
     * Canal D. POST /equipe/:cod_equipe/desconectar (back waConexaoService.desconectar). Entrada:
     * { hash_empresa }. Saída 200: { msg, cod_equipe, status_conexao: "DESCONECTADO",
     * ultimo_erro_conexao: null, havia_sessao, remocao_aparelho: "CONFIRMADA" | "NAO_CONFIRMADA" |
     * "SEM_PAREAMENTO" }. 400 código/hash inválido, 409 outra empresa, 503 no encerramento, 500.
     */
    server.post("/equipe/:cod_equipe/desconectar", exigirTokenServico, recusarDuranteEncerramento, async (req, res) => {
      const cod = codEquipeValido(req.params.cod_equipe);
      if (!cod) {
        res.status(400).json({ msg: "Código da equipe inválido." });
        return;
      }
      const hashEmpresa = req.body?.hash_empresa;
      if (typeof hashEmpresa !== "string" || hashEmpresa.trim() === "") {
        res.status(400).json({ msg: "Informe o hash_empresa da equipe." });
        return;
      }

      try {
        const { havia_sessao, remocao_aparelho } = await manager.desconectar(cod, hashEmpresa);
        res.status(200).json({
          msg: "WhatsApp da equipe desconectado.",
          cod_equipe: Number(cod),
          status_conexao: "DESCONECTADO",
          ultimo_erro_conexao: null,
          havia_sessao,
          remocao_aparelho,
        });
      } catch (erro) {
        if (erro instanceof instanciaManager.ErroConexaoEquipe && erro.codigo === "EQUIPE_OUTRA_EMPRESA") {
          res.status(409).json({ msg: "Esta equipe já está conectada por outra empresa." });
          return;
        }
        // Só o nome do erro: a mensagem pode trazer JID ou telefone.
        console.error(`[CONEXAO] Falha ao desconectar a equipe ${cod}:`, erro instanceof Error ? erro.name : "erro");
        res.status(500).json({ msg: "Erro ao desconectar o WhatsApp da equipe." });
      }
    });

    /**
     * Canal D. POST /equipe/:cod_equipe/remover (back waConexaoService.remover, exclusão completa da
     * equipe, Fase 26). Entrada: { hash_empresa }. Saída 200: { msg: "Equipe removida do WhatsApp.",
     * cod_equipe, status_conexao: "DESCONECTADO", ultimo_erro_conexao: null, havia_sessao,
     * remocao_aparelho: "CONFIRMADA" | "NAO_CONFIRMADA" | "SEM_PAREAMENTO", instancia_descartada }.
     * Faz o fluxo do /desconectar e tira a instância do processo. Idempotente. 400 código/hash
     * inválido, 401 sem token, 409 outra empresa (nada é tocado), 503 + Retry-After no encerramento,
     * 500 sem vazar o erro.
     */
    server.post("/equipe/:cod_equipe/remover", exigirTokenServico, recusarDuranteEncerramento, async (req, res) => {
      const cod = codEquipeValido(req.params.cod_equipe);
      if (!cod) {
        res.status(400).json({ msg: "Código da equipe inválido." });
        return;
      }
      const hashEmpresa = req.body?.hash_empresa;
      if (typeof hashEmpresa !== "string" || hashEmpresa.trim() === "") {
        res.status(400).json({ msg: "Informe o hash_empresa da equipe." });
        return;
      }

      try {
        const { havia_sessao, remocao_aparelho, instancia_descartada } = await manager.remover(cod, hashEmpresa);
        res.status(200).json({
          msg: "Equipe removida do WhatsApp.",
          cod_equipe: Number(cod),
          status_conexao: "DESCONECTADO",
          ultimo_erro_conexao: null,
          havia_sessao,
          remocao_aparelho,
          instancia_descartada,
        });
      } catch (erro) {
        if (erro instanceof instanciaManager.ErroConexaoEquipe && erro.codigo === "EQUIPE_OUTRA_EMPRESA") {
          res.status(409).json({ msg: "Esta equipe já está conectada por outra empresa." });
          return;
        }
        // Só o nome do erro: a mensagem pode trazer JID ou telefone.
        console.error(`[CONEXAO] Falha ao remover a equipe ${cod}:`, erro instanceof Error ? erro.name : "erro");
        res.status(500).json({ msg: "Erro ao remover a equipe do WhatsApp." });
      }
    });

    server.get("/equipe/:cod_equipe/qr", exigirTokenServico, async (req, res) => {
      const cod = codEquipeValido(req.params.cod_equipe);
      if (!cod) {
        res.status(400).json({ msg: "Código da equipe inválido." });
        return;
      }
      const png = (await manager.obter(cod)?.obterQrPng()) ?? null;
      if (!png) {
        res.status(404).json({ msg: "Nenhum QR Code pendente para esta equipe." });
        return;
      }
      res.set("Content-Type", "image/png");
      res.set("Cache-Control", "no-store");
      res.status(200).send(png);
    });
  };
}

const ConexaoController = criarConexaoController();

module.exports = Object.assign(ConexaoController, { criarConexaoController });
