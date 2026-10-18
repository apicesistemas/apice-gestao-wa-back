// @ts-check
// Adição de participantes a um grupo da equipe (Fase 28, Task 28.1). Só o necessário para o IQ de
// adição do Baileys 6.7.24, no ritmo que o back manda (nada de laço sem pausa: risco de banimento):
//
// - `consultarNumero`: `onWhatsApp` de UM telefone por vez, com prazo técnico. O número sem WhatsApp
//   é omitido pelo Baileys; o `jid` devolvido é o real (9º dígito), e é ele que vai no `add`;
// - `mapearStatusAdicao`: o `groupParticipantsUpdate` devolve `[{ status, jid, content }]` com o status
//   em string ("200", "403", "408", "409") e o `content` é o BinaryNode `participant`; o `add_request`
//   (`code`, `expiration`) vem dentro dele e o Baileys não o interpreta, então a leitura é defensiva;
// - `adicionarEmSerie`: um telefone por vez, um IQ por telefone, `dormir(segundosIntervalo)` depois de
//   cada telefone em que houve IQ, EXCETO depois do último. O convite sai junto com a adição daquele
//   telefone e entra na mesma pausa (uma pausa por telefone, não uma por IQ e outra por convite).
//   Abortável pelo `sinal` (desconectar, remover, desligamento, back que desistiu): confere o sinal
//   antes de cada etapa (consulta, IQ, convite) e o telefone abortado, com o restante, sai
//   NAO_PROCESSADO. Um IQ que já foi enviado não é cancelado. A resposta mantém a ordem da entrada;
// - `enviarConviteV4`: convite nativo (groupInvite) individual, em mensagem privada, só no 403 com
//   `add_request` e só quando o back mandou `convite`. O id é marcado como enviado pelo CRM ANTES do
//   `sendMessage`, então o eco não vira `/interno/mensagem-recebida`.
//
// Nunca JID, LID, telefone ou código de convite em log: só códigos e contagens.
const { normalizarJid, lidDe, telefoneDe } = require("./filtroEntrada");

/**
 * Prazos técnicos de rede (não são regra de negócio; o ritmo e as quantidades vêm do back).
 * `onWhatsApp` e `sendMessage` do convite usam o primeiro; o IQ de adição, o segundo.
 */
const MS_PRAZO_CONSULTA_NUMERO = 15_000;
const MS_PRAZO_ENVIO_CONVITE = 30_000;
const MS_PRAZO_ADICAO = 30_000;
/** Prazo técnico do `groupCreate` (passado o prazo, a criação fica "não confirmada" e nunca é repetida). */
const MS_PRAZO_CRIACAO = 30_000;
const PADRAO_GRUPO = /^[\d-]{1,40}@g\.us$/;

/** @typedef {"ADICIONADO" | "JA_PARTICIPA" | "CONVITE_NECESSARIO" | "SAIU_RECENTEMENTE" | "SEM_WHATSAPP" | "FALHA" | "NAO_PROCESSADO"} StatusParticipante */
/** @typedef {{ telefone: string, status: StatusParticipante, convite_enviado: boolean }} ResultadoParticipante */
/** @typedef {{ inviteCode: string, inviteExpiration: number }} PedidoConvite */
/** @typedef {{ jid: string, lid: string | null }} NumeroResolvido */

const MENSAGENS_ERRO_GRUPO = {
  NAO_ADMIN: "O número da equipe não é administrador deste grupo.",
  DESCONECTADA: "O WhatsApp da equipe não está conectado.",
  CRIACAO_NAO_CONFIRMADA: "Criação do grupo não confirmada.",
  SEM_PARTICIPANTE_VALIDO: "Nenhum dos telefones informados tem WhatsApp. O grupo não foi criado.",
};

/** Falha de negócio da operação de grupo; a mensagem não leva JID, LID nem telefone. */
class ErroGrupo extends Error {
  /**
   * @param {keyof typeof MENSAGENS_ERRO_GRUPO} codigo
   * @param {ResultadoParticipante[]} [participantes] status de cada telefone (SEM_PARTICIPANTE_VALIDO)
   */
  constructor(codigo, participantes) {
    super(MENSAGENS_ERRO_GRUPO[codigo]);
    this.name = "ErroGrupo";
    this.codigo = codigo;
    this.participantes = participantes;
  }
}

