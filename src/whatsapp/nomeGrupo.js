// @ts-check
// Nome (subject) e participantes dos grupos. O nome vai no `nome_chat` de `/interno/mensagem-recebida`
// (a lista de conversas do livechat mostra o nome do grupo, e o WAMessage não traz o subject); os
// participantes (id, LID, telefone, admin) completam as menções (`mencoes_detalhe`) e atendem
// `POST /equipe/:cod_equipe/grupo/participantes`. Tudo vem da MESMA consulta, o
// `sock.groupMetadata(jid)`, com cache por equipe (TTL), uma consulta por grupo mesmo com chamadas
// simultâneas, e prazo curto. Falha, prazo esgotado ou subject vazio → nome null (o `nome_chat` vai
// ausente), e a falha fica em cache por pouco tempo para não segurar cada mensagem do grupo.
// `obterNome` nunca rejeita: a mensagem nunca é atrasada além do prazo nem perdida por causa do nome.
// `obterParticipantes` rejeita com `ErroConsultaGrupo` (quem chama decide o que fazer).
// `groups.update` atualiza o nome sem nova consulta e invalida os participantes;
// `group-participants.update` esquece o grupo inteiro (`esquecer`).
// Só memória; nunca JID, LID ou telefone em log.
const { normalizarJid, lidDe, telefoneDe } = require("./filtroEntrada");
const { ehProprio } = require("./mencoesEntrada");

/** Subject em cache: grupos mudam de nome raramente, e o `groups.update` cobre a mudança. */
const MS_TTL_NOME = 60 * 60 * 1000;
/** Falha em cache: evita uma consulta (e a espera do prazo) a cada mensagem de um grupo com erro. */
const MS_TTL_FALHA = 60 * 1000;
/** Prazo da consulta: a mensagem não espera mais que isso pelo nome. */
const MS_PRAZO_CONSULTA = 2000;
/** Teto de grupos em cache por equipe (o mais antigo sai primeiro). */
const MAX_GRUPOS = 2000;

/** @typedef {{ jid: string, lid: string | null, telefone: string | null, admin: boolean }} ParticipanteGrupo */
/** @typedef {"PRAZO_ESGOTADO" | "GRUPO_NAO_ENCONTRADO" | "FALHA"} CodigoErroGrupo */
/** @typedef {{ nome: string | null, participantes: ParticipanteGrupo[] | null, memberAddMode: boolean, erro: CodigoErroGrupo | null, expiraEm: number }} EntradaGrupo */

/** Falha da consulta de participantes; a mensagem não traz JID, LID nem telefone. */
class ErroConsultaGrupo extends Error {
  /** @param {CodigoErroGrupo} codigo */
  constructor(codigo) {
    super("Consulta do grupo falhou.");
    this.name = "ErroConsultaGrupo";
    this.codigo = codigo;
  }
}

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
 * @param {unknown} erro
 * @returns {CodigoErroGrupo}
 */
function classificarErro(erro) {
  if (erro && typeof erro === "object") {
    const e = /** @type {{ name?: unknown, message?: unknown, output?: { statusCode?: unknown }, data?: unknown, statusCode?: unknown }} */ (erro);
    if (e.name === "TimeoutError") return "PRAZO_ESGOTADO";
    const status = Number(e.output?.statusCode ?? e.statusCode ?? (typeof e.data === "number" ? e.data : NaN));
    if (status === 403 || status === 404) return "GRUPO_NAO_ENCONTRADO";
    if (e.message === "item-not-found" || e.message === "forbidden") return "GRUPO_NAO_ENCONTRADO";
  }
  return "FALHA";
}

/**
 * Participante do `groupMetadata` (Baileys 6.7.24: `{ id, jid?, lid?, admin? }`; `id` está no
 * endereçamento do grupo, LID ou telefone). Sem JID válido, o item é descartado.
 * @param {any} p
 * @returns {ParticipanteGrupo | null}
 */
function mapearParticipante(p) {
  const jid = normalizarJid(p?.id);
  if (!jid) return null;
  return {
    jid,
    lid: lidDe(p.lid) ?? lidDe(jid),
    telefone: telefoneDe(p.jid) ?? telefoneDe(p.phoneNumber) ?? telefoneDe(jid),
    admin: p.admin === "admin" || p.admin === "superadmin" || p.isAdmin === true || p.isSuperAdmin === true,
  };
}

