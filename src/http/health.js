// @ts-check

/**
 * Rota de saúde do processo. Sem dependência do WhatsApp nem regra de negócio.
 * @param {import("express").Express} server
 */
function registrarHealth(server) {
  server.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });
}

module.exports = { registrarHealth };
