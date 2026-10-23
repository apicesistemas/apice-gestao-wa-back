// @ts-check
// TEMPORÁRIO (Fase 56, Task 56.0; sai na 56.1): diagnóstico do "digitando..." do cliente em runtime, no
// padrão do `diagnosticoChamadas.js`. Só grava no log, com o prefixo `[DIAG_PRESENCA]`, flags S/N, nomes de
// estado e domínios (`s.whatsapp.net`, `lid`, `g.us`, `outro`). Nunca JID, LID, telefone, nome ou texto.
// Nada sai do wa-back além do que já saía (o corpo do `/interno/presenca` não muda).
// Liga só com `DIAGNOSTICO_PRESENCA=S` e só para os `cod_equipe` de `DIAGNOSTICO_PRESENCA_EQUIPES`
// (lista por vírgula), lidos a cada chamada. `DIAGNOSTICO_PRESENCA_ONLINE=S` (nas mesmas equipes) manda
// `sendPresenceUpdate("available")` depois do `open`. Nenhuma função daqui lança: tudo roda em try/catch.
//
// Ganchos a remover na 56.1 (além deste arquivo, do teste e das variáveis do `.env.example`):
// - presenca.js: o `require("./diagnosticoPresenca")`, a função `respostaDoBack`, as 2 chamadas a
//   `registrarInscricao` em `inscrever`, e em `tratarAtualizacao` o objeto `diag` (com `marcarChegada`) e as
//   5 chamadas a `registrarEvento` (3 `continue` e os 2 tratadores da `filaEnvio`);
// - BaileysAdapter.js: o `require("./diagnosticoPresenca")` e a linha `void diagnosticoPresenca.aoAbrir(...)`
//   no ramo `connection === "open"` de `tratarConexao`;
// - diagnosticoChamadas.js: os exports `dominioDe` e `sn` (inofensivos, só deixam de ter uso aqui).
const { normalizarJid } = require("./filtroEntrada");
const { dominioDe, sn } = require("./diagnosticoChamadas");

const PREFIXO = "[DIAG_PRESENCA]";
const MAX_INTERVALOS = 1000;

/** Instante da chegada do último evento igual (equipe|chat|participante|presença). Só em memória, chave crua. @type {Map<string, number>} */
const ultimos = new Map();

/**
 * @param {unknown} codEquipe
 * @returns {boolean}
 */
function ligadoPara(codEquipe) {
  if (process.env.DIAGNOSTICO_PRESENCA !== "S") return false;
  const equipes = (process.env.DIAGNOSTICO_PRESENCA_EQUIPES || "").split(",").map((e) => e.trim()).filter(Boolean);
  return equipes.includes(String(codEquipe));
}

/** Só caracteres seguros num valor `chave=valor`, e nunca uma sequência de 5+ dígitos. @param {unknown} v @returns {string} */
function seguro(v) {
  return String(v ?? "").replace(/[^A-Za-z0-9_.-]/g, "_").replace(/\d{5,}/g, "#").slice(0, 40) || "-";
}

/** @param {string} linha */
function gravar(linha) {
  console.log(`${PREFIXO} ${linha}`);
}

