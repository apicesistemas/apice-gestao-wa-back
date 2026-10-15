// @ts-check
// Camada 1 do fuso (SPEC §Constraints técnicas): precisa ser a primeira linha executada.
process.env.TZ = "America/Sao_Paulo";

const http = require("node:http");
const express = require("express");
const { registrarControllers } = require("./http");
const { ativarLogEmArquivo, limparLogsAntigos } = require("./utils/logArquivo");
const instanciaManager = require("./whatsapp/instanciaManager");
const { criarInstanciaHealth } = require("./whatsapp/instanciaHealth");
const desligamentoDoProcesso = require("./utils/desligamento").padrao;
const tmpMidia = require("./whatsapp/tmpMidia");

/** Heartbeat das conexões por equipe (a cada 60 s), ligado depois da reconexão do boot. */
const heartbeat = criarInstanciaHealth();

const PORTA_PADRAO = 3501;
const INTERVALO_LIMPEZA_LOGS_MS = 24 * 60 * 60 * 1000;
// Teto do desligamento gracioso (SIGINT/SIGTERM): se encerrar as instâncias Baileys ou fechar o HTTP
// travar, o processo sai assim mesmo, antes do kill_timeout do PM2 (12 s, em ecosystem.config.cjs;
// tests/ecosystem.config.test.js garante que o kill_timeout fica acima deste teto).
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
 * Monta o encerramento gracioso (Task 14.3), tudo dentro do teto:
 * 1. marca o processo como encerrando, já no sinal: enviar, reagir e conectar passam a responder
 *    503 (nenhum pedido é aceito e descartado em silêncio);
 * 2. espera os envios que já estavam em andamento responderem;
 * 3. encerra as instâncias Baileys SEM logout, cada uma esperando o `saveCreds` em andamento
 *    (sessão intacta em disco: o boot seguinte reconecta sem QR);
 * 4. apaga os temporários cifrados de upload de mídia do Baileys (exceção 14b, `tmpMidia`);
 * 5. fecha o HTTP e sai com 0. Se passar do teto, apaga os temporários e sai com 1.
 * Idempotente: SIGINT seguido de SIGTERM (terminal + supervisor) não encerra duas vezes.
 * @param {Pick<import("node:http").Server, "close">} httpServer
 * @param {{
 *   sair?: (codigo: number) => void,
 *   tetoMs?: number,
 *   encerrarInstancias?: () => Promise<void>,
 *   limparTemporarios?: () => unknown,
 *   desligamento?: Pick<import("./utils/desligamento").Desligamento, "marcarEncerrando" | "aguardarEmAndamento">,
 * }} [opcoes]
 * @returns {(sinal: string) => void}
 */
function criarEncerrador(
  httpServer,
  {
    sair = (codigo) => process.exit(codigo),
    tetoMs = MS_TETO_ENCERRAMENTO,
    encerrarInstancias = () => {
      heartbeat.parar(); // nenhuma reconexão do heartbeat começa durante o encerramento
      return instanciaManager.encerrarTodas();
    },
    limparTemporarios = () => tmpMidia.limparPastaConfigurada(),
    desligamento = desligamentoDoProcesso,
  } = {}
) {
  let encerrando = false;
  // Nunca derruba o encerramento: uma falha só vai ao log.
  const limparSemFalhar = () => {
    try {
      limparTemporarios();
    } catch (erro) {
      console.error("[BOOT] Falha ao apagar os temporários de mídia:", erro instanceof Error ? erro.name : "erro");
    }
  };
  return (sinal) => {
    if (encerrando) return;
    encerrando = true;
    desligamento.marcarEncerrando(); // síncrono: a partir daqui os envios novos recebem 503
    console.log(`[BOOT] Sinal ${sinal} recebido, encerrando graciosamente...`);

    const timeoutForcado = setTimeout(() => {
      console.error("[BOOT] Tempo esgotado no encerramento gracioso, forçando a saída.");
      limparSemFalhar();
      sair(1);
    }, tetoMs);
    timeoutForcado.unref();

    Promise.resolve()
      .then(() => desligamento.aguardarEmAndamento())
      .then(encerrarInstancias)
      .catch((erro) => {
        console.error("[BOOT] Falha ao encerrar as instâncias do WhatsApp:", erro instanceof Error ? erro.message : erro);
      })
      .then(() => {
        limparSemFalhar();
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

  // Exceção 14b: o temporário cifrado do upload de mídia do Baileys vai para uma pasta dedicada,
  // apontada antes de qualquer instância subir. O que sobrou de uma queda é apagado aqui.
  const { removidos } = tmpMidia.configurarPastaTemporaria();
  if (removidos > 0) console.log(`[BOOT] Temporários de mídia de uma execução anterior apagados: ${removidos}`);

  const porta = Number(process.env.SERVER_PORT) || PORTA_PADRAO;
  const httpServer = await iniciarServidor(porta);
  console.log(`[BOOT] apice-gestao-wa-back ouvindo na porta ${porta}`);

  // Só as equipes já pareadas e com sessão em disco; nenhuma gera QR sozinha no boot.
  instanciaManager
    .reconectarTodas()
    .then((reconectadas) => console.log(`[BOOT] Equipes reconectadas ao WhatsApp: ${reconectadas.length}`))
    .catch((erro) => console.error("[BOOT] Falha ao reconectar as equipes:", erro instanceof Error ? erro.message : erro))
    .finally(() => heartbeat.iniciar());

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

module.exports = { criarApp, iniciarServidor, validarVariaveisDeAmbiente, criarEncerrador, MS_TETO_ENCERRAMENTO };
