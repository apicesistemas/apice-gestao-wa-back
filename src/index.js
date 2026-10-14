// @ts-check
// Camada 1 do fuso (SPEC §Constraints técnicas): precisa ser a primeira linha executada.
process.env.TZ = "America/Sao_Paulo";

const http = require("node:http");
const express = require("express");
const { registrarHealth } = require("./http/health");

/**
 * Cria a aplicação Express com as rotas de infraestrutura.
 * @returns {import("express").Express}
 */
function criarApp() {
  const server = express();
  server.disable("x-powered-by");
  server.use(express.json());
  registrarHealth(server);
  return server;
}

/**
 * Sobe o servidor HTTP na porta informada (0 = porta livre, usado nos testes).
 * @param {number} porta
 * @returns {Promise<import("node:http").Server>}
 */
function iniciarServidor(porta) {
  const httpServer = http.createServer(criarApp());
  return new Promise((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(porta, () => resolve(httpServer));
  });
}

if (require.main === module) {
  const porta = Number(process.env.SERVER_PORT) || 3501;
  iniciarServidor(porta)
    .then(() => console.log(`[BOOT] apice-gestao-wa-back ouvindo na porta ${porta}`))
    .catch((erro) => {
      console.error("[BOOT] Falha ao subir o servidor:", erro.message);
      process.exit(1);
    });
}

module.exports = { criarApp, iniciarServidor };
