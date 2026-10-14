// @ts-check

/**
 * Rotas de saúde do processo, sem token (só respondem se o processo está de pé, sem dado algum).
 * O wa-back escuta apenas na rede interna; as rotas de negócio exigem `exigirTokenServico`.
 * @param {import("express").Express} server
 */
function HealthController(server) {
  server.get("/ping", (_req, res) => {
    res.status(200).send("ok");
  });
  server.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });
}

module.exports = HealthController;