/**
 * Só o nome/código do erro (a mensagem do Baileys pode trazer JID ou telefone).
 * @param {unknown} erro
 * @returns {string}
 */
function codigoDoErro(erro) {
  if (erro && typeof erro === "object") {
    const { code, name } = /** @type {{ code?: unknown, name?: unknown }} */ (erro);
    if (typeof code === "string") return code;
    if (typeof name === "string") return name;
  }
  return "erro";
}

/**
 * Código HTTP-like de um erro lançado pelo Baileys 6.7.24. O `assertNodeErrorFree` faz
 * `new Boom(texto, { data: +codigo })`: o `output.statusCode` fica em 500 e o código real vai em `data`.
 * Ordem de leitura: `data`, depois `output.statusCode` (e `statusCode`), por fim o texto "rate-overlimit" (429).
 * @param {unknown} erro
 * @returns {number | null}
 */
function statusDoErro(erro) {
  if (!erro || typeof erro !== "object") return null;
  const e = /** @type {{ data?: unknown, output?: { statusCode?: unknown }, statusCode?: unknown, message?: unknown }} */ (erro);
  for (const candidato of [e.data, e.output?.statusCode, e.statusCode]) {
    const n = Number(candidato);
    if (candidato !== null && candidato !== undefined && candidato !== "" && Number.isInteger(n) && n !== 500) return n;
  }
  if (e.message === "rate-overlimit") return 429;
  return null;
}

/**
 * Corrida entre uma promessa e o prazo técnico. O prazo esgotado rejeita com `TimeoutError`.
 * @template T
 * @param {Promise<T>} promessa
 * @param {number} ms
 * @returns {Promise<T>}
 */
function comPrazo(promessa, ms) {
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  const estouro = new Promise((_, rejeitar) => {
    timer = setTimeout(() => rejeitar(Object.assign(new Error("Prazo esgotado."), { name: "TimeoutError" })), ms);
  });
  // Se o prazo vence primeiro, a promessa original pode rejeitar depois: sem tratador viraria rejeição solta.
  promessa.catch(() => {});
  return Promise.race([promessa, estouro]).finally(() => clearTimeout(timer));
}

/**
 * Espera `segundos`, ou menos se o `sinal` abortar. Nunca rejeita.
 * @param {number} segundos
 * @param {AbortSignal} [sinal]
 * @returns {Promise<void>}
 */
function dormirPadrao(segundos, sinal) {
  return new Promise((resolve) => {
    if (sinal?.aborted || !(segundos > 0)) {
      resolve();
      return;
    }
    const fim = () => {
      clearTimeout(timer);
      sinal?.removeEventListener("abort", fim);
      resolve();
    };
    const timer = setTimeout(fim, segundos * 1000);
    sinal?.addEventListener("abort", fim, { once: true });
  });
}

/**
 * Consulta UM telefone no WhatsApp. Telefone sem WhatsApp → null (o Baileys o omite da resposta).
 * @param {{ onWhatsApp?: (...jids: string[]) => Promise<any> }} socket
 * @param {string} telefone só dígitos, com DDI
 * @param {{ msPrazo?: number }} [opcoes]
 * @returns {Promise<NumeroResolvido | null>}
 * @throws {Error} socket sem `onWhatsApp`, prazo esgotado ou falha da consulta
 */
async function consultarNumero(socket, telefone, { msPrazo = MS_PRAZO_CONSULTA_NUMERO } = {}) {
  if (typeof socket?.onWhatsApp !== "function") throw new Error("Consulta de número indisponível.");
  const resposta = await comPrazo(Promise.resolve().then(() => /** @type {NonNullable<typeof socket.onWhatsApp>} */ (socket.onWhatsApp)(`${telefone}@s.whatsapp.net`)), msPrazo);
  const itens = Array.isArray(resposta) ? resposta : [];
  for (const item of itens) {
    if (!item || item.exists === false) continue;
    const jid = normalizarJid(item.jid);
    if (!jid || !telefoneDe(jid)) continue; // só o JID de telefone vai no `add`
    return { jid, lid: lidDe(item.lid) };
  }
  return null;
}

