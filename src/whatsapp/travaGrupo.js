// @ts-check
// Trava das operações de grupo (Fase 28): UMA operação de grupo por equipe de cada vez (adicionar
// participantes, e a criação de grupo da Fase 29). Fica separada do `comTrava` do instanciaManager, que
// serializa conectar/desconectar/remover e esperaria a operação terminar; aqui a segunda chamada é
// recusada na hora (409 OCUPADA), porque a operação mexe no WhatsApp com intervalo de segundos.
//
// Cada operação recebe um `AbortSignal`. `abortar(cod)` (desconectar e remover da equipe) e
// `abortarTodas()` (desligamento) interrompem o laço e LIBERAM a trava na hora: quem chega depois
// encontra a equipe desconectada (409 DESCONECTADA), nunca "ocupada" por uma operação que já parou.
// O `sair` da operação interrompida não derruba a trava de uma operação nova (compara o sinal).
// Só memória; nada de JID, telefone ou conteúdo.

function criarTravaGrupo() {
  /** @type {Map<string, AbortController>} */
  const operacoes = new Map();

  return {
    /**
     * Começa uma operação de grupo da equipe.
     * @param {string | number} cod
     * @returns {AbortSignal | null} o sinal de aborto, ou null quando a equipe já tem uma operação
     */
    entrar(cod) {
      const chave = String(cod);
      if (operacoes.has(chave)) return null;
      const controlador = new AbortController();
      operacoes.set(chave, controlador);
      return controlador.signal;
    },

    /**
     * Termina a operação (chamar no `finally`). Com o `sinal` da operação, só libera se a trava
     * ainda for dela (uma operação interrompida não derruba a seguinte).
     * @param {string | number} cod
     * @param {AbortSignal} [sinal]
     */
    sair(cod, sinal) {
      const chave = String(cod);
      const atual = operacoes.get(chave);
      if (!atual) return;
      if (sinal && atual.signal !== sinal) return;
      operacoes.delete(chave);
    },

    /**
     * Interrompe a operação da equipe (se houver) e libera a trava.
     * @param {string | number} cod
     * @returns {boolean} havia operação em andamento
     */
    abortar(cod) {
      const chave = String(cod);
      const atual = operacoes.get(chave);
      if (!atual) return false;
      operacoes.delete(chave);
      atual.abort();
      return true;
    },

    /** Interrompe todas as operações (desligamento gracioso). */
    abortarTodas() {
      const todas = [...operacoes.values()];
      operacoes.clear();
      for (const controlador of todas) controlador.abort();
    },

    /**
     * @param {string | number} cod
     * @returns {boolean}
     */
    ocupada(cod) {
      return operacoes.has(String(cod));
    },
  };
}

/** @typedef {ReturnType<typeof criarTravaGrupo>} TravaGrupo */

/** Trava do processo (o PM2 roda `instances: 1`). Os testes criam a sua com `criarTravaGrupo`. */
const padrao = criarTravaGrupo();

module.exports = { criarTravaGrupo, padrao };