/** Intervalo sem nunca ter 5+ dígitos: ms até 9999, depois segundos (até 9999). @param {number | undefined} ms */
function formatarIntervalo(ms) {
  if (ms === undefined) return "-";
  if (ms < 10_000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  return s > 9999 ? ">9999s" : `${s}s`;
}

/** @typedef {{ chat: unknown, participante: unknown, presenca: unknown, inscrito: boolean, proprio: boolean, repetido: boolean, resposta: string, intervaloMs?: number }} InfoEvento */

/**
 * Chamar na CHEGADA do evento (antes de qualquer espera pelo back): guarda o instante e devolve a info com o
 * intervalo desde o evento anterior igual. Assim a latência do back e a ordem das linhas não mexem no cálculo.
 * @param {unknown} codEquipe
 * @param {InfoEvento} info
 * @returns {InfoEvento}
 */
function marcarChegada(codEquipe, info) {
  try {
    if (!ligadoPara(codEquipe)) return info;
    const chave = `${codEquipe}|${info.chat}|${info.participante}|${info.presenca}`;
    const agora = Date.now();
    const anterior = ultimos.get(chave);
    if (ultimos.size >= MAX_INTERVALOS) ultimos.clear();
    ultimos.set(chave, agora);
    return anterior === undefined ? info : { ...info, intervaloMs: agora - anterior };
  } catch {
    return info;
  }
}

/**
 * Uma linha por participante de um `presence.update`.
 * @param {unknown} codEquipe
 * @param {InfoEvento} info
 */
function registrarEvento(codEquipe, info) {
  try {
    if (!ligadoPara(codEquipe)) return;
    const { chat, participante, presenca, inscrito, proprio, repetido, resposta, intervaloMs } = info;
    const aparelho = typeof chat === "string" && chat.includes("@") && chat.slice(0, chat.indexOf("@")).includes(":");
    const bruta = typeof presenca === "string" && /^[a-z]{1,20}$/.test(presenca) ? presenca : presenca == null ? "ausente" : "outro";
    gravar(
      `evento=presence equipe=${seguro(codEquipe)} chat_dominio=${dominioDe(chat)} chat_aparelho=${sn(aparelho)} part_dominio=${dominioDe(participante)} ` +
        `part_igual_chat=${sn(normalizarJid(participante) !== null && normalizarJid(participante) === normalizarJid(chat))} presenca=${bruta} ` +
        `inscrito=${sn(inscrito)} proprio=${sn(proprio)} repetido=${proprio ? "?" : sn(repetido)} ` +
        `intervalo=${formatarIntervalo(intervaloMs)} resposta=${seguro(resposta)}`,
    );
  } catch {
    // diagnóstico nunca derruba a presença
  }
}

/**
 * Tentativa de inscrição de presença (`presenceSubscribe`).
 * @param {unknown} codEquipe
 * @param {unknown} chat
 * @param {string} resultado "ok" ou o nome/código do erro
 */
function registrarInscricao(codEquipe, chat, resultado) {
  try {
    if (!ligadoPara(codEquipe)) return;
    gravar(`evento=inscricao equipe=${seguro(codEquipe)} chat_dominio=${dominioDe(chat)} resultado=${seguro(resultado)}`);
  } catch {
    // diagnóstico nunca derruba a presença
  }
}

/**
 * No `open`: loga o `open` e, com `DIAGNOSTICO_PRESENCA_ONLINE=S`, manda `available`. O Baileys ignora o
 * `available` em silêncio quando o número não tem nome (`creds.me.name`), então o log diz se há nome (S/N).
 * `baileys_padrao=unavailable` é o PRESUMIDO pelo código (`markOnlineOnConnect: false`), não é medido.
 * Nunca rejeita.
 * @param {unknown} codEquipe
 * @param {{ user?: { name?: string } | null, sendPresenceUpdate: (tipo: "available") => Promise<unknown> } | null | undefined} socket
 * @returns {Promise<void>}
 */
async function aoAbrir(codEquipe, socket) {
  try {
    if (!ligadoPara(codEquipe)) return;
    const online = process.env.DIAGNOSTICO_PRESENCA_ONLINE === "S";
    let resultado = "-";
    if (online) {
      try {
        await /** @type {NonNullable<typeof socket>} */ (socket).sendPresenceUpdate("available");
        resultado = "ok";
      } catch (erro) {
        resultado = erro instanceof Error ? erro.name : "erro";
      }
    }
    gravar(
      `evento=open equipe=${seguro(codEquipe)} baileys_padrao=unavailable nome_no_socket=${sn(Boolean(socket?.user?.name))} ` +
        `online_diag=${sn(online)} resultado=${seguro(resultado)}`,
    );
  } catch {
    // diagnóstico nunca derruba a conexão
  }
}

module.exports = { ligadoPara, marcarChegada, registrarEvento, registrarInscricao, aoAbrir, PREFIXO };
