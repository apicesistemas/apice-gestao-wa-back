// @ts-check
// "Digitando..." do cliente (base: o digitando do apice-financeiro-wa-wa-back, aqui no sentido
// contrário: o que o cliente faz chega ao livechat). Do `presence.update` do Baileys 6.7.24
// (`{ id: chat, presences: { [participante]: { lastKnownPresence } } }`) sai o
// `POST /interno/presenca` com `DIGITANDO`, `GRAVANDO` ou `PARADO`.
//
// Regras:
// - só a presença da outra ponta: a da própria equipe (outro aparelho dela) nunca vai ao back;
// - só a mudança de estado vai ao back (sem spam). O estado inicial de todo chat é PARADO, então o
//   `available`/`unavailable` de quem só ficou online ou offline não gera chamada;
// - no privado, `participante_jid` é null (quem digita é o próprio chat); no grupo, é o participante;
// - o WhatsApp só entrega a presença de um contato depois do `presenceSubscribe`: a inscrição é feita
//   quando chega mensagem do chat, uma vez por chat e por socket (o socket novo da reconexão não
//   herda as inscrições: `limparInscricoes()` no `open`). Falha na inscrição só loga, e a próxima
//   mensagem do chat tenta de novo;
// - os envios ao back saem em ordem, um por vez (o PARADO nunca chega antes do DIGITANDO), e uma
//   falha do back (a rota é da Task 7.1) só loga.
const NodeCache = require("node-cache");
const { normalizarJid } = require("./filtroEntrada");
const presencaInternoClient = require("../services/presencaInternoClient");

/** `lastKnownPresence` (WAPresence) → estado no CRM. O Baileys já converte `paused` em `available`. */
const ESTADO_DA_PRESENCA = new Map([
  ["composing", "DIGITANDO"],
  ["recording", "GRAVANDO"],
  ["paused", "PARADO"],
  ["available", "PARADO"],
  ["unavailable", "PARADO"],
]);
/** Inscrição de presença por chat: depois disso, a próxima mensagem do chat inscreve de novo. */
const MS_TTL_INSCRICAO = 6 * 60 * 60 * 1000;
/** Último estado enviado de cada chat/participante (o WhatsApp apaga o "digitando" em ~25 s). */
const MS_TTL_ESTADO = 60 * 60 * 1000;

/** @typedef {import("../services/presencaInternoClient").EstadoPresenca} EstadoPresenca */
/** @typedef {import("../services/presencaInternoClient").DadosPresenca} DadosPresenca */
/** @typedef {import("../services/mensagemInternoClient").ContextoInstancia} ContextoInstancia */
/** @typedef {import("./filtroEntrada").IdentidadePropria} IdentidadePropria */

/**
 * @param {unknown} presenca
 * @returns {EstadoPresenca | null}
 */
function estadoDaPresenca(presenca) {
  return typeof presenca === "string" ? /** @type {EstadoPresenca | undefined} */ (ESTADO_DA_PRESENCA.get(presenca)) ?? null : null;
}

/**
 * @param {unknown} erro
 * @returns {string}
 */
function resumoErro(erro) {
  const { name, code, status } = /** @type {{ name?: unknown, code?: unknown, status?: unknown }} */ (erro && typeof erro === "object" ? erro : {});
  const nome = typeof code === "string" ? code : typeof name === "string" ? name : "erro";
  return typeof status === "number" ? `${nome} HTTP ${status}` : nome;
}

/**
 * Presença de uma equipe.
 * @param {{
 *   contexto: ContextoInstancia,
 *   registrarPresenca?: (dados: DadosPresenca, contexto: ContextoInstancia) => Promise<unknown>,
 *   msTtlInscricao?: number,
 * }} opcoes
 */
function criarPresenca({ contexto, registrarPresenca = presencaInternoClient.registrarPresenca, msTtlInscricao = MS_TTL_INSCRICAO }) {
  const inscritos = new NodeCache({ stdTTL: Math.ceil(msTtlInscricao / 1000), checkperiod: 600, useClones: false });
  const estados = new NodeCache({ stdTTL: Math.ceil(MS_TTL_ESTADO / 1000), checkperiod: 600, useClones: false });
  /** @type {Promise<void>} */
  let filaEnvio = Promise.resolve();

  /**
   * Inscreve a presença do chat no socket, se ainda não inscrita. Nunca rejeita.
   * @param {{ presenceSubscribe?: (jid: string) => Promise<void> }} socket
   * @param {unknown} chatJid
   * @returns {Promise<void>}
   */
  async function inscrever(socket, chatJid) {
    if (typeof chatJid !== "string" || !chatJid.includes("@") || typeof socket?.presenceSubscribe !== "function") return;
    if (inscritos.has(chatJid)) return;
    inscritos.set(chatJid, true);
    try {
      await socket.presenceSubscribe(chatJid);
    } catch (erro) {
      inscritos.del(chatJid);
      console.error(`[PRESENCA] Falha ao inscrever a presença de um chat da equipe ${contexto.cod_equipe}:`, resumoErro(erro));
    }
  }

  /**
   * Trata um `presence.update`: só as mudanças de estado da outra ponta vão ao back. Nunca rejeita.
   * @param {any} evento
   * @param {IdentidadePropria} eu `sock.user` (`id` e `lid`) da equipe
   * @returns {Promise<void>}
   */
  function tratarAtualizacao(evento, eu) {
    const chat = evento && typeof evento === "object" ? evento.id : null;
    const presencas = evento && typeof evento === "object" ? evento.presences : null;
    if (typeof chat !== "string" || !chat.includes("@") || !presencas || typeof presencas !== "object") return filaEnvio;
    const proprios = new Set([normalizarJid(eu?.jid), normalizarJid(eu?.lid)].filter(Boolean));

    for (const [participante, dados] of Object.entries(presencas)) {
      const estado = estadoDaPresenca(dados?.lastKnownPresence);
      const quem = normalizarJid(participante);
      if (!estado || !quem || proprios.has(quem)) continue;
      const participante_jid = quem === normalizarJid(chat) ? null : participante;
      const chave = `${chat}|${participante_jid ?? ""}`;
      if ((estados.get(chave) ?? "PARADO") === estado) continue;
      estados.set(chave, estado);
      /** @type {DadosPresenca} */
      const corpo = { chat_jid: chat, participante_jid, estado };
      filaEnvio = filaEnvio.then(() =>
        Promise.resolve()
          .then(() => registrarPresenca(corpo, contexto))
          .then(
            () => undefined,
            (erro) => console.error(`[PRESENCA] Falha ao registrar a presença ${estado} da equipe ${contexto.cod_equipe}:`, resumoErro(erro))
          )
      );
    }
    return filaEnvio;
  }

  return {
    inscrever,
    tratarAtualizacao,
    limparInscricoes: () => inscritos.flushAll(),
    limpar() {
      inscritos.flushAll();
      estados.flushAll();
    },
  };
}

module.exports = { criarPresenca, estadoDaPresenca };
