// @ts-check
// Nome (subject) dos grupos para o `nome_chat` de `/interno/mensagem-recebida`: a lista de conversas
// do livechat mostra o nome do grupo, e o WAMessage não traz o subject. Vem do
// `sock.groupMetadata(jid)` com cache por equipe (TTL), uma consulta por grupo mesmo com mensagens
// simultâneas, e prazo curto. Falha, prazo esgotado ou subject vazio → null (o `nome_chat` vai
// ausente), e a falha fica em cache por pouco tempo para não segurar cada mensagem do grupo.
// Nunca rejeita: a mensagem nunca é atrasada além do prazo nem perdida por causa do nome.
// O `groups.update` (grupo renomeado) atualiza o cache sem nova consulta.

/** Subject em cache: grupos mudam de nome raramente, e o `groups.update` cobre a mudança. */
const MS_TTL_NOME = 60 * 60 * 1000;
/** Falha em cache: evita uma consulta (e a espera do prazo) a cada mensagem de um grupo com erro. */
const MS_TTL_FALHA = 60 * 1000;
/** Prazo da consulta: a mensagem não espera mais que isso pelo nome. */
const MS_PRAZO_CONSULTA = 2000;
/** Teto de grupos em cache por equipe (o mais antigo sai primeiro). */
const MAX_GRUPOS = 2000;

/**
 * @param {unknown} subject
 * @returns {string | null}
 */
function limparSubject(subject) {
  if (typeof subject !== "string") return null;
  const texto = subject.trim();
  return texto ? texto.slice(0, 255) : null;
}

/** @param {unknown} jid */
const ehGrupo = (jid) => typeof jid === "string" && jid.endsWith("@g.us");

/**
 * @param {{ msTtl?: number, msTtlFalha?: number, msPrazo?: number, agora?: () => number }} [opcoes]
 */
function criarCacheNomeGrupo({ msTtl = MS_TTL_NOME, msTtlFalha = MS_TTL_FALHA, msPrazo = MS_PRAZO_CONSULTA, agora = Date.now } = {}) {
  /** @type {Map<string, { nome: string | null, expiraEm: number }>} */
  const cache = new Map();
  /** @type {Map<string, Promise<string | null>>} */
  const emAndamento = new Map();

  /**
   * @param {string} jid
   * @param {string | null} nome
   * @param {number} ttl
   */
  function guardar(jid, nome, ttl) {
    cache.delete(jid);
    cache.set(jid, { nome, expiraEm: agora() + ttl });
    if (cache.size > MAX_GRUPOS) {
      const maisAntigo = cache.keys().next().value;
      if (maisAntigo !== undefined) cache.delete(maisAntigo);
    }
  }

  /**
   * @param {{ groupMetadata?: (jid: string) => Promise<any> }} socket
   * @param {string} jid
   * @returns {Promise<string | null>}
   */
  async function consultar(socket, jid) {
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timer;
    try {
      const estouro = new Promise((_, rejeitar) => {
        timer = setTimeout(() => rejeitar(Object.assign(new Error("Prazo esgotado."), { name: "TimeoutError" })), msPrazo);
      });
      const metadados = await Promise.race([/** @type {NonNullable<typeof socket.groupMetadata>} */ (socket.groupMetadata)(jid), estouro]);
      const nome = limparSubject(/** @type {any} */ (metadados)?.subject);
      guardar(jid, nome, nome ? msTtl : msTtlFalha);
      return nome;
    } catch (erro) {
      const nomeErro = erro instanceof Error ? erro.name : "erro";
      console.log(`[ENTRADA] Nome do grupo indisponível (${nomeErro}); a mensagem segue sem nome_chat.`);
      guardar(jid, null, msTtlFalha);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Subject do grupo, ou null. Nunca rejeita.
   * @param {{ groupMetadata?: (jid: string) => Promise<any> }} socket
   * @param {unknown} jid
   * @returns {Promise<string | null>}
   */
  async function obterNome(socket, jid) {
    if (!ehGrupo(jid) || typeof socket?.groupMetadata !== "function") return null;
    const chave = /** @type {string} */ (jid);
    const emCache = cache.get(chave);
    if (emCache && emCache.expiraEm > agora()) return emCache.nome;
    const pendente = emAndamento.get(chave);
    if (pendente) return pendente;
    const consulta = consultar(socket, chave).finally(() => emAndamento.delete(chave));
    emAndamento.set(chave, consulta);
    return consulta;
  }

  /**
   * `groups.update` / `groups.upsert`: guarda o subject novo, se veio.
   * @param {unknown} grupos
   */
  function aprender(grupos) {
    if (!Array.isArray(grupos)) return;
    for (const grupo of grupos) {
      const nome = limparSubject(grupo?.subject);
      if (ehGrupo(grupo?.id) && nome) guardar(grupo.id, nome, msTtl);
    }
  }

  return {
    obterNome,
    aprender,
    limpar() {
      cache.clear();
      emAndamento.clear();
    },
  };
}

module.exports = { criarCacheNomeGrupo, MS_PRAZO_CONSULTA };
