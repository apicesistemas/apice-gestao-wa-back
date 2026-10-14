// @ts-check
// Camada 1 do fuso (SPEC §Constraints técnicas): precisa ser a primeira linha executada.
process.env.TZ = "America/Sao_Paulo";

const http = require("node:http");
const express = require("express");
const { registrarControllers } = require("./http");
const { ativarLogEmArquivo, limparLogsAntigos } = require("./utils/logArquivo");
const instanciaManager = require("./whatsapp/instanciaManager");

const PORTA_PADRAO = 3501;
const INTERVALO_LIMPEZA_LOGS_MS = 24 * 60 * 60 * 1000;
// Teto do desligamento gracioso (SIGINT/SIGTERM): se encerrar as instâncias Baileys ou fechar o HTTP
// travar, o processo sai assim mesmo, antes do kill_timeout do PM2 (12 s).
const MS_TETO_ENCERRAMENTO = 10 * 1000;

const VARS_OBRIGATORIAS = ["CRM_BACK_URL", "CRM_BACK_SERVICE_TOKEN", "WA_BACK_ADMIN_TOKEN"];

/**
 * Lista as variáveis de ambiente obrigatórias ausentes (vazias contam como ausentes).
 * @param {Record<string, string | undefined>} [env]
 * @returns {string[]}
 */
function validarVariaveisDeAmbiente(env = process.env) {
  return VARS_OBRIGATORIAS.filter((nome) => !env[nome]);
}

/**
 * Cria a aplicação Express com os controllers registrados.
 * @returns {import("express").Express}
 */
function criarApp() {
  const server = express();
  server.disable("x-powered-by");
  server.use(express.json());
  registrarControllers(server);
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

/**
 * Monta o encerramento gracioso: encerra as instâncias Baileys (sockets fechados com a sessão
 * intacta em disco), fecha o HTTP e sai com 0; se passar do teto, sai com 1.
 * Idempotente: SIGINT seguido de SIGTERM (terminal + supervisor) não encerra duas vezes.
 * @param {Pick<import("node:http").Server, "close">} httpServer
 * @param {{ sair?: (codigo: number) => void, tetoMs?: number, encerrarInstancias?: () => Promise<void> }} [opcoes]
 * @returns {(sinal: string) => void}
 */
function criarEncerrador(
  httpServer,
  {
    sair = (codigo) => process.exit(codigo),
    tetoMs = MS_TETO_ENCERRAMENTO,
    encerrarInstancias = () => instanciaManager.encerrarTodas(),
  } = {}
) {
  let encerrando = false;
  return (sinal) => {
    if (encerrando) return;
    encerrando = true;
    console.log(`[BOOT] Sinal ${sinal} recebido, encerrando graciosamente...`);

    const timeoutForcado = setTimeout(() => {
      console.error("[BOOT] Tempo esgotado no encerramento gracioso, forçando a saída.");
      sair(1);
    }, tetoMs);
    timeoutForcado.unref();

    Promise.resolve()
      .then(encerrarInstancias)
      .catch((erro) => {
        console.error("[BOOT] Falha ao encerrar as instâncias do WhatsApp:", erro instanceof Error ? erro.message : erro);
      })
      .then(() => {
        httpServer.close(() => {
          clearTimeout(timeoutForcado);
          sair(0);
        });
      });
  };
}

async function iniciar() {
  ativarLogEmArquivo();

  const faltando = validarVariaveisDeAmbiente();
  if (faltando.length > 0) {
    console.error(`[BOOT] Variáveis de ambiente obrigatórias ausentes: ${faltando.join(", ")}`);
    process.exit(1);
  }

  limparLogsAntigos();
  setInterval(() => limparLogsAntigos(), INTERVALO_LIMPEZA_LOGS_MS).unref();

  const porta = Number(process.env.SERVER_PORT) || PORTA_PADRAO;
  const httpServer = await iniciarServidor(porta);
  console.log(`[BOOT] apice-gestao-wa-back ouvindo na porta ${porta}`);

  // Só as equipes já pareadas e com sessão em disco; nenhuma gera QR sozinha no boot.
  instanciaManager
    .reconectarTodas()
    .then((reconectadas) => console.log(`[BOOT] Equipes reconectadas ao WhatsApp: ${reconectadas.length}`))
    .catch((erro) => console.error("[BOOT] Falha ao reconectar as equipes:", erro instanceof Error ? erro.message : erro));

  const encerrar = criarEncerrador(httpServer);
  process.on("SIGINT", () => encerrar("SIGINT"));
  process.on("SIGTERM", () => encerrar("SIGTERM"));
}

// Validação de env e boot só na execução real; importar este módulo (testes) não sobe nada.
if (require.main === module) {
  iniciar().catch((erro) => {
    console.error("[BOOT] Falha ao subir o servidor:", erro instanceof Error ? erro.message : erro);
    process.exit(1);
  });
}

module.exports = { criarApp, iniciarServidor, validarVariaveisDeAmbiente, criarEncerrador };
