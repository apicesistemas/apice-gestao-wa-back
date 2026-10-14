// @ts-check
// Conexão WhatsApp por equipe. Só o back chama estas rotas (token de serviço em `X-Internal-Token`);
// o back já conferiu que a equipe é do tenant do usuário antes de repassar a chamada.
const instanciaManager = require("../whatsapp/instanciaManager");
const { normalizarCodEquipe } = require("../whatsapp/BaileysAdapter");
const exigirTokenServico = require("./exigirTokenServico");

/** @typedef {Pick<typeof instanciaManager, "conectar" | "obter">} ManagerConexao */

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
 * @returns {(server: import("express").Express) => void}
 */
function criarConexaoController(manager = instanciaManager) {
  return function ConexaoController(server) {
    server.post("/equipe/:cod_equipe/conectar", exigirTokenServico, async (req, res) => {
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
