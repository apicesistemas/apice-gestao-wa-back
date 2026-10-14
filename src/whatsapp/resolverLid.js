// @ts-check
// Pares LID ↔ telefone de uma equipe (base: informarPares do gateway do financeiro e
// resolverJidDestino do comandax). O contato não pode ser identificado só pelo telefone (SPEC: LID):
// cada mensagem leva os dois quando se conhecem, e só o LID quando o telefone não é resolvível.
//
// Fontes dos pares (Baileys 6.7.24):
// - `key.senderPn` / `key.senderLid` de mensagem privada do CLIENTE;
// - `key.participantPn` / `key.participantLid` de mensagem de grupo;
// - eventos `chats.phoneNumberShare`, `contacts.upsert` e `contacts.update`;
// - `sock.onWhatsApp(<telefone>)`, que devolve o LID de um telefone (consulta de rede, com cache).
// Mensagem `fromMe` nunca é fonte: o `senderPn` dela é o número da equipe, e o par
// { LID do contato, telefone da equipe } misturaria conversas.
//
// Só memória: nunca em disco nem em log. O restart esquece os pares, e o back guarda o que recebeu
// em cada mensagem.
const { lidDe, telefoneDe } = require("./filtroEntrada");

/** Caches técnicos (não são regra de negócio). */
const MAX_PARES = 5000;
const PRAZO_CONSULTA_MS = 5000;
const TTL_CONSULTA_NEGATIVA_MS = 60 * 60 * 1000;
const PADRAO_TELEFONE = /^\d{8,15}$/;

/** @typedef {import("./filtroEntrada").Identidade} Identidade */
/** @typedef {(jid: string) => Promise<{ jid?: unknown, exists?: unknown, lid?: unknown }[] | undefined>} OnWhatsApp */

/**
 * Telefone de um JID `...@s.whatsapp.net` ou de uma string só de dígitos.
 * @param {unknown} valor
 * @returns {string | null}
 */
function telefoneDeValor(valor) {
  if (typeof valor === "string" && PADRAO_TELEFONE.test(valor)) return valor;
  return telefoneDe(valor);
}

/**
 * @template T
 * @param {Promise<T>} promessa
 * @param {number} prazoMs
 * @returns {Promise<T>}
 */
function comPrazo(promessa, prazoMs) {
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  const estouro = new Promise((_, rejeitar) => {
    // Sem `unref`: quem espera a consulta precisa do timer vivo (ele é sempre limpo no `finally`).
    timer = setTimeout(() => rejeitar(Object.assign(new Error("Prazo da consulta esgotado."), { name: "TimeoutError" })), prazoMs);
  });
  return /** @type {Promise<T>} */ (Promise.race([promessa, estouro])).finally(() => clearTimeout(timer));
}

/**
 * @param {{ maxPares?: number, prazoConsultaMs?: number, ttlConsultaNegativaMs?: number, agora?: () => number }} [opcoes]
 */
