// @ts-check
// Consolidador das chamadas RECEBIDAS (Fase 34, Task 34.2). O evento `call` do Baileys chega em vários
// passos (offer, ringing, accept, reject, terminate); aqui eles viram UM registro por chamada, sempre
// com origem CLIENTE. Estado por id da chamada, só em memória:
//   offer       guarda o contexto e liga o teto;
//   ringing     ignorado;
//   reject      RECUSADA, na hora; o terminate seguinte é ignorado;
//   accept      ATENDIDA, na hora (antes do terminate) ou dentro da janela do terminate;
//   terminate   abre a janela técnica por um accept; sem accept → PERDIDA (como o WhatsApp mostra);
//   timeout     PERDIDA (não chegou na homologação, mas o protocolo prevê);
//   teto        sem desfecho → ENCERRADA.
// Homologação da 34.0: o accept da chamada atendida no celular chega DEPOIS do terminate.
// A chamada feita (`from` = número da equipe) não é registrada: nenhuma fonte foi observada (D12 pendente).
// O consolidador nunca recusa, atende nem envia nada ao WhatsApp, e não loga: quem loga é o adapter, só com
// cod_equipe, id, resultado e status (nunca JID, LID nem telefone).
const { normalizarJid, lidDe, telefoneDe, mensagemWaIdValido } = require("./filtroEntrada");

/** Teto de uma chamada sem desfecho: limite de protocolo (CALL_OFFER do Baileys, 5 min), não regra de negócio. */
const MS_TETO_PADRAO = 5 * 60 * 1000;
/** Espera técnica pelo `accept` que chega depois do `terminate` (atendida em outro aparelho). */
const MS_JANELA_ACCEPT_PADRAO = 15 * 1000;
/** Tamanho técnico das tabelas de chamadas abertas e já publicadas (a mais antiga sai primeiro). */
const MAX_PENDENTES_PADRAO = 500;

/**
 * @typedef {"ATENDIDA" | "RECUSADA" | "PERDIDA" | "ENCERRADA"} ResultadoChamada
 */
/**
 * Registro final de uma chamada recebida, entregue ao `publicar`. A identidade é bruta (JID do evento):
 * quem publica completa o par LID ↔ telefone.
 * @typedef {{
 *   chamada_wa_id: string,
 *   origem: "CLIENTE",
 *   resultado: ResultadoChamada,
 *   video: boolean | null,
 *   from: string,
 *   group_jid: string | null,
 *   timestamp_wa: number,
 *   offline: boolean,
 *   sequencia: string[],
 * }} RegistroChamada
 */
/**
 * Alerta de ligação tocando (Task 34.6), entregue ao `alertar`.
 * @typedef {{
 *   chamada_wa_id: string,
 *   situacao: "TOCANDO" | "PAROU",
 *   video: boolean | null,
 *   from: string,
 *   group_jid: string | null,
 * }} AlertaChamada
 */
/**
 * @typedef {{
 *   eu?: () => import("./filtroEntrada").IdentidadePropria | null | undefined,
 *   publicar: (registro: RegistroChamada) => Promise<unknown> | unknown,
 *   alertar?: (alerta: AlertaChamada) => Promise<unknown> | unknown,
 *   agora?: () => number,
 *   agendar?: (fn: () => void, ms: number) => () => void,
 *   msTeto?: number,
 *   msJanelaAccept?: number,
 *   maxPendentes?: number,
 *   aoFalhar?: (situacao: "publicar" | "alertar", erro: unknown) => void,
 *   aoDescartar?: (motivo: "TABELA_CHEIA") => void,
 * }} OpcoesConsolidador
 */
/**
 * @typedef {{
 *   id: string,
 *   from: string,
 *   groupJid: string | null,
 *   video: boolean | null,
 *   offline: boolean,
 *   timestamp: number,
 *   sequencia: string[],
 *   geracao: number,
 *   cancelarTeto: (() => void) | null,
 *   cancelarJanela: (() => void) | null,
 *   tocando: Promise<unknown> | null,
 *   parou: boolean,
 *   emJanela: boolean,
 * }} Chamada
 */

/** Agendador padrão: `setTimeout` que não segura o processo. @param {() => void} fn @param {number} ms */
function agendarPadrao(fn, ms) {
  const timer = setTimeout(fn, ms);
  timer.unref?.();
  return () => clearTimeout(timer);
}