/**
 * Procura o nó `add_request` no `content` do item (o `participant` do BinaryNode, ou o próprio nó), com
 * profundidade limitada. Qualquer formato inesperado → null.
 * @param {any} no
 * @param {number} [profundidade]
 * @returns {PedidoConvite | null}
 */
function acharAddRequest(no, profundidade = 0) {
  if (!no || typeof no !== "object" || profundidade > 4) return null;
  if (no.tag === "add_request") {
    const code = no.attrs?.code;
    const expiration = Number(no.attrs?.expiration);
    if (typeof code === "string" && code.trim() !== "" && Number.isFinite(expiration) && expiration > 0) {
      return { inviteCode: code, inviteExpiration: Math.trunc(expiration) };
    }
    return null;
  }
  const filhos = Array.isArray(no.content) ? no.content : [];
  for (const filho of filhos) {
    const achado = acharAddRequest(filho, profundidade + 1);
    if (achado) return achado;
  }
  return null;
}

/**
 * Status do item do `groupParticipantsUpdate` ("200" adicionado, "403" privacidade, "408" saiu há pouco,
 * "409" já participa; outro código ou formato → FALHA).
 * @param {unknown} status
 * @param {unknown} [content] BinaryNode do participante (traz o `add_request` no 403)
 * @returns {{ status: StatusParticipante, pedidoConvite: PedidoConvite | null }}
 */
function mapearStatusAdicao(status, content) {
  const codigo = typeof status === "number" || typeof status === "string" ? String(status).trim() : "";
  switch (codigo) {
    case "200":
      return { status: "ADICIONADO", pedidoConvite: null };
    case "403":
      return { status: "CONVITE_NECESSARIO", pedidoConvite: acharAddRequest(content) };
    case "408":
      return { status: "SAIU_RECENTEMENTE", pedidoConvite: null };
    case "409":
      return { status: "JA_PARTICIPA", pedidoConvite: null };
    default:
      return { status: "FALHA", pedidoConvite: null };
  }
}

/**
 * @typedef {{
 *   socketConectado: () => any,
 *   obterParticipantesGrupo: (chatJid: string) => Promise<import("./nomeGrupo").ParticipanteGrupo[]>,
 *   obterNomeGrupo?: (chatJid: string) => Promise<string | null>,
 *   marcarEnviadaPeloCrm: (mensagemWaId: string) => void,
 *   guardarEnviada?: (mensagemWaId: string, message: any, chatJid: string) => void,
 *   aprenderGrupo?: (grupos: { id: string, subject: string }[]) => void,
 * }} AdapterGrupo
 */

/**
 * Convite nativo (v4) de um grupo, em mensagem PRIVADA ao `jidPessoa`. Sem texto livre: o único texto é
 * a legenda (`convite.texto`, parâmetro do back).
 * @param {AdapterGrupo} adapter
 * @param {string} jidPessoa JID de telefone da pessoa (o do `onWhatsApp`)
 * @param {{ inviteCode: string, inviteExpiration: number, chatJid: string, subject?: string | null, texto: string }} convite
 * @param {{ msPrazo?: number }} [opcoes]
 * @returns {Promise<void>}
 * @throws {Error} sem conexão, prazo esgotado ou falha do envio
 */
async function enviarConviteV4(adapter, jidPessoa, { inviteCode, inviteExpiration, chatJid, subject, texto }, { msPrazo = MS_PRAZO_ENVIO_CONVITE } = {}) {
  const socket = adapter.socketConectado();
  if (!socket) throw new ErroGrupo("DESCONECTADA");
  // Carga tardia, como no envio.js: os testes trocam o pacote via `require.cache`.
  const { generateMessageIDV2 } = require("@whiskeysockets/baileys");
  const id = generateMessageIDV2(socket.user?.id);
  adapter.marcarEnviadaPeloCrm(id); // ANTES do sendMessage: o eco pode chegar antes de ele devolver
  const conteudo = { groupInvite: { jid: chatJid, name: subject || "Grupo", caption: texto, inviteCode, inviteExpiration } };
  const enviada = await comPrazo(Promise.resolve().then(() => socket.sendMessage(jidPessoa, conteudo, { messageId: id })), msPrazo);
  try {
    if (enviada?.message) adapter.guardarEnviada?.(id, enviada.message, jidPessoa);
  } catch {
    // o cache de reenvio nunca derruba o convite
  }
}