/**
 * @param {{ msTtl?: number, msTtlFalha?: number, msPrazo?: number, agora?: () => number }} [opcoes]
 */
function criarCacheNomeGrupo({ msTtl = MS_TTL_NOME, msTtlFalha = MS_TTL_FALHA, msPrazo = MS_PRAZO_CONSULTA, agora = Date.now } = {}) {
  /** @type {Map<string, EntradaGrupo>} */
  const cache = new Map();
  /** @type {Map<string, Promise<EntradaGrupo>>} */
  const emAndamento = new Map();
  /**
   * Geração de invalidação POR GRUPO: uma consulta iniciada antes da invalidação daquele grupo não grava
   * um resultado que já pode estar velho, e a invalidação de um grupo não afeta as consultas dos outros.
   * `base` sobe no `limpar` (vale para todos).
   * @type {Map<string, number>}
   */
  const geracoes = new Map();
  let base = 0;
  /** @param {string} jid */
  const geracaoDe = (jid) => `${base}:${geracoes.get(jid) ?? 0}`;
  /** @param {string} jid */
  function invalidarGeracao(jid) {
    geracoes.set(jid, (geracoes.get(jid) ?? 0) + 1);
    if (geracoes.size > MAX_GRUPOS * 2) {
      geracoes.clear();
      base += 1;
    }
  }

  /**
   * @param {string} jid
   * @param {Omit<EntradaGrupo, "expiraEm">} entrada
   * @param {number} ttl
   */
  function guardar(jid, entrada, ttl) {
    cache.delete(jid);
    cache.set(jid, { ...entrada, expiraEm: agora() + ttl });
    if (cache.size > MAX_GRUPOS) {
      const maisAntigo = cache.keys().next().value;
      if (maisAntigo !== undefined) cache.delete(maisAntigo);
    }
  }

  /**
   * Uma consulta ao WhatsApp. Nunca rejeita: a falha vai na entrada.
   * @param {{ groupMetadata?: (jid: string) => Promise<any> }} socket
   * @param {string} jid
   * @returns {Promise<EntradaGrupo>}
   */
  async function consultar(socket, jid) {
    const geracaoInicial = geracaoDe(jid);
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timer;
    /** @type {Omit<EntradaGrupo, "expiraEm">} */
    let entrada;
    try {
      const estouro = new Promise((_, rejeitar) => {
        timer = setTimeout(() => rejeitar(Object.assign(new Error("Prazo esgotado."), { name: "TimeoutError" })), msPrazo);
      });
      const metadados = /** @type {any} */ (await Promise.race([/** @type {NonNullable<typeof socket.groupMetadata>} */ (socket.groupMetadata)(jid), estouro]));
      const lista = Array.isArray(metadados?.participants) ? metadados.participants : [];
      entrada = {
        nome: limparSubject(metadados?.subject),
        participantes: lista.map(mapearParticipante).filter(/** @param {ParticipanteGrupo | null} p @returns {p is ParticipanteGrupo} */ (p) => p !== null),
        // `member_add_mode` do grupo: true = qualquer participante adiciona; false = só admin.
        memberAddMode: metadados?.memberAddMode === true,
        erro: null,
      };
    } catch (erro) {
      const nomeErro = erro instanceof Error ? erro.name : "erro";
      console.log(`[ENTRADA] Dados do grupo indisponíveis (${nomeErro}); a mensagem segue sem nome_chat.`);
      entrada = { nome: null, participantes: null, memberAddMode: false, erro: classificarErro(erro) };
    } finally {
      clearTimeout(timer);
    }
    const ttl = entrada.nome && !entrada.erro ? msTtl : msTtlFalha;
    if (geracaoInicial === geracaoDe(jid)) guardar(jid, entrada, ttl);
    return { ...entrada, expiraEm: agora() + ttl };
  }

  /** @param {string} chave */
  function emCache(chave) {
    const entrada = cache.get(chave);
    return entrada && entrada.expiraEm > agora() ? entrada : null;
  }

  /**
   * Consulta única por grupo: chamadas simultâneas compartilham a mesma busca.
   * @param {{ groupMetadata?: (jid: string) => Promise<any> }} socket
   * @param {string} chave
   * @returns {Promise<EntradaGrupo>}
   */
  function buscar(socket, chave) {
    const pendente = emAndamento.get(chave);
    if (pendente) return pendente;
    const consulta = consultar(socket, chave).finally(() => {
      if (emAndamento.get(chave) === consulta) emAndamento.delete(chave);
    });
    emAndamento.set(chave, consulta);
    return consulta;
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
    return (emCache(chave) ?? (await buscar(socket, chave))).nome;
  }

  /**
   * Participantes do grupo no endereçamento do grupo (inclui o número da própria equipe).
   * @param {{ groupMetadata?: (jid: string) => Promise<any> }} socket
   * @param {unknown} jid
   * @returns {Promise<ParticipanteGrupo[]>}
   * @throws {ErroConsultaGrupo} prazo esgotado, grupo não encontrado (número fora dele) ou falha
   */
  async function obterParticipantes(socket, jid) {
    return (await entradaDeParticipantes(socket, jid)).participantes ?? [];
  }

  /**
   * Entrada do grupo com os participantes carregados (cache ou uma consulta).
   * @param {{ groupMetadata?: (jid: string) => Promise<any> }} socket
   * @param {unknown} jid
   * @returns {Promise<EntradaGrupo>}
   * @throws {ErroConsultaGrupo}
   */
  async function entradaDeParticipantes(socket, jid) {
    if (!ehGrupo(jid)) throw new ErroConsultaGrupo("GRUPO_NAO_ENCONTRADO");
    if (typeof socket?.groupMetadata !== "function") throw new ErroConsultaGrupo("FALHA");
    const chave = /** @type {string} */ (jid);
    let entrada = emCache(chave);
    if (!entrada || (!entrada.erro && !entrada.participantes)) entrada = await buscar(socket, chave);
    if (entrada.erro) throw new ErroConsultaGrupo(entrada.erro);
    return entrada;
  }

  /**
   * A equipe pode adicionar participantes neste grupo? Sim quando é admin ou quando o grupo deixa
   * qualquer participante adicionar (`memberAddMode`). Número fora do grupo → GRUPO_NAO_ENCONTRADO.
   * @param {{ groupMetadata?: (jid: string) => Promise<any> }} socket
   * @param {unknown} jid
   * @param {{ jid?: string | null, lid?: string | null }} proprio identidade do número da equipe (`sock.user`)
   * @returns {Promise<boolean>}
   * @throws {ErroConsultaGrupo} prazo esgotado, grupo não encontrado (equipe fora dele) ou falha
   */
  async function podeAdicionar(socket, jid, proprio) {
    const entrada = await entradaDeParticipantes(socket, jid);
    const eu = (entrada.participantes ?? []).find((p) => ehProprio(p, proprio));
    if (!eu) throw new ErroConsultaGrupo("GRUPO_NAO_ENCONTRADO");
    return eu.admin || entrada.memberAddMode;
  }

  /**
   * `groups.update` / `groups.upsert`: guarda o subject novo, se veio, sem nova consulta. Os
   * participantes do grupo atualizado são invalidados (a próxima consulta de participantes os busca).
   * @param {unknown} grupos
   */
  function aprender(grupos) {
    if (!Array.isArray(grupos)) return;
    for (const grupo of grupos) {
      if (!ehGrupo(grupo?.id)) continue;
      const nome = limparSubject(grupo.subject);
      const atual = cache.get(grupo.id);
      if (nome) guardar(grupo.id, { nome, participantes: null, memberAddMode: false, erro: null }, msTtl);
      else if (atual && !atual.erro) cache.set(grupo.id, { ...atual, participantes: null });
      invalidarGeracao(grupo.id);
      emAndamento.delete(grupo.id);
    }
  }

  /**
   * `group-participants.update`: entrou, saiu ou mudou de papel alguém; o grupo é consultado de novo.
   * @param {unknown} jid
   */
  function esquecer(jid) {
    if (!ehGrupo(jid)) return;
    cache.delete(/** @type {string} */ (jid));
    emAndamento.delete(/** @type {string} */ (jid));
    invalidarGeracao(/** @type {string} */ (jid));
  }

  return {
    obterNome,
    obterParticipantes,
    podeAdicionar,
    aprender,
    esquecer,
    limpar() {
      cache.clear();
      emAndamento.clear();
      geracoes.clear();
      base += 1;
    },
  };
}

module.exports = { criarCacheNomeGrupo, ErroConsultaGrupo, MS_PRAZO_CONSULTA };
