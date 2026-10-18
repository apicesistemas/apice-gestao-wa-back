// @ts-check
// Estado de desligamento do processo (Task 14.3). No SIGTERM/SIGINT o encerrador chama
// `marcarEncerrando()` antes de qualquer outra coisa: a partir daí as rotas que mexem no WhatsApp
// (enviar, reagir, conectar) respondem 503 com `{ msg }` e Retry-After, então nenhum pedido é aceito
// e descartado em silêncio. As requisições que já tinham entrado são rastreadas até a resposta fechar
// e podem terminar dentro do teto do encerramento (`aguardarEmAndamento`).

const MSG_REINICIANDO = "Serviço de WhatsApp reiniciando. Tente novamente em instantes.";
/** Sugestão de nova tentativa ao back (segundos): o restart do PM2 leva poucos segundos. */
const SEGUNDOS_RETRY_AFTER = 10;

function criarDesligamento() {
  let encerrando = false;
  let emAndamento = 0;
  /** @type {Set<() => void>} quem espera as requisições em andamento terminarem */
  const esperando = new Set();
  /** @type {(() => void)[]} quem precisa parar o que está em andamento assim que o desligamento começa */
  const aoIniciarEncerramento = [];

  function avisarSeVazio() {
    if (emAndamento > 0) return;
    for (const resolver of esperando) resolver();
    esperando.clear();
  }

  /**
   * Middleware: 503 durante o desligamento; fora dele, rastreia a requisição até a resposta fechar.
   * Vai DEPOIS do `exigirTokenServico` (sem token continua 401) e antes de ler o corpo.
   * @type {import("express").RequestHandler}
   */
  function recusarDuranteEncerramento(_req, res, next) {
    if (encerrando) {
      res.set("Retry-After", String(SEGUNDOS_RETRY_AFTER)).status(503).json({ msg: MSG_REINICIANDO });
      return;
    }
    emAndamento += 1;
    let fechada = false;
    res.once("close", () => {
      if (fechada) return;
      fechada = true;
      emAndamento -= 1;
      avisarSeVazio();
    });
    next();
  }

  /**
   * Espera as requisições que entraram antes do desligamento responderem (o teto fica com o encerrador).
   * @returns {Promise<void>}
   */
  function aguardarEmAndamento() {
    if (emAndamento === 0) return Promise.resolve();
    return new Promise((resolve) => esperando.add(() => resolve()));
  }

  return {
    marcarEncerrando: () => {
      encerrando = true;
      for (const aviso of aoIniciarEncerramento) {
        try {
          aviso();
        } catch (erro) {
          console.error("[DESLIGAMENTO] Falha ao avisar uma operação em andamento:", erro instanceof Error ? erro.name : "erro");
        }
      }
    },
    /**
     * Registra o que roda quando o desligamento começa (ex.: interromper a adição de participantes,
     * cujo sono entre as adições não pode segurar o teto do encerramento).
     * @param {() => void} aviso
     */
    aoIniciarEncerramento: (aviso) => {
      aoIniciarEncerramento.push(aviso);
    },
    estaEncerrando: () => encerrando,
    emAndamento: () => emAndamento,
    recusarDuranteEncerramento,
    aguardarEmAndamento,
  };
}

/** @typedef {ReturnType<typeof criarDesligamento>} Desligamento */

/** Estado do processo (o PM2 roda `instances: 1`). Os testes criam o seu com `criarDesligamento`. */
const padrao = criarDesligamento();

module.exports = { ...padrao, padrao, criarDesligamento, MSG_REINICIANDO, SEGUNDOS_RETRY_AFTER };
