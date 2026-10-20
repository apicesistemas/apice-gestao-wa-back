// @ts-check
// Portão de concorrência da IA de texto (Fase 31, Task 31.1): semáforo com `MINIMAX_IA_CONCORRENCIA`
// vagas (padrão 1). A MiniMax limita as conexões por chave (a transcrição já levou 429 "conn limit"
// com paralelismo), então as sugestões esperam a vez. A espera conta no prazo do pedido: quem não
// consegue a vaga a tempo desiste (sem chamar a MiniMax) e sai da fila. A vaga volta no `finally`,
// de modo que erro numa tarefa nunca trava a próxima.
//
// Este portão é independente da `filaTranscricao`. Se a homologação mostrar 429 com transcrição e
// sugestão ao mesmo tempo, unificar os dois (dando prioridade à sugestão) é a saída prevista no PLAN.

/** Concorrência padrão: 1, como a fila de transcrição. É teto técnico do provedor, não regra de negócio. */
const CONCORRENCIA_PADRAO = 1;

/**
 * Lê `MINIMAX_IA_CONCORRENCIA`: inteiro ≥ 1; ausente ou inválido volta ao padrão.
 * @param {Record<string, string | undefined>} [env]
 * @returns {number}
 */
function concorrenciaDoAmbiente(env = process.env) {
  const n = Number((env.MINIMAX_IA_CONCORRENCIA ?? "").trim());
  return Number.isInteger(n) && n >= 1 ? n : CONCORRENCIA_PADRAO;
}

/**
 * @typedef {{ prazoEsgotado: true } | { prazoEsgotado: false, valor: any }} ResultadoPortao
 */

/**
 * @param {number} [concorrencia]
 * @param {() => number} [agora] relógio em ms (os testes não precisam trocar)
 */
function criarPortaoIa(concorrencia = concorrenciaDoAmbiente(), agora = Date.now) {
  let emUso = 0;
  /** @type {{ liberar: () => void }[]} */
  const fila = [];

  function passarAVez() {
    while (emUso < concorrencia && fila.length > 0) {
      const proximo = /** @type {{ liberar: () => void }} */ (fila.shift());
      emUso += 1;
      proximo.liberar();
    }
  }

  /**
   * Espera uma vaga por no máximo `prazoMs`.
   * @param {number} prazoMs
   * @returns {Promise<boolean>} true com a vaga em mãos; false se o prazo acabou antes
   */
  function esperarVaga(prazoMs) {
    if (emUso < concorrencia && fila.length === 0) {
      emUso += 1;
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      /** @type {NodeJS.Timeout | undefined} */
      let timer;
      const entrada = {
        liberar: () => {
          clearTimeout(timer);
          resolve(true);
        },
      };
      fila.push(entrada);
      timer = setTimeout(() => {
        const i = fila.indexOf(entrada);
        if (i === -1) return;
        fila.splice(i, 1);
        resolve(false);
      }, Math.max(0, prazoMs));
    });
  }

  /**
   * Executa `tarefa(restanteMs)` quando houver vaga. `restanteMs` é o prazo menos a espera.
   * Nunca rejeita por causa do prazo: devolve `{ prazoEsgotado: true }`. Erro da tarefa propaga,
   * depois de liberar a vaga.
   * @param {number} prazoMs
   * @param {(restanteMs: number) => Promise<any>} tarefa
   * @returns {Promise<ResultadoPortao>}
   */
  async function executar(prazoMs, tarefa) {
    const inicio = agora();
    if (!(await esperarVaga(prazoMs))) return { prazoEsgotado: true };
    try {
      const restante = prazoMs - (agora() - inicio);
      if (restante <= 0) return { prazoEsgotado: true };
      return { prazoEsgotado: false, valor: await tarefa(restante) };
    } finally {
      emUso -= 1;
      passarAVez();
    }
  }

  return { executar, concorrencia };
}

/** @type {ReturnType<typeof criarPortaoIa> | undefined} */
let padrao;
/** Portão do processo (um só para todas as equipes, como a fila de transcrição). */
function portaoPadrao() {
  padrao ??= criarPortaoIa();
  return padrao;
}

module.exports = { criarPortaoIa, concorrenciaDoAmbiente, portaoPadrao, CONCORRENCIA_PADRAO };
