// @ts-check
// Lote dos recibos por destinatário de UMA equipe (Fase 38, contrato C1): junta os recibos de entrega e
// leitura e os envia ao back em `POST /interno/mensagem-recibos`, em vez de uma chamada por recibo.
//
// Regras:
// - o lote sai `RECIBO_LOTE_MS` (padrão técnico 2000 ms) depois do primeiro recibo, ou na hora quando
//   chega a 200 itens (limite da rota). Mais de 200 pendentes saem em chamadas de 200, em ordem;
// - o despacho passa pela fila serial da entrada (`enfileirar`): um recibo nunca passa na frente do
//   registro da mensagem dele. A fila só TIRA o lote da memória; o POST corre fora dela, então um back
//   lento ou fora do ar não atrasa o registro das mensagens nem o status agregado (`recibos.js`);
// - recibo repetido não volta: a deduplicação em memória (24 h) guarda, por mensagem e destinatário, o que o
//   back CONFIRMOU (2xx). Enquanto o recibo está pendente ou a caminho, o que ele já trouxe também conta, para
//   não sair duas vezes. Falha (lote descartado) não entra na deduplicação, então o recibo repetido pode voltar.
//   Só passa o que traz horário novo (ex.: a leitura depois da entrega). No mesmo lote, o menor horário de
//   cada campo vale (é a mesma regra do back);
// - item inválido é recusado em `adicionar` (mesma validação do cliente) e nunca derruba o lote;
// - falha de rede, timeout ou 5xx: uma nova tentativa, depois o lote é descartado só com log. Qualquer
//   outro erro do back descarta na hora. Um 404 (back antigo, sem a rota) descarta o lote e suspende o envio
//   por um intervalo técnico, com um único log;
// - `esvaziar()` (desligamento) despacha o que sobrou e espera as chamadas em andamento, sem nova tentativa
//   e dentro de um prazo técnico menor que o teto do encerramento. `limpar()` (sessão apagada) descarta tudo;
// - o log leva só o `cod_equipe` e contagens: nunca LID, telefone, JID nem id de mensagem.
const mensagemReciboInternoClient = require("../services/mensagemReciboInternoClient");
const { itemValido } = mensagemReciboInternoClient;

/** Espera padrão pelo lote (ms), sobrescrita por `RECIBO_LOTE_MS`. Padrão técnico, não regra de negócio. */
const MS_LOTE_PADRAO = 2000;
/** Itens por chamada: o limite da rota C1. */
const MAX_ITENS_LOTE = mensagemReciboInternoClient.MAX_RECIBOS_POR_CHAMADA;
/** Por quanto tempo o que já foi enviado fica em memória para não voltar. */
const MS_TTL_DEDUP = 24 * 60 * 60 * 1000;
/** Intervalo sem enviar depois de um 404 (back antigo). */
const MS_SUSPENSAO_404 = 10 * 60 * 1000;
/** Espera entre a falha e a nova tentativa. */
const MS_ENTRE_TENTATIVAS = 1000;
/** Prazo do esvaziamento no desligamento (o teto do encerramento é 10 s e cobre todas as equipes). */
const MS_TETO_ESVAZIAR = 4000;
/** Teto de entradas da deduplicação (as mais antigas saem primeiro). */
const MAX_VISTOS = 50_000;
/** No máximo uma varredura de expirados por minuto. */
const MS_ENTRE_VARREDURAS = 60 * 1000;

/** @typedef {import("../services/mensagemReciboInternoClient").ReciboPorDestinatario} ReciboPorDestinatario */
/** @typedef {import("../services/mensagemInternoClient").ContextoInstancia} ContextoInstancia */

/**
 * Espera pelo lote, lida do ambiente (`RECIBO_LOTE_MS`, inteiro ≥ 0; ausente ou inválido → 2000 ms).
 * @returns {number}
 */
function obterMsLoteRecibos() {
  const valor = process.env.RECIBO_LOTE_MS;
  const n = Number(valor);
  return valor !== undefined && valor.trim() !== "" && Number.isSafeInteger(n) && n >= 0 ? n : MS_LOTE_PADRAO;
}

