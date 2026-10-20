// @ts-check
// Rotas de saúde do processo, sem token (Task 15.3). O wa-back escuta apenas no loopback
// (`SERVER_HOST`, padrão 127.0.0.1; src/index.js) e as rotas de negócio exigem `exigirTokenServico`;
// estas ficam abertas para o PM2, o deploy.sh e o monitor da própria máquina consultarem sem
// segredo, por isso não levam dado sensível algum.
//
// `GET /ping`: `{ status, versao, encerrando, equipes: [{ cod_equipe, status, desde? }] }`. Nunca
// JID, telefone, LID, nome do número, QR, texto de erro nem hash_empresa. Durante o desligamento
// gracioso responde 503 (`status: "encerrando"`, `Retry-After`), então o health-check do deploy e o
// monitor não contam como pronto um processo que está saindo. Uma falha ao ler o status das equipes
// não derruba o ping: o processo está de pé, e as equipes vêm vazias.
const fs = require("node:fs");
const path = require("node:path");
const instanciaManager = require("../whatsapp/instanciaManager");
const desligamentoDoProcesso = require("../utils/desligamento").padrao;
const { SEGUNDOS_RETRY_AFTER } = require("../utils/desligamento");
const { version: VERSAO } = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "package.json"), "utf8"));

/** @typedef {import("../whatsapp/instanciaManager").StatusEquipe} StatusEquipe */

/**
 * Monta o controller sobre um manager e um estado de desligamento (os do processo, ou os dos testes).
 * @param {{
 *   manager?: { listarStatus: () => StatusEquipe[] },
 *   desligamento?: Pick<import("../utils/desligamento").Desligamento, "estaEncerrando">,
 *   versao?: string,
 * }} [opcoes]
 * @returns {(server: import("express").Express) => void}
 */
function criarHealthController({ manager = instanciaManager, desligamento = desligamentoDoProcesso, versao = VERSAO } = {}) {
  /** @returns {StatusEquipe[]} só os campos permitidos, mesmo que o manager devolva mais */
  function equipes() {
    try {
      return manager.listarStatus().map(({ cod_equipe, status, desde }) => (desde ? { cod_equipe, status, desde } : { cod_equipe, status }));
    } catch (erro) {
      console.error("[HEALTH] Falha ao ler o status das equipes:", erro instanceof Error ? erro.name : "erro");
      return [];
    }
  }

  return function HealthController(server) {
    server.get("/ping", (_req, res) => {
      const encerrando = desligamento.estaEncerrando();
      res.set("Cache-Control", "no-store");
      if (encerrando) res.set("Retry-After", String(SEGUNDOS_RETRY_AFTER));
      res.status(encerrando ? 503 : 200).json({
        status: encerrando ? "encerrando" : "ok",
        versao,
        encerrando,
        equipes: equipes(),
      });
    });
    server.get("/health", (_req, res) => {
      res.status(200).json({ status: "ok" });
    });
  };
}

const HealthController = criarHealthController();

module.exports = Object.assign(HealthController, { criarHealthController });