/**
 * @param {import("./nomeGrupo").ParticipanteGrupo[]} participantes
 * @returns {{ tem: (item: { jid?: string | null, lid?: string | null, telefones?: (string | null)[] }) => boolean, incluir: (item: { jid?: string | null, lid?: string | null, telefones?: (string | null)[] }) => void }}
 */
function indexarParticipantes(participantes) {
  const jids = new Set();
  const lids = new Set();
  const telefones = new Set();
  /** @param {{ jid?: string | null, lid?: string | null, telefones?: (string | null)[] }} item */
  const incluir = ({ jid, lid, telefones: fones }) => {
    if (jid) jids.add(jid);
    if (lid) lids.add(lid);
    for (const t of fones ?? []) if (t) telefones.add(t);
  };
  for (const p of participantes) incluir({ jid: p.jid, lid: p.lid, telefones: [p.telefone] });
  return {
    incluir,
    tem: ({ jid, lid, telefones: fones }) =>
      Boolean((jid && jids.has(jid)) || (lid && lids.has(lid)) || (fones ?? []).some((t) => t && telefones.has(t))),
  };
}

/**
 * Adiciona os telefones ao grupo, um por vez. Nunca rejeita por causa de UM telefone (vira FALHA); rejeita
 * só se a operação inteira não pode começar (sem conexão, consulta dos participantes).
 * @param {AdapterGrupo} adapter
 * @param {string} chatJid
 * @param {string[]} telefones só dígitos, com DDI (ex.: 5511900000001)
 * @param {{
 *   segundosIntervalo: number,
 *   convite?: { texto: string } | null,
 *   dormir?: (segundos: number, sinal?: AbortSignal) => Promise<void>,
 *   sinal?: AbortSignal,
 *   msPrazoConsulta?: number,
 *   msPrazoAdicao?: number,
 *   msPrazoConvite?: number,
 * }} opcoes
 * @returns {Promise<ResultadoParticipante[]>} na ordem da entrada
 * @throws {ErroGrupo} DESCONECTADA
 * @throws {import("./nomeGrupo").ErroConsultaGrupo} consulta dos participantes
 */
async function adicionarEmSerie(
  adapter,
  chatJid,
  telefones,
  { segundosIntervalo, convite, dormir = dormirPadrao, sinal, msPrazoConsulta, msPrazoAdicao = MS_PRAZO_ADICAO, msPrazoConvite }
) {
  const socket = adapter.socketConectado();
  if (!socket) throw new ErroGrupo("DESCONECTADA");
  // Uma consulta só (cache do nomeGrupo): o `group-participants.update` das adições invalida o cache,
  // e consultar a cada telefone seria um groupMetadata a mais por pessoa.
  const conhecidos = indexarParticipantes(await adapter.obterParticipantesGrupo(chatJid));

  /** @type {ResultadoParticipante[]} */
  const resultados = telefones.map((telefone) => ({ telefone, status: "NAO_PROCESSADO", convite_enviado: false }));
  /** @type {string | null | undefined} */
  let subject;

  for (let i = 0; i < telefones.length; i += 1) {
    if (sinal?.aborted) break;
    const resultado = /** @type {ResultadoParticipante} */ (resultados[i]);
    const telefone = /** @type {string} */ (telefones[i]);
    let houveEnvio = false;
    try {
      const numero = await consultarNumero(socket, telefone, { msPrazo: msPrazoConsulta });
      if (sinal?.aborted) break; // abortado durante a consulta: este telefone fica NAO_PROCESSADO
      if (!numero) {
        resultado.status = "SEM_WHATSAPP";
        continue;
      }
      // O telefone digitado e o real (9º dígito) podem diferir: os dois contam na checagem.
      const identidade = { jid: numero.jid, lid: numero.lid, telefones: [telefone, telefoneDe(numero.jid)] };
      if (conhecidos.tem(identidade)) {
        resultado.status = "JA_PARTICIPA";
        continue;
      }

      houveEnvio = true;
      const respostas = await comPrazo(Promise.resolve().then(() => socket.groupParticipantsUpdate(chatJid, [numero.jid], "add")), msPrazoAdicao);
      const item = Array.isArray(respostas) ? respostas[0] : null;
      const { status, pedidoConvite } = mapearStatusAdicao(item?.status, item?.content);
      resultado.status = status;
      if (status === "ADICIONADO" || status === "JA_PARTICIPA") conhecidos.incluir(identidade);

      if (status === "CONVITE_NECESSARIO" && convite && pedidoConvite && !sinal?.aborted) {
        try {
          if (subject === undefined) subject = (await adapter.obterNomeGrupo?.(chatJid)) ?? null;
          await enviarConviteV4(adapter, numero.jid, { ...pedidoConvite, chatJid, subject, texto: convite.texto }, { msPrazo: msPrazoConvite });
          resultado.convite_enviado = true;
        } catch (erro) {
          console.error(`[GRUPO] Falha ao enviar um convite de grupo: ${codigoDoErro(erro)}`);
        }
      }
    } catch (erro) {
      const codigo = statusDoErro(erro);
      // O IQ de adição também pode falhar por exceção com o código do participante em `data` (403, 408, 409).
      const mapeado = houveEnvio && (codigo === 403 || codigo === 408 || codigo === 409) ? mapearStatusAdicao(codigo, undefined).status : "FALHA";
      resultado.status = mapeado;
      console.error(`[GRUPO] Falha ao processar um telefone da adição: ${codigoDoErro(erro)}`);
      // Limite de envio do WhatsApp (429): continuar só pioraria o risco de banimento do número.
      if (codigo === 429) break;
    }
    // Uma pausa por telefone com IQ; depois do último não há o que espaçar.
    if (houveEnvio && i < telefones.length - 1) await dormir(segundosIntervalo, sinal);
  }
  return resultados;
}

