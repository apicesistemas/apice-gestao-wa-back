// @ts-check
const crypto = require("node:crypto");

/**
 * Compara dois segredos em tempo constante (evita descobrir o token byte a byte pela latência).
 * @param {string} recebido
 * @param {string} esperado
 * @returns {boolean}
 */
function tokensIguais(recebido, esperado) {
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Exige o token de serviço do back no header `X-Internal-Token` (nunca na query string, que vai
 * para log de acesso e proxy). Mesmo header que o wa-back envia ao back, com segredo diferente em
 * cada direção: `WA_BACK_ADMIN_TOKEN` aqui (back → wa-back), `CRM_BACK_SERVICE_TOKEN` lá.
 * Sem token configurado no ambiente, nada passa.
 * @type {import("express").RequestHandler}
 */
function exigirTokenServico(req, res, next) {
  const esperado = process.env.WA_BACK_ADMIN_TOKEN;
  const recebido = req.headers["x-internal-token"];
  if (!esperado || typeof recebido !== "string" || !tokensIguais(recebido, esperado)) {
    res.status(401).json({ msg: "Acesso negado. Token de serviço inválido." });
    return;
  }
  next();
}

module.exports = exigirTokenServico;