/**
 * Chave do destinatário, como no back: `CONVERSA`, `L:<lid>` ou `T:<telefone>`.
 * @param {ReciboPorDestinatario["destinatario"]} destinatario
 * @returns {string | null}
 */
function chaveDoDestinatario(destinatario) {
  if (destinatario === null) return "CONVERSA";
  if (destinatario?.lid) return `L:${destinatario.lid}`;
  if (destinatario?.telefone) return `T:${destinatario.telefone}`;
  return null;
}

/**
 * @param {number | null | undefined} a
 * @param {number | null | undefined} b
 * @returns {number | null}
 */
function menorHorario(a, b) {
  if (a == null) return b ?? null;
  if (b == null) return a;
  return Math.min(a, b);
}

/**
 * @param {{
 *   contexto: ContextoInstancia,
 *   registrarRecibos?: (recibos: ReciboPorDestinatario[], contexto: ContextoInstancia, opcoes?: { timeoutMs?: number }) => Promise<unknown>,
 *   enfileirar?: (tarefa: () => unknown) => unknown,
 *   msLote?: number,
 *   maxItens?: number,
 *   msTtlDedup?: number,
 *   msSuspensao?: number,
 *   msEntreTentativas?: number,
 *   msTetoEsvaziar?: number,
 *   agora?: () => number,
 * }} opcoes `enfileirar`: o adapter usa a fila serial da entrada (padrão: executa na hora); `msLote`: padrão
 *   `obterMsLoteRecibos()` a cada lote
 */