/** @param {unknown} data @returns {number | null} segundos */
function segundosDe(data) {
  const ms = data instanceof Date ? data.getTime() : typeof data === "number" ? data : NaN;
  return Number.isFinite(ms) && ms > 0 ? Math.floor(ms > 1e12 ? ms / 1000 : ms) : null;
}

/**
 * @param {OpcoesConsolidador} opcoes
 */
function criarConsolidadorChamadas({
  eu,
  publicar,
  alertar,
  agora = Date.now,
  agendar = agendarPadrao,
  msTeto = MS_TETO_PADRAO,
  msJanelaAccept = MS_JANELA_ACCEPT_PADRAO,
  maxPendentes = MAX_PENDENTES_PADRAO,
  aoFalhar = () => {},
  aoDescartar = () => {},
}) {
  /** @type {Map<string, Chamada>} chamadas abertas, por id */
  const abertas = new Map();
  /** @type {Map<string, number>} ids já publicados (ou encerrados) → expira em (ms) */
  const publicadas = new Map();
  let geracao = 0;

  /** @param {string | null | undefined} jid @returns {boolean} */
  function ehEquipe(jid) {
    const meu = eu?.();
    const usuario = (/** @type {unknown} */ j) => normalizarJid(j)?.split("@")[0] ?? null;
    const alvo = usuario(jid);
    return alvo !== null && (alvo === usuario(meu?.jid) || alvo === usuario(meu?.lid));
  }

  /** @param {string} id */
  function jaPublicada(id) {
    const expira = publicadas.get(id);
    if (expira === undefined) return false;
    if (expira <= agora()) {
      publicadas.delete(id);
      return false;
    }
    return true;
  }

  /** @param {string} id */
  function lembrar(id) {
    publicadas.delete(id);
    publicadas.set(id, agora() + msTeto);
    while (publicadas.size > maxPendentes) {
      const maisAntigo = publicadas.keys().next().value;
      if (maisAntigo === undefined) break;
      publicadas.delete(maisAntigo);
    }
  }

  /** @param {Chamada} c */
  function cancelarTimers(c) {
    c.cancelarTeto?.();
    c.cancelarJanela?.();
    c.cancelarTeto = null;
    c.cancelarJanela = null;
  }

  /**
   * Chama um callback do consumidor sem deixar a falha (síncrona ou assíncrona) escapar.
   * @param {"publicar" | "alertar"} situacao
   * @param {() => Promise<unknown> | unknown} fn
   * @returns {Promise<unknown>}
   */
  function seguro(situacao, fn) {
    try {
      return Promise.resolve(fn()).catch((erro) => aoFalhar(situacao, erro));
    } catch (erro) {
      aoFalhar(situacao, erro);
      return Promise.resolve();
    }
  }

  /**
   * Primeiro desfecho conhecido: o alerta PAROU sai uma vez, depois do TOCANDO terminar (Task 34.6).
   * @param {Chamada} c
   */
  function pararAlerta(c) {
    if (c.parou || !c.tocando || !alertar) return;
    c.parou = true;
    const gen = c.geracao;
    void c.tocando.then(() => {
      if (gen !== geracao) return;
      return seguro("alertar", () =>
        alertar({ chamada_wa_id: c.id, situacao: "PAROU", video: c.video, from: c.from, group_jid: c.groupJid }),
      );
    });
  }

  /**
   * Publica uma vez: tira a chamada das abertas, lembra o id e entrega o registro.
   * @param {Chamada} c
   * @param {ResultadoChamada} resultado
   */
  function concluir(c, resultado) {
    if (abertas.get(c.id) === c) abertas.delete(c.id);
    cancelarTimers(c);
    pararAlerta(c);
    if (jaPublicada(c.id)) return;
    lembrar(c.id);
    c.sequencia.push(resultado);
    void seguro("publicar", () =>
      publicar({
        chamada_wa_id: c.id,
        origem: "CLIENTE",
        resultado,
        video: c.video,
        from: c.from,
        group_jid: c.groupJid,
        timestamp_wa: c.timestamp,
        offline: c.offline,
        sequencia: [...c.sequencia],
      }),
    );
  }

  /**
   * Abre (ou devolve) o estado de uma chamada e liga o teto.
   * @param {string} id
   * @param {any} e evento
   * @param {string} from
   * @param {string | null} groupJid
   * @returns {Chamada}
   */
  function abrir(id, e, from, groupJid) {
    const existente = abertas.get(id);
    if (existente) return existente;
    // Tabela limitada: abrir uma nova com a tabela cheia encerra a mais antiga (ENCERRADA).
    if (abertas.size >= maxPendentes) {
      const maisAntiga = abertas.values().next().value;
      if (maisAntiga) {
        aoDescartar("TABELA_CHEIA");
        concluir(maisAntiga, "ENCERRADA");
      }
    }
    /** @type {Chamada} */
    const c = {
      id,
      from,
      groupJid,
      video: typeof e.isVideo === "boolean" ? e.isVideo : null,
      offline: e.offline === true,
      timestamp: segundosDe(e.date) ?? Math.floor(agora() / 1000),
      sequencia: [],
      geracao,
      cancelarTeto: null,
      cancelarJanela: null,
      tocando: null,
      parou: false,
      emJanela: false,
    };
    abertas.set(id, c);
    c.cancelarTeto = agendar(() => {
      c.cancelarTeto = null;
      if (abertas.get(id) === c && !c.emJanela) concluir(c, "ENCERRADA");
    }, msTeto);
    return c;
  }

  /** @param {any} e */
  function tratarUm(e) {
    if (!e || typeof e !== "object") return;
    const id = e.id;
    if (typeof id !== "string" || !mensagemWaIdValido(id)) return;
    const status = e.status;
    if (status !== "offer" && status !== "ringing" && status !== "accept" && status !== "reject" && status !== "terminate" && status !== "timeout") return;
    if (jaPublicada(id)) return;

    let c = abertas.get(id);
    if (c) {
      c.sequencia.push(status);
      // `video` só chega no offer; o resto do ciclo pode vir sem a informação.
      if (c.video === null && typeof e.isVideo === "boolean") c.video = e.isVideo;
    } else {
      // Quem liga: o `from` do evento (o `chatId` do accept e do reject já é o número da equipe).
      const from = normalizarJid(e.from);
      if (!from || !(lidDe(from) || telefoneDe(from))) return; // status, broadcast e outros domínios
      if (ehEquipe(from)) return; // chamada feita: sem fonte confirmada, não registra
      const groupJid = e.isGroup === true && typeof e.groupJid === "string" && e.groupJid.endsWith("@g.us") ? e.groupJid : null;
      if (status === "ringing") return; // sem offer não há o que consolidar
      c = abrir(id, e, from, groupJid);
      c.sequencia.push(status);
    }

    switch (status) {
      case "offer":
        if (alertar && !c.offline && !c.tocando) {
          const gen = c.geracao;
          const chamada = c;
          c.tocando = seguro("alertar", () =>
            gen === geracao
              ? alertar({ chamada_wa_id: chamada.id, situacao: "TOCANDO", video: chamada.video, from: chamada.from, group_jid: chamada.groupJid })
              : undefined,
          );
        }
        return;
      case "ringing":
        return;
      case "reject":
        concluir(c, "RECUSADA");
        return;
      case "accept":
        concluir(c, "ATENDIDA");
        return;
      case "timeout":
        concluir(c, "PERDIDA");
        return;
      case "terminate": {
        if (c.emJanela) return;
        c.emJanela = true;
        c.cancelarTeto?.();
        c.cancelarTeto = null;
        pararAlerta(c);
        const chamada = c;
        chamada.cancelarJanela = agendar(() => {
          chamada.cancelarJanela = null;
          if (abertas.get(chamada.id) === chamada) concluir(chamada, "PERDIDA");
        }, msJanelaAccept);
        return;
      }
      default:
    }
  }

  /**
   * Trata o lote do evento `call` do Baileys. Nunca lança.
   * @param {unknown} eventos
   */
  function tratarEvento(eventos) {
    const lista = Array.isArray(eventos) ? eventos : [eventos];
    for (const e of lista) {
      try {
        tratarUm(e);
      } catch (erro) {
        aoFalhar("publicar", erro);
      }
    }
  }

  /** Descarta tudo (logout, desconexão, troca de socket): nada pendente é publicado depois. */
  function limpar() {
    geracao += 1;
    for (const c of abertas.values()) cancelarTimers(c);
    abertas.clear();
    publicadas.clear();
  }

  return { tratarEvento, limpar, pendentes: () => abertas.size };
}

module.exports = { criarConsolidadorChamadas, MS_TETO_PADRAO, MS_JANELA_ACCEPT_PADRAO, MAX_PENDENTES_PADRAO };