function criarResolvedorLid({
  maxPares = MAX_PARES,
  prazoConsultaMs = PRAZO_CONSULTA_MS,
  ttlConsultaNegativaMs = TTL_CONSULTA_NEGATIVA_MS,
  agora = Date.now,
} = {}) {
  /** lid → telefone, em ordem de inserção (FIFO). */
  /** @type {Map<string, string>} */
  const telefonePorLid = new Map();
  /** @type {Map<string, string>} */
  const lidPorTelefone = new Map();
  /** telefone → instante da consulta ao `onWhatsApp` que não achou LID (ou falhou). */
  /** @type {Map<string, number>} */
  const consultasNegativas = new Map();

  /**
   * Guarda o par (o último par de um LID ou de um telefone vence).
   * @param {unknown} lidJid `<dígitos>@lid` (com ou sem sufixo de aparelho)
   * @param {unknown} telefoneOuJid telefone só com dígitos ou JID `...@s.whatsapp.net`
   * @returns {boolean} se o par era válido
   */
  function aprenderPar(lidJid, telefoneOuJid) {
    const lid = lidDe(lidJid);
    const telefone = telefoneDeValor(telefoneOuJid);
    if (!lid || !telefone) return false;

    const telefoneAntigo = telefonePorLid.get(lid);
    if (telefoneAntigo && lidPorTelefone.get(telefoneAntigo) === lid) lidPorTelefone.delete(telefoneAntigo);
    const lidAntigo = lidPorTelefone.get(telefone);
    if (lidAntigo && telefonePorLid.get(lidAntigo) === telefone) telefonePorLid.delete(lidAntigo);

    telefonePorLid.delete(lid);
    telefonePorLid.set(lid, telefone);
    lidPorTelefone.set(telefone, lid);
    consultasNegativas.delete(telefone);

    while (telefonePorLid.size > maxPares) {
      const [lidVelho, telVelho] = /** @type {[string, string]} */ (telefonePorLid.entries().next().value);
      telefonePorLid.delete(lidVelho);
      if (lidPorTelefone.get(telVelho) === lidVelho) lidPorTelefone.delete(telVelho);
    }
    return true;
  }

  /**
   * Aprende os pares que a `key` de uma mensagem recebida traz. Ignora mensagens `fromMe`.
   * @param {any} waMessage
   */
  function aprenderDaMensagem(waMessage) {
    const key = waMessage?.key;
    if (!key || key.fromMe === true || typeof key.remoteJid !== "string") return;
    if (key.remoteJid.endsWith("@g.us")) {
      const participante = key.participant ?? waMessage.participant;
      aprenderPar(participante, key.participantPn);
      aprenderPar(key.participantLid, participante);
      return;
    }
    aprenderPar(key.remoteJid, key.senderPn);
    aprenderPar(key.senderLid, key.remoteJid);
  }

  /**
   * Contatos do Baileys (`{ id, lid?, jid? }`) e o `chats.phoneNumberShare` (`{ lid, jid }`).
   * @param {unknown} contatos
   */
  function aprenderContatos(contatos) {
    if (!Array.isArray(contatos)) return;
    for (const c of contatos) {
      if (!c || typeof c !== "object") continue;
      const lid = lidDe(c.lid) ?? lidDe(c.id);
      const telefone = telefoneDe(c.jid) ?? telefoneDe(c.id);
      if (lid && telefone) aprenderPar(lid, telefone);
    }
  }

  /**
   * @param {unknown} lid
   * @returns {string | null}
   */
  function telefoneDoLid(lid) {
    const normalizado = lidDe(lid);
    return (normalizado && telefonePorLid.get(normalizado)) || null;
  }

  /**
   * @param {unknown} telefone
   * @returns {string | null}
   */
  function lidDoTelefone(telefone) {
    const t = telefoneDeValor(telefone);
    return (t && lidPorTelefone.get(t)) || null;
  }

  /**
   * Completa pelo cache o identificador que falta (sem rede). LID sem par conhecido continua só com o LID.
   * @template {Identidade} T
   * @param {T} identidade
   * @returns {T}
   */
  function completarIdentidade(identidade) {
    return {
      ...identidade,
      lid: identidade.lid ?? (identidade.telefone ? lidDoTelefone(identidade.telefone) : null),
      telefone: identidade.telefone ?? (identidade.lid ? telefoneDoLid(identidade.lid) : null),
    };
  }

  /**
   * LID de um telefone: cache, senão `onWhatsApp` (uma consulta por telefone; resultado negativo e
   * falha também ficam guardados por um tempo, e a consulta tem prazo, para a fila de entrada não parar).
   * Nunca rejeita.
   * @param {string} telefone
   * @param {OnWhatsApp} onWhatsApp
   * @returns {Promise<string | null>}
   */
  async function consultarLidDoTelefone(telefone, onWhatsApp) {
    const t = telefoneDeValor(telefone);
    if (!t) return null;
    const conhecido = lidPorTelefone.get(t);
    if (conhecido) return conhecido;
    const negativa = consultasNegativas.get(t);
    if (negativa !== undefined && agora() - negativa < ttlConsultaNegativaMs) return null;

    try {
      const resultado = await comPrazo(Promise.resolve().then(() => onWhatsApp(`${t}@s.whatsapp.net`)), prazoConsultaMs);
      const r = Array.isArray(resultado) ? resultado[0] : undefined;
      // Só `<dígitos>@lid` (sem sufixo de aparelho), como no comandax.
      const lid = r?.exists && typeof r.lid === "string" && /^\d{1,25}@lid$/.test(r.lid) ? r.lid : null;
      if (lid && aprenderPar(lid, t)) return lid;
    } catch {
      // Falha ou prazo esgotado: segue sem LID (a mensagem é registrada mesmo assim).
    }
    consultasNegativas.delete(t);
    consultasNegativas.set(t, agora());
    while (consultasNegativas.size > maxPares) {
      const maisAntiga = consultasNegativas.keys().next().value;
      if (maisAntiga === undefined) break;
      consultasNegativas.delete(maisAntiga);
    }
    return null;
  }

  function limpar() {
    telefonePorLid.clear();
    lidPorTelefone.clear();
    consultasNegativas.clear();
  }

  return {
    aprenderPar,
    aprenderDaMensagem,
    aprenderContatos,
    telefoneDoLid,
    lidDoTelefone,
    completarIdentidade,
    consultarLidDoTelefone,
    limpar,
  };
}

module.exports = { criarResolvedorLid, MAX_PARES, PRAZO_CONSULTA_MS };
