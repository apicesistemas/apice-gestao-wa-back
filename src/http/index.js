// @ts-check
const HealthController = require("./HealthController");
const ConexaoController = require("./ConexaoController");
const EnvioController = require("./EnvioController");
const GrupoController = require("./GrupoController");
const FotoPerfilController = require("./FotoPerfilController");
const IaController = require("./IaController");
const ContatoController = require("./ContatoController");

/** @typedef {(server: import("express").Express) => void} Controller */

/**
 * Tabela de controllers do wa-back. Cada controller registra as próprias rotas direto no Express
 * (sem `express.Router()`). Controller novo entra aqui.
 * @type {Controller[]}
 */
const CONTROLLERS = [HealthController, ConexaoController, EnvioController, GrupoController, FotoPerfilController, IaController, ContatoController];

/**
 * Registra os controllers e, depois deles, o 404 e o tratador de erros em pt-BR.
 * @param {import("express").Express} server
 * @param {Controller[]} [controllers] lista a registrar (padrão: `CONTROLLERS`; os testes passam a sua)
 */
function registrarControllers(server, controllers = CONTROLLERS) {
  for (const controller of controllers) controller(server);

  server.use((_req, res) => {
    res.status(404).json({ msg: "Rota não encontrada." });
  });

  /** @type {import("express").ErrorRequestHandler} */
  const tratadorErros = (erro, _req, res, next) => {
    if (res.headersSent) return next(erro); // resposta já começou: o Express encerra a conexão
    // JSON malformado no body (express.json) é erro do cliente, não do servidor.
    if (erro && erro.type === "entity.parse.failed") {
      res.status(400).json({ msg: "Corpo da requisição inválido." });
      return;
    }
    // Detalhe só no log (já mascarado pelo logArquivo); a resposta nunca leva stack nem err.message.
    console.error("[HTTP] Erro não tratado:", erro instanceof Error ? erro.message : erro);
    res.status(500).json({ msg: "Erro interno do servidor." });
  };
  server.use(tratadorErros);
}

module.exports = { registrarControllers, CONTROLLERS };
