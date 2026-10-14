// @ts-check
// Fila de transcrição: concorrência 1 contra a MiniMax, uma nova tentativa em falha transitória e
// o resultado registrado no back (`POST /interno/transcricao`). Base: `filaMinimax.js` do
// comandax_crm_wa_back e do apice-financeiro-wa-wa-back. Lá, 6 áudios transcritos em paralelo
// derrubaram 5 com HTTP 429 "conn limit (1041)": a MiniMax limita as conexões por chave, então a
// fila é UMA só para o processo inteiro (todas as equipes usam a mesma chave). Duas filas de 1
// seriam concorrência 2, e o 429 volta.
//
// - A vez na fila cobre a chamada, a leitura do corpo, a espera e a nova tentativa: o próximo
//   áudio só chama a MiniMax quando o anterior terminou de vez.
// - O registro no back acontece FORA da vez (não usa a MiniMax e não deve segurar a fila).
// - Nunca rejeita e nunca trava: uma falha vira status, e um erro inesperado vira FALHOU.
// - A fila de entrada da equipe (BaileysAdapter) não espera a transcrição.
//
// ponytail: as tarefas esperando guardam o buffer em memória (até o teto de mídia cada). Com um
// volume que acumule muitos vídeos na fila, pôr um teto de tarefas pendentes.
const transcricaoService = require("./transcricaoService");
const transcricaoInternoClient = require("../services/transcricaoInternoClient");

/** Espera antes da nova tentativa (mesmo valor das referências, só para atravessar um pico). */
const ESPERA_NOVA_TENTATIVA_MS = 2000;

/** @typedef {import("./transcricaoService").ResultadoTranscricao} ResultadoTranscricao */
/** @typedef {import("../services/transcricaoInternoClient").StatusTranscricao} StatusTranscricao */
/** @typedef {import("../services/mensagemInternoClient").ContextoInstancia} ContextoInstancia */
/**
 * @typedef {{
 *   mensagem_wa_id: string,
 *   buffer: Buffer,
 *   mimetype: string,
 *   duracao_segundos: number | null,
 *   contexto: ContextoInstancia,
 * }} TarefaTranscricao
 */
/** @typedef {{ status: StatusTranscricao, texto: string | null }} DesfechoTranscricao */
/**
 * @typedef {{
 *   transcrever?: (buffer: Buffer, mimetype: string, opcoes: { duracaoSegundos: number | null }) => Promise<ResultadoTranscricao>,
 *   registrarTranscricao?: (mensagem_wa_id: string, resultado: DesfechoTranscricao, contexto: ContextoInstancia) => Promise<unknown>,
 *   esperar?: (ms: number) => Promise<void>,
 * }} DependenciasFila
 */

/** @param {number} ms */
const esperarDeVerdade = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Resumo da falha de registro para o log (sem mensagem do erro nem conteúdo).
 * @param {unknown} erro
 */
function resumoFalha(erro) {
  const { name, tipo, status } = /** @type {{ name?: unknown, tipo?: unknown, status?: unknown }} */ (erro && typeof erro === "object" ? erro : {});
  return [typeof name === "string" ? name : "erro", typeof tipo === "string" ? tipo : "", typeof status === "number" ? `HTTP ${status}` : ""].filter(Boolean).join(" ");
}

/**
 * Status final a partir do resultado (já depois da nova tentativa).
 * @param {ResultadoTranscricao} resultado
 * @returns {DesfechoTranscricao}
 */
function desfecho(resultado) {
  if ("texto" in resultado) return { status: "CONCLUIDA", texto: resultado.texto };
  // Transitório que persistiu, ou chave ainda não configurada: dá para transcrever depois.
  if (resultado.transitorio || resultado.erro === "SEM_CHAVE") return { status: "PENDENTE", texto: null };
  return { status: "FALHOU", texto: null };
}

/**
 * Cria uma fila de concorrência 1. O processo usa a instância padrão (`enfileirarTranscricao`);
 * os testes criam a própria com dependências trocadas.
 * @param {DependenciasFila} [dependencias]
 */
function criarFilaTranscricao({
  transcrever = transcricaoService.transcrever,
  registrarTranscricao = transcricaoInternoClient.registrarTranscricao,
  esperar = esperarDeVerdade,
} = {}) {
  /** @type {Promise<unknown>} */
  let cadeia = Promise.resolve();

  /**
   * Uma chamada e, se a falha for transitória, uma nova tentativa depois da espera.
   * @param {TarefaTranscricao} tarefa
   * @returns {Promise<ResultadoTranscricao>}
   */
  async function transcreverComNovaTentativa(tarefa) {
    const opcoes = { duracaoSegundos: tarefa.duracao_segundos ?? null };
    const primeira = await transcrever(tarefa.buffer, tarefa.mimetype, opcoes);
    if ("texto" in primeira || !primeira.transitorio) return primeira;
    await esperar(ESPERA_NOVA_TENTATIVA_MS);
    return transcrever(tarefa.buffer, tarefa.mimetype, opcoes);
  }

  /**
   * Põe a transcrição na fila e registra o resultado no back. Nunca rejeita.
   * @param {TarefaTranscricao} tarefa
   * @returns {Promise<DesfechoTranscricao>}
   */
  async function enfileirarTranscricao(tarefa) {
    const id = tarefa.mensagem_wa_id;
    const vez = cadeia.then(() => transcreverComNovaTentativa(tarefa));
    cadeia = vez.catch(() => {}); // uma tarefa com erro não trava as próximas

    /** @type {DesfechoTranscricao} */
    let resultado;
    try {
      const transcricao = await vez;
      resultado = desfecho(transcricao);
      if ("erro" in transcricao) console.log(`[TRANSCRICAO] Mensagem ${id}: ${resultado.status} (${transcricao.erro})`);
    } catch (erro) {
      console.error(`[TRANSCRICAO] Falha inesperada ao transcrever a mensagem ${id}:`, resumoFalha(erro));
      resultado = { status: "FALHOU", texto: null };
    }

    try {
      await registrarTranscricao(id, resultado, tarefa.contexto);
    } catch (erro) {
      console.error(`[TRANSCRICAO] Falha ao registrar a transcrição da mensagem ${id} no back:`, resumoFalha(erro));
    }
    return resultado;
  }

  return { enfileirarTranscricao };
}

/** Fila única do processo (todas as equipes): concorrência 1 contra a mesma chave da MiniMax. */
const filaPadrao = criarFilaTranscricao();

module.exports = {
  criarFilaTranscricao,
  enfileirarTranscricao: filaPadrao.enfileirarTranscricao,
  ESPERA_NOVA_TENTATIVA_MS,
};