/**
 * Cria o grupo com o PRIMEIRO telefone que tem WhatsApp e adiciona os demais pelo laço da adição. O Baileys
 * 6.7.24 não devolve status por participante no `groupCreate`, então o 1º é conferido pelo `groupMetadata`
 * (presente → ADICIONADO; ausente → CONVITE_NECESSARIO, sem convite). O `groupCreate` NUNCA é repetido
 * (erro ou prazo → ErroGrupo CRIACAO_NAO_CONFIRMADA); depois dele a função não rejeita mais: desligamento,
 * desconectar, remover, falha do `groupMetadata` ou do `add` só mudam os status (FALHA / NAO_PROCESSADO).
 * Se o `groupMetadata` de confirmação falha, o 1º fica FALHA (não há como saber se entrou) e o restante tende a
 * sair NAO_PROCESSADO, porque a falha fica em cache por 60 s e o laço não consegue ler os participantes; o grupo
 * existe e os demais podem ser adicionados depois pela adição (Fase 28). O retorno do `groupCreate` do Baileys
 * 6.7.24 traz `participants`, mas lido do nó de resposta sem o atributo `error` de cada participante, então NÃO
 * serve de confirmação (um convidado recusado poderia aparecer como adicionado).
 * @param {AdapterGrupo} adapter
 * @param {string} nome nome do grupo já validado e aparado
 * @param {string[]} telefones só dígitos, com DDI
 * @param {{
 *   segundosIntervalo: number,
 *   convite?: { texto: string } | null,
 *   dormir?: (segundos: number, sinal?: AbortSignal) => Promise<void>,
 *   sinal?: AbortSignal,
 *   msPrazoConsulta?: number,
 *   msPrazoCriacao?: number,
 *   msPrazoAdicao?: number,
 *   msPrazoConvite?: number,
 * }} opcoes
 * @returns {Promise<{ chat_jid: string, nome_grupo: string, participantes: ResultadoParticipante[] }>}
 * @throws {ErroGrupo} DESCONECTADA (sem conexão, ou abortada antes de criar), SEM_PARTICIPANTE_VALIDO, CRIACAO_NAO_CONFIRMADA
 */
