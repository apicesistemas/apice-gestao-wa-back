// @ts-check
// Diagnóstico das chamadas de voz e vídeo (Fase 34, Task 34.0). Só grava no log, com o prefixo
// `[DIAG-CHAMADA]`, a FORMA do evento `call` e das mensagens do `messages.upsert`: flags, nomes de
// enum e domínios (`s.whatsapp.net`, `lid`, `g.us`, `outro`). Nunca id, telefone, JID, LID ou nome.
// Nada sai do wa-back: nenhuma rota `/interno/*`, nenhum `sendMessage`, nenhum `rejectCall`.
// Liga só com `DIAGNOSTICO_CHAMADAS=S` (lido a cada chamada, então o teste liga e desliga à vontade).
const { desembrulhar } = require("./filtroEntrada");

const PREFIXO = "[DIAG-CHAMADA]";

/** `proto.Message.CallLogMessage.CallOutcome`. */
const RESULTADOS = new Map([
  [0, "CONNECTED"],
  [1, "MISSED"],
  [2, "FAILED"],
  [3, "REJECTED"],
  [4, "ACCEPTED_ELSEWHERE"],
  [5, "ONGOING"],
  [6, "SILENCED_BY_DND"],
  [7, "SILENCED_UNKNOWN_CALLER"],
]);
/** `proto.WebMessageInfo.StubType` das chamadas perdidas. */
const STUBS_CHAMADA = new Map([
  [40, "CALL_MISSED_VOICE"],
  [41, "CALL_MISSED_VIDEO"],
  [45, "CALL_MISSED_GROUP_VOICE"],
  [46, "CALL_MISSED_GROUP_VIDEO"],
]);
const STATUS_CALL = new Set(["offer", "ringing", "timeout", "reject", "accept", "terminate"]);
/** Nome de campo do proto (letras só): é a forma da mensagem, nunca dado do usuário. */
const PADRAO_CAMPO_PROTO = /^[a-zA-Z]{1,40}$/;
/** Campos que acompanham qualquer mensagem e não dizem o tipo dela. */
const CAMPOS_IGNORADOS = new Set(["messageContextInfo", "senderKeyDistributionMessage"]);

/** @returns {boolean} */
function diagnosticoLigado() {
  return process.env.DIAGNOSTICO_CHAMADAS === "S";
}

/** @param {unknown} v @returns {string} */
function sn(v) {
  return v === true ? "S" : v === false ? "N" : "?";
}

/**
 * Domínio do JID, sem nunca devolver nada do que vem antes do `@`.
 * @param {unknown} jid
 * @returns {"s.whatsapp.net" | "lid" | "g.us" | "outro" | "ausente"}
 */
function dominioDe(jid) {
  if (typeof jid !== "string" || jid === "") return "ausente";
  const dominio = jid.slice(jid.lastIndexOf("@") + 1);
  if (jid.includes("@") && (dominio === "s.whatsapp.net" || dominio === "lid" || dominio === "g.us")) return dominio;
  return "outro";
}

/** Parte do usuário, sem o sufixo de dispositivo (`123:7@lid` → `123`). @param {unknown} jid @returns {string | null} */
function usuarioDe(jid) {
  if (typeof jid !== "string" || !jid.includes("@")) return null;
  const usuario = jid.slice(0, jid.indexOf("@")).split(":")[0];
  return usuario || null;
}

/**
 * Se o JID é o número da própria equipe (pelo JID ou pelo LID do socket).
 * @param {unknown} jid
 * @param {{ jid?: string | null, lid?: string | null } | undefined} eu
 * @returns {string} "S" | "N" | "?" (sem JID ou sem identidade da equipe)
 */
function ehEquipe(jid, eu) {
  const usuario = usuarioDe(jid);
  const meus = [usuarioDe(eu?.jid), usuarioDe(eu?.lid)].filter(Boolean);
  if (!usuario || meus.length === 0) return "?";
  return meus.includes(usuario) ? "S" : "N";
}