function criarLoteRecibos({
  contexto,
  registrarRecibos = mensagemReciboInternoClient.registrarRecibos,
  enfileirar = (tarefa) => tarefa(),
  msLote,
  maxItens = MAX_ITENS_LOTE,
  msTtlDedup = MS_TTL_DEDUP,
  msSuspensao = MS_SUSPENSAO_404,
  msEntreTentativas = MS_ENTRE_TENTATIVAS,
  msTetoEsvaziar = MS_TETO_ESVAZIAR,
  agora = Date.now,
}) {
  /** Pendentes do próximo lote, na ordem de chegada. */
  /** @type {Map<string, ReciboPorDestinatario>} */
  const pendentes = new Map();
  /** O que o back já confirmou (2xx): chave → horários e instante. */
  /** @type {Map<string, { entregue_em: number | null, lida_em: number | null, em: number }>} */
  const vistos = new Map();
  /** Itens a caminho (já tirados dos pendentes, sem resposta ainda): id → horários. */
  /** @type {Map<string, { entregue_em: number | null, lida_em: number | null }>} */
  const emVoo = new Map();
  /** Espera da nova tentativa em andamento (cancelada em `limpar`). */
  /** @type {{ timer: ReturnType<typeof setTimeout>, acordar: () => void } | null} */
  let espera = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let timer = null;
  let despachoSolicitado = false;
  let suspensoAte = 0;
  let encerrando = false;
  let ultimaVarredura = 0;
  /** Muda em `limpar()`: o que estava em andamento deixa de enviar. */
  let geracao = 0;
  /** Chamadas ao back em série (a ordem dos lotes se mantém). */
  /** @type {Promise<void>} */
  let cadeia = Promise.resolve();

  /**
   * @param {string} chave destinatário (`CONVERSA`, `L:` ou `T:`)
   * @param {string} id mensagem_wa_id
   */
  const chaveDoItem = (chave, id) => `${id}\u0000${chave}`;

  /**
   * @param {ReciboPorDestinatario} item
   * @returns {string | null}
   */
  function idDoItem(item) {
    const chave = chaveDoDestinatario(item.destinatario);
    return chave ? chaveDoItem(chave, item.mensagem_wa_id) : null;
  }

  /**
   * O POST terminou (com ou sem sucesso): o que estava a caminho deixa de contar.
   * @param {ReciboPorDestinatario[]} itens
   */
  function sairDoVoo(itens) {
    for (const item of itens) {
      const id = idDoItem(item);
      if (id) emVoo.delete(id);
    }
  }

  /**
   * O back respondeu 2xx: só agora o recibo entra na deduplicação.
   * @param {ReciboPorDestinatario[]} itens
   */
  function confirmar(itens) {
    const agoraMs = agora();
    for (const item of itens) {
      const id = idDoItem(item);
      if (!id) continue;
      const visto = vistos.get(id);
      vistos.delete(id);
      vistos.set(id, {
        entregue_em: menorHorario(visto?.entregue_em, item.entregue_em),
        lida_em: menorHorario(visto?.lida_em, item.lida_em),
        em: agoraMs,
      });
    }
  }

  /**
   * Espera da nova tentativa: sem segurar o processo (unref) e cancelável por `limpar`.
   * @param {number} ms
   * @returns {Promise<void>}
   */
  function dormir(ms) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        espera = null;
        resolve();
      }, ms);
      timer.unref?.();
      espera = { timer, acordar: () => resolve() };
    });
  }

  /** @param {number} agoraMs */
  function podar(agoraMs) {
    if (agoraMs - ultimaVarredura < MS_ENTRE_VARREDURAS && vistos.size <= MAX_VISTOS) return;
    ultimaVarredura = agoraMs;
    // A ordem do Map é a da confirmação: a primeira entrada ainda válida encerra a varredura.
    for (const [chave, visto] of vistos) {
      if (agoraMs - visto.em < msTtlDedup && vistos.size <= MAX_VISTOS) break;
      vistos.delete(chave);
    }
  }

  function limparTimer() {
    if (timer) clearTimeout(timer);
    timer = null;
  }

  /**
   * Um POST (com a nova tentativa). Nunca rejeita.
   * @param {ReciboPorDestinatario[]} itens
   * @param {number} geracaoDoLote
   * @returns {Promise<void>}
   */
  async function postar(itens, geracaoDoLote) {
    for (let tentativa = 1; tentativa <= 2; tentativa += 1) {
      if (geracaoDoLote !== geracao) return; // sessão apagada: nada mais sai
      if (agora() < suspensoAte) return; // rota suspensa: sem log (o aviso já saiu); o recibo repetido pode voltar depois
      try {
        await registrarRecibos(itens, contexto, encerrando ? { timeoutMs: msTetoEsvaziar } : {});
        if (geracaoDoLote === geracao) confirmar(itens);
        return;
      } catch (erro) {
        const { status, tipo, name } = /** @type {{ status?: unknown, tipo?: unknown, name?: unknown }} */ (erro && typeof erro === "object" ? erro : {});
        if (status === 404) {
          suspensoAte = agora() + msSuspensao;
          console.error(
            `[RECIBOS] Equipe ${contexto.cod_equipe}: o back não tem a rota de recibos por destinatário (HTTP 404); envio suspenso por ${Math.round(msSuspensao / 60000)} min e lote de ${itens.length} descartado.`
          );
          return;
        }
        const transitorio = tipo === "rede" || tipo === "timeout" || (typeof status === "number" && status >= 500);
        if (!transitorio || tentativa === 2 || encerrando) {
          const motivo = `${typeof name === "string" ? name : "erro"}${typeof tipo === "string" ? ` ${tipo}` : ""}${typeof status === "number" ? ` HTTP ${status}` : ""}`;
          console.error(`[RECIBOS] Equipe ${contexto.cod_equipe}: ${itens.length} recibos por destinatário descartados (${motivo}).`);
          return;
        }
        await dormir(msEntreTentativas);
      }
    }
  }

  /**
   * Roda o POST e tira os itens do "a caminho" no fim, qualquer que seja o resultado.
   * @param {ReciboPorDestinatario[]} itens
   * @param {number} geracaoDoLote
   */
  async function enviar(itens, geracaoDoLote) {
    try {
      await postar(itens, geracaoDoLote);
    } finally {
      sairDoVoo(itens);
    }
  }

  /** Tira os pendentes da memória e agenda as chamadas, sem esperá-las. */
  function despachar() {
    despachoSolicitado = false;
    limparTimer();
    if (pendentes.size === 0) return;
    const itens = [...pendentes.values()];
    pendentes.clear();
    const g = geracao;
    for (const item of itens) {
      const id = idDoItem(item);
      if (id) emVoo.set(id, { entregue_em: item.entregue_em, lida_em: item.lida_em });
    }
    for (let i = 0; i < itens.length; i += maxItens) {
      const parte = itens.slice(i, i + maxItens);
      cadeia = cadeia.then(() => enviar(parte, g)).catch(() => {});
    }
  }

  /** Pede o despacho pela fila serial (uma vez por vez). */
  function solicitarDespacho() {
    limparTimer();
    if (despachoSolicitado) return;
    despachoSolicitado = true;
    Promise.resolve()
      .then(() => enfileirar(despachar))
      .catch((erro) => {
        despachoSolicitado = false;
        console.error(`[RECIBOS] Equipe ${contexto.cod_equipe}: falha ao despachar o lote de recibos (${erro instanceof Error ? erro.name : "erro"}).`);
      });
  }

  function armar() {
    if (pendentes.size >= maxItens) {
      solicitarDespacho();
      return;
    }
    if (timer || despachoSolicitado) return;
    timer = setTimeout(() => {
      timer = null;
      solicitarDespacho();
    }, msLote ?? obterMsLoteRecibos());
    timer.unref?.();
  }

  /**
   * Põe um recibo no próximo lote. Devolve `false` quando ele não traz nada novo (repetido) ou é inválido.
   * @param {ReciboPorDestinatario} item
   * @returns {boolean}
   */
  function adicionar(item) {
    if (!itemValido(item)) return false;
    const id = idDoItem(item);
    if (!id) return false;
    podar(agora());

    // O que já se sabe deste recibo: confirmado pelo back, a caminho ou pendente.
    const conhecidos = [vistos.get(id), emVoo.get(id), pendentes.get(id)];
    const jaTemEntrega = conhecidos.some((c) => c?.entregue_em != null);
    const jaTemLeitura = conhecidos.some((c) => c?.lida_em != null);
    const traz = (item.entregue_em != null && !jaTemEntrega) || (item.lida_em != null && !jaTemLeitura);
    if (conhecidos.some(Boolean) && !traz) return false;

    const pendente = pendentes.get(id);
    pendentes.set(id, {
      mensagem_wa_id: item.mensagem_wa_id,
      destinatario: item.destinatario,
      entregue_em: menorHorario(pendente?.entregue_em, item.entregue_em),
      lida_em: menorHorario(pendente?.lida_em, item.lida_em),
    });
    armar();
    return true;
  }

  /**
   * Desligamento: despacha o que sobrou e espera as chamadas em andamento, sem nova tentativa e dentro do
   * prazo técnico (passado o prazo, o que falta se perde com um log). Nunca rejeita.
   * @returns {Promise<void>}
   */
  async function esvaziar() {
    encerrando = true;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timerPrazo;
    try {
      despachar();
      const prazo = new Promise((resolve) => {
        timerPrazo = setTimeout(() => resolve("prazo"), msTetoEsvaziar);
      });
      const resultado = await Promise.race([cadeia.then(() => "ok"), prazo]);
      if (resultado === "prazo") console.error(`[RECIBOS] Equipe ${contexto.cod_equipe}: o lote de recibos não terminou de sair dentro do prazo do desligamento.`);
    } finally {
      clearTimeout(timerPrazo);
      encerrando = false;
    }
  }

  /** Sessão apagada: nada do que está em memória vale mais, nem o que está a caminho. */
  function limpar() {
    geracao += 1;
    limparTimer();
    despachoSolicitado = false;
    pendentes.clear();
    vistos.clear();
    emVoo.clear();
    suspensoAte = 0;
    if (espera) {
      clearTimeout(espera.timer);
      espera.acordar(); // o POST em espera acorda, vê a sessão nova e desiste
      espera = null;
    }
  }

  return { adicionar, esvaziar, limpar, quantidadePendentes: () => pendentes.size };
}

module.exports = {
  criarLoteRecibos,
  obterMsLoteRecibos,
  chaveDoDestinatario,
  MS_LOTE_PADRAO,
  MAX_ITENS_LOTE,
  MS_TETO_ESVAZIAR,
};