async function criarGrupo(adapter, nome, telefones, opcoes) {
  const { segundosIntervalo, convite, dormir = dormirPadrao, sinal, msPrazoConsulta, msPrazoCriacao = MS_PRAZO_CRIACAO } = opcoes;
  const socket = adapter.socketConectado();
  if (!socket) throw new ErroGrupo("DESCONECTADA");

  /** @type {ResultadoParticipante[]} */
  const resultados = telefones.map((telefone) => ({ telefone, status: "NAO_PROCESSADO", convite_enviado: false }));
  // 1) onWhatsApp em série até achar o primeiro número com WhatsApp.
  let indicePrimeiro = -1;
  /** @type {NumeroResolvido | null} */
  let primeiro = null;
  for (let i = 0; i < telefones.length && !primeiro; i += 1) {
    if (sinal?.aborted) break;
    const resultado = /** @type {ResultadoParticipante} */ (resultados[i]);
    try {
      const numero = await consultarNumero(socket, /** @type {string} */ (telefones[i]), { msPrazo: msPrazoConsulta });
      if (numero) {
        primeiro = numero;
        indicePrimeiro = i;
      } else {
        resultado.status = "SEM_WHATSAPP";
      }
    } catch (erro) {
      resultado.status = "FALHA";
      console.error(`[GRUPO] Falha ao consultar um telefone da criação: ${codigoDoErro(erro)}`);
    }
  }
  // Abortada antes de criar: nada foi criado, então não há o que devolver como sucesso.
  if (sinal?.aborted) throw new ErroGrupo("DESCONECTADA");
  if (!primeiro) throw new ErroGrupo("SEM_PARTICIPANTE_VALIDO", resultados);

  // 2) groupCreate: uma única vez, com um único participante.
  /** @type {string} */
  let chatJid;
  try {
    const criado = await comPrazo(Promise.resolve().then(() => socket.groupCreate(nome, [primeiro.jid])), msPrazoCriacao);
    const id = normalizarJid(criado?.id);
    if (!id || !PADRAO_GRUPO.test(id)) throw new Error("Resposta sem o id do grupo.");
    chatJid = id;
  } catch (erro) {
    console.error(`[GRUPO] Criação do grupo não confirmada: ${codigoDoErro(erro)}`);
    throw new ErroGrupo("CRIACAO_NAO_CONFIRMADA");
  }

  // 3) Daqui em diante, sempre sucesso: o grupo existe. O nome entra no cache (e os participantes são
  // invalidados) agora e de novo no fim: uma falha do `groupMetadata` no meio guardaria o grupo sem nome.
  const ensinarNome = () => {
    try {
      adapter.aprenderGrupo?.([{ id: chatJid, subject: nome }]);
    } catch {
      // o cache do nome nunca derruba a criação
    }
  };
  ensinarNome();
  const primeiroResultado = /** @type {ResultadoParticipante} */ (resultados[indicePrimeiro]);
  primeiroResultado.status = "FALHA";
  try {
    const participantes = await adapter.obterParticipantesGrupo(chatJid);
    const noGrupo = indexarParticipantes(participantes).tem({ jid: primeiro.jid, lid: primeiro.lid, telefones: [telefones[indicePrimeiro], telefoneDe(primeiro.jid)] });
    primeiroResultado.status = noGrupo ? "ADICIONADO" : "CONVITE_NECESSARIO";
  } catch (erro) {
    console.error(`[GRUPO] Falha ao confirmar o primeiro participante do grupo criado: ${codigoDoErro(erro)}`);
  }

  const restantes = telefones.slice(indicePrimeiro + 1);
  if (restantes.length > 0 && !sinal?.aborted) {
    await dormir(segundosIntervalo, sinal); // o groupCreate conta como o IQ do 1º telefone
    if (!sinal?.aborted) {
      try {
        const demais = await adicionarEmSerie(adapter, chatJid, restantes, { ...opcoes, convite, dormir });
        demais.forEach((resultado, k) => {
          resultados[indicePrimeiro + 1 + k] = resultado;
        });
      } catch (erro) {
        console.error(`[GRUPO] Falha ao adicionar os demais participantes do grupo criado: ${codigoDoErro(erro)}`);
      }
    }
  }
  ensinarNome();
  return { chat_jid: chatJid, nome_grupo: nome, participantes: resultados };
}

module.exports = {
  criarGrupo,
  consultarNumero,
  mapearStatusAdicao,
  adicionarEmSerie,
  enviarConviteV4,
  dormirPadrao,
  ErroGrupo,
  MS_PRAZO_CONSULTA_NUMERO,
  MS_PRAZO_ENVIO_CONVITE,
  MS_PRAZO_ADICAO,
  MS_PRAZO_CRIACAO,
};