/** @param {string} linha */
function gravar(linha) {
  console.log(`${PREFIXO} ${linha}`);
}

/**
 * Uma linha por evento `call` do Baileys (`WACallEvent`).
 * @param {unknown} eventos lista de `WACallEvent`
 * @param {{ jid?: string | null, lid?: string | null }} [eu] identidade do socket da equipe
 */
function registrarFormaEventoCall(eventos, eu) {
  if (!diagnosticoLigado()) return;
  try {
    const lista = Array.isArray(eventos) ? eventos : [eventos];
    for (const evento of lista) {
      if (!evento || typeof evento !== "object") continue;
      const e = /** @type {Record<string, any>} */ (evento);
      const status = STATUS_CALL.has(e.status) ? e.status : "outro";
      gravar(
        `evento=call status=${status} offline=${sn(e.offline)} video=${sn(e.isVideo)} grupo=${sn(e.isGroup)} ` +
          `groupJid=${e.groupJid ? "S" : "N"} from_equipe=${ehEquipe(e.from, eu)} from_dominio=${dominioDe(e.from)} ` +
          `chat_equipe=${ehEquipe(e.chatId, eu)} chat_dominio=${dominioDe(e.chatId)}`,
      );
    }
  } catch {
    // diagnóstico nunca derruba a entrada
  }
}

/**
 * Uma linha por mensagem do `messages.upsert`. Inclui o `callLogMesssage` (3 "s", como no WAProto) e o
 * `call`, mesmo embrulhados em `ephemeralMessage` ou `viewOnce`.
 * @param {any} waMessage
 * @param {{ jid?: string | null, lid?: string | null }} [eu]
 */
function registrarFormaMensagem(waMessage, eu) {
  if (!diagnosticoLigado()) return;
  try {
    if (!waMessage || typeof waMessage !== "object") return;
    const conteudo = desembrulhar(waMessage.message);
    const embrulhada = conteudo !== waMessage.message;
    const registro = conteudo?.callLogMesssage;
    const temRegistro = registro && typeof registro === "object";
    const temCall = Boolean(conteudo?.call && typeof conteudo.call === "object");
    const stub = Number(waMessage.messageStubType);
    const nomeStub = Number.isInteger(stub) ? (STUBS_CHAMADA.get(stub) ?? (stub >= 0 && stub < 1000 ? String(stub) : "outro")) : "ausente";
    const resultado = temRegistro && registro.callOutcome != null ? Number(registro.callOutcome) : NaN;
    const campo = conteudo && typeof conteudo === "object"
      ? Object.keys(conteudo).find((k) => !CAMPOS_IGNORADOS.has(k) && PADRAO_CAMPO_PROTO.test(k)) ?? "nenhum"
      : "nenhum";
    gravar(
      `evento=upsert fromMe=${sn(waMessage.key?.fromMe)} dominio=${dominioDe(waMessage.key?.remoteJid)} ` +
        `participante=${waMessage.key?.participant ? dominioDe(waMessage.key.participant) : "ausente"} ` +
        `stub=${nomeStub} embrulhada=${sn(embrulhada)} callLog=${sn(Boolean(temRegistro))} call=${sn(temCall)} ` +
        `outcome=${temRegistro ? (Number.isInteger(resultado) ? (RESULTADOS.get(resultado) ?? "outro") : "ausente") : "-"} ` +
        `video=${temRegistro ? sn(registro.isVideo) : "-"} duracao=${temRegistro ? (registro.durationSecs == null ? "N" : "S") : "-"} ` +
        `campo=${campo} equipe_remetente=${ehEquipe(waMessage.key?.participant ?? waMessage.key?.remoteJid, eu)}`,
    );
  } catch {
    // diagnóstico nunca derruba a entrada
  }
}

module.exports = { registrarFormaEventoCall, registrarFormaMensagem, diagnosticoLigado, PREFIXO };
