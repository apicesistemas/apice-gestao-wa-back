// @ts-check
// Participantes de um grupo (Task 17.1), para o livechat montar as menções do atendente. Só o back
// chama (token de serviço em `X-Internal-Token`), e a rota não tem efeito no WhatsApp: só lê o
// `groupMetadata` (cache da equipe, consulta única por grupo, prazo curto).
//
// Canal D — `POST /equipe/:cod_equipe/grupo/participantes` (o JID do grupo vai no corpo, não na URL)
// Entrada JSON: { hash_empresa: string, chat_jid: string /^[\d-]{1,40}@g\.us$/ }
// 200 { participantes: [{ jid, lid, telefone, admin }] }: `jid` é o `id` do participante no
//   endereçamento do grupo (LID ou telefone), o que vai em `mentionedJid`; sem o número da própria
//   equipe e sem nome.
// Erros (sempre `{ msg }`):
//   400 "Informe o hash_empresa da equipe." | "Grupo inválido." | "Código da equipe inválido."
//   401 sem token · 404 "Equipe não encontrada." (outro tenant) · 404 "Grupo não encontrado." (número fora do grupo)
//   409 "O WhatsApp da equipe não está conectado." · 503 + Retry-After (desligamento)
//   504 "A consulta dos participantes não respondeu." · 502 "Não foi possível consultar os participantes."
// O log leva só o `cod_equipe` e o código do erro, nunca JID, LID ou telefone.
//
// Adição de participantes (Fase 28, Task 28.1), contrato D1:
// Canal D — `POST /equipe/:cod_equipe/grupo/participantes/adicionar` (token de serviço + 503 no desligamento)
// Entrada JSON (allowlist; chave desconhecida, inclusive transcricao, nota_interna e explicacao, → 400 sem tocar o Baileys):
//   { hash_empresa: string, chat_jid: /^[\d-]{1,40}@g\.us$/, telefones: string[] (/^55\d{10,11}$/, 1..50),
//     segundos_intervalo: inteiro >= 0, convite?: { texto: string 1..500 } }   (sem convite = não convida)
// Fluxo: equipeOcupada (conectar/desconectar/remover) ou trava de grupo ocupada → 409 OCUPADA → socket conectado →
//   a equipe está no grupo e é admin (ou memberAddMode) → por telefone, em série: onWhatsApp (ausente → SEM_WHATSAPP);
//   já no grupo → JA_PARTICIPA; senão um IQ de adição com o jid do onWhatsApp; 403 com add_request e `convite` →
//   convite v4 em mensagem privada (marcado como enviado pelo CRM); UMA pausa de `segundos_intervalo` por telefone
//   com IQ (o convite sai junto com a adição daquele telefone, na mesma pausa), nenhuma depois do último.
//   Desconectar, remover, desligamento ou o back fechar a conexão antes da resposta interrompem o laço: o telefone
//   em andamento (se ainda sem IQ) e o restante saem NAO_PROCESSADO. Um IQ já enviado não é cancelado: no
//   desligamento o back recebe a conexão interrompida e trata como "não confirmada".
// 200 { participantes: [{ telefone, status, convite_enviado }] } na ordem da entrada;
//   status: ADICIONADO | JA_PARTICIPA | CONVITE_NECESSARIO | SAIU_RECENTEMENTE | SEM_WHATSAPP | FALHA | NAO_PROCESSADO
// Erros: 400 { msg } · 401 · 404 "Equipe não encontrada." | "Grupo não encontrado."
//   409 { msg, codigo: "DESCONECTADA" | "NAO_ADMIN" | "OCUPADA" } · 502 · 503 + Retry-After
//   504 "A consulta dos participantes não respondeu." · 500 sem vazar o erro.
// Nenhum efeito no CRM. O log leva só `cod_equipe`, contagens e códigos.
//
// Criação de grupo (Fase 29, Task 29.1), contrato D2:
// Canal D — `POST /equipe/:cod_equipe/grupo/criar` (token de serviço + 503 no desligamento; a mesma trava de grupo da adição)
// Entrada JSON (allowlist): { hash_empresa, nome_grupo: string 1..100 UTF-16 (aparado; sem quebra de linha, caractere de controle
//   ou só espaços invisíveis: 400 "Informe o nome do grupo com até 100 caracteres, sem quebra de linha."), telefones: string[] (/^55\d{10,11}$/, 1..50),
//   segundos_intervalo: inteiro >= 0, convite?: { texto: string 1..500 } }
// Fluxo: a mesma trava → onWhatsApp em série até o 1º número com WhatsApp (nenhum → 409 SEM_PARTICIPANTE_VALIDO com os
//   status, sem criar) → groupCreate UMA vez com o nome e esse único jid (erro ou prazo → 504 "Criação do grupo não
//   confirmada.", nunca repete) → o nome entra no cache → groupMetadata confere o 1º (ADICIONADO | CONVITE_NECESSARIO,
//   sem convite) → os demais pelo laço da adição (mesmo ritmo, aborto, 429 e convite). Depois do groupCreate
//   bem-sucedido a resposta é sempre 200, mesmo com falha posterior, desligamento, desconectar, remover ou o back
//   fechando a conexão (FALHA / NAO_PROCESSADO nos status). Desligamento gracioso ANTES do groupCreate: 503 + Retry-After
//   (nada criado); desconectar/remover antes do groupCreate: 409 DESCONECTADA.
// 200 { chat_jid, nome_grupo, participantes: [{ telefone, status, convite_enviado }] }
// Erros: 400 · 401 · 404 "Equipe não encontrada." · 409 { msg, codigo: "DESCONECTADA" | "OCUPADA" | "SEM_PARTICIPANTE_VALIDO"
//   (com `participantes`) } · 502 · 503 + Retry-After · 504 "Criação do grupo não confirmada." · 500 sem vazar o erro.
// O log leva só `cod_equipe`, contagens e códigos: nunca telefone, JID, LID nem o nome do grupo.
//
// Identificação do participante para a conversa privada (Fase 32, Task 32.1), contrato D1:
// Canal D — `POST /equipe/:cod_equipe/grupo/participante/contato` (token de serviço + 503 no desligamento; SEM trava de
// grupo, porque não altera o grupo)
// Entrada JSON (allowlist; chave desconhecida, inclusive transcricao, nota_interna e explicacao, → 400 sem tocar o Baileys):
//   { hash_empresa: string, chat_jid: /^[\d-]{1,40}@g\.us$/, participante_jid: /^(\d{1,25}@lid|\d{8,15}@s\.whatsapp\.net)$/ }
// Fluxo: socket da equipe (404 tenant, 409 desconectada) → participantes pelo cache do nomeGrupo (equipe fora do grupo → 404
//   "Grupo não encontrado.") → participante achado por jid, LID ou telefone (o número da equipe → 400 PROPRIO_NUMERO; ausente
//   → 409 FORA_DO_GRUPO) → telefone = p.telefone ?? par do LID no resolvedor → com telefone: UM onWhatsApp (sem WhatsApp → 409
//   SEM_WHATSAPP); jid_privado = o jid DEVOLVIDO (9º dígito), lid = p.lid ?? o da consulta, e o par é aprendido; sem telefone:
//   jid_privado = o LID, telefone null, sem consulta.
// 200 { jid_privado: string, lid: string | null, telefone: string | null }
// Erros: 400 { msg } · 400 { msg, codigo: "PROPRIO_NUMERO" } · 401 · 404 "Equipe não encontrada." | "Grupo não encontrado." ·
//   409 { msg, codigo: "DESCONECTADA" | "FORA_DO_GRUPO" | "SEM_WHATSAPP" } · 502 · 503 + Retry-After ·
//   504 "A consulta do participante não respondeu." · 500 sem vazar o erro.
// Nenhum sendMessage e nada em /interno/*. O log leva só `cod_equipe` e o código: nunca telefone, JID nem LID.
const exigirTokenServico = require("./exigirTokenServico");
const { ErroEnvio, obterSocketDaEquipe } = require("../whatsapp/envio");
const { normalizarCodEquipe } = require("../whatsapp/BaileysAdapter");
const { ehProprio } = require("../whatsapp/mencoesEntrada");
const { ErroConsultaGrupo } = require("../whatsapp/nomeGrupo");
const { ErroGrupo } = require("../whatsapp/grupoGestao");
const travaGrupoDoProcesso = require("../whatsapp/travaGrupo").padrao;
const { padrao: desligamentoDoProcesso, MSG_REINICIANDO, SEGUNDOS_RETRY_AFTER } = require("../utils/desligamento");

const PADRAO_GRUPO = /^[\d-]{1,40}@g\.us$/;
/** Telefone BR com DDI: 55 + DDD + número (10 ou 11 dígitos). */
const PADRAO_TELEFONE = /^55\d{10,11}$/;
/** Limites técnicos do contrato D1 (o limite por pedido da regra de negócio é validado pelo back). */
const MAX_TELEFONES = 50;
const MAX_TEXTO_CONVITE = 500;
/** Chaves aceitas no corpo da adição; qualquer outra (inclusive campo interno) é 400. */
const ALLOWLIST_ADICAO = new Set(["hash_empresa", "chat_jid", "telefones", "segundos_intervalo", "convite"]);
const MAX_NOME_GRUPO = 100;
/** Mesmo texto no back e no front: nome vazio, longo ou com quebra de linha/caractere de controle. */
const MSG_NOME_GRUPO = `Informe o nome do grupo com até ${MAX_NOME_GRUPO} caracteres, sem quebra de linha.`;
const PADRAO_CONTROLE = /[\u0000-\u001F\u007F]/;
const PADRAO_INVISIVEIS = /[\u200B-\u200D\uFEFF]/g;
const ALLOWLIST_CRIACAO = new Set(["hash_empresa", "nome_grupo", "telefones", "segundos_intervalo", "convite"]);
/** Chaves aceitas no corpo da identificação do participante (D1); qualquer outra (inclusive campo interno) é 400. */
const ALLOWLIST_CONTATO = new Set(["hash_empresa", "chat_jid", "participante_jid"]);
const PADRAO_PARTICIPANTE = /^(\d{1,25}@lid|\d{8,15}@s\.whatsapp\.net)$/;
/** Respostas da consulta do grupo e do número na identificação do participante (D1). */
/** @type {Record<import("../whatsapp/nomeGrupo").CodigoErroGrupo, { status: number, msg: string }>} */
const RESPOSTA_DO_ERRO_CONTATO = {
  GRUPO_NAO_ENCONTRADO: { status: 404, msg: "Grupo não encontrado." },
  PRAZO_ESGOTADO: { status: 504, msg: "A consulta do participante não respondeu." },
  FALHA: { status: 502, msg: "Não foi possível consultar o participante." },
};
const MSG_OCUPADA = "Outra alteração de grupo desta equipe está em andamento.";

/** @type {Record<import("../whatsapp/envio").CodigoErroEnvio, number>} */
const STATUS_DO_ERRO = {
  CONTEUDO_INVALIDO: 400,
  EQUIPE_NAO_ENCONTRADA: 404,
  EQUIPE_DESCONECTADA: 409,
  FALHA_ENVIO: 502,
  ENVIO_NAO_CONFIRMADO: 504,
};

/** @type {Record<import("../whatsapp/nomeGrupo").CodigoErroGrupo, { status: number, msg: string }>} */
const RESPOSTA_DO_ERRO_GRUPO = {
  GRUPO_NAO_ENCONTRADO: { status: 404, msg: "Grupo não encontrado." },
  PRAZO_ESGOTADO: { status: 504, msg: "A consulta dos participantes não respondeu." },
  FALHA: { status: 502, msg: "Não foi possível consultar os participantes." },
};

class ErroRequisicao extends Error {}

/** @typedef {import("../whatsapp/envio").ManagerEnvio & { equipeOcupada?: (codEquipe: string | number) => boolean }} ManagerGrupo */

/**
 * Valida a lista de telefones, o intervalo e o convite (comuns à adição e à criação).
 * @param {Record<string, unknown>} c
 * @returns {{ telefones: string[], segundosIntervalo: number, convite: { texto: string } | null }}
 * @throws {ErroRequisicao}
 */
function validarRitmo(c) {
  const telefones = c.telefones;
  if (!Array.isArray(telefones) || telefones.length < 1 || telefones.length > MAX_TELEFONES) {
    throw new ErroRequisicao(`Informe de 1 a ${MAX_TELEFONES} telefones.`);
  }
  if (!telefones.every((t) => typeof t === "string" && PADRAO_TELEFONE.test(t))) {
    throw new ErroRequisicao("Telefone inválido: confira o DDD e o número.");
  }
  const segundos = c.segundos_intervalo;
  if (typeof segundos !== "number" || !Number.isSafeInteger(segundos) || segundos < 0) {
    throw new ErroRequisicao("Informe o intervalo entre as adições, em segundos.");
  }
  /** @type {{ texto: string } | null} */
  let convite = null;
  if (c.convite !== undefined) {
    const v = c.convite;
    const chaves = v && typeof v === "object" && !Array.isArray(v) ? Object.keys(v) : [];
    const texto = /** @type {{ texto?: unknown }} */ (v)?.texto;
    if (chaves.length !== 1 || chaves[0] !== "texto" || typeof texto !== "string" || texto.length < 1 || texto.length > MAX_TEXTO_CONVITE) {
      throw new ErroRequisicao("Convite inválido.");
    }
    convite = { texto };
  }
  return { telefones: /** @type {string[]} */ (telefones), segundosIntervalo: segundos, convite };
}

/**
 * @param {unknown} corpo
 * @param {Set<string>} allowlist
 * @param {string} rotulo
 * @returns {Record<string, unknown>}
 * @throws {ErroRequisicao}
 */
function lerCorpoPermitido(corpo, allowlist, rotulo) {
  if (!corpo || typeof corpo !== "object" || Array.isArray(corpo)) throw new ErroRequisicao("Corpo da requisição inválido.");
  const c = /** @type {Record<string, unknown>} */ (corpo);
  for (const nome of Object.keys(c)) {
    if (!allowlist.has(nome)) throw new ErroRequisicao(`Campo não permitido ${rotulo}: ${nome.slice(0, 40)}.`);
  }
  return c;
}

/**
 * Valida o corpo da adição contra a allowlist do contrato D1.
 * @param {unknown} corpo
 * @returns {{ hash_empresa: unknown, chat_jid: string, telefones: string[], segundosIntervalo: number, convite: { texto: string } | null }}
 * @throws {ErroRequisicao}
 */
function validarCorpoAdicao(corpo) {
  const c = lerCorpoPermitido(corpo, ALLOWLIST_ADICAO, "na adição");
  if (typeof c.chat_jid !== "string" || !PADRAO_GRUPO.test(c.chat_jid)) throw new ErroRequisicao("Grupo inválido.");
  return { hash_empresa: c.hash_empresa, chat_jid: c.chat_jid, ...validarRitmo(c) };
}

/**
 * Valida o corpo da criação contra a allowlist do contrato D2.
 * @param {unknown} corpo
 * @returns {{ hash_empresa: unknown, nome_grupo: string, telefones: string[], segundosIntervalo: number, convite: { texto: string } | null }}
 * @throws {ErroRequisicao}
 */
function validarCorpoCriacao(corpo) {
  const c = lerCorpoPermitido(corpo, ALLOWLIST_CRIACAO, "na criação");
  const bruto = typeof c.nome_grupo === "string" ? c.nome_grupo : "";
  const nome = bruto.trim();
  // Limite em unidades UTF-16 (`length`); quebra de linha e controle recusados; invisíveis sozinhos contam como vazio.
  if (nome.length < 1 || nome.length > MAX_NOME_GRUPO || PADRAO_CONTROLE.test(bruto) || nome.replace(PADRAO_INVISIVEIS, "").trim() === "") {
    throw new ErroRequisicao(MSG_NOME_GRUPO);
  }
  return { hash_empresa: c.hash_empresa, nome_grupo: nome, ...validarRitmo(c) };
}

/**
 * Valida o corpo da identificação do participante contra a allowlist do contrato D1.
 * @param {unknown} corpo
 * @returns {{ hash_empresa: unknown, chat_jid: string, participante_jid: string }}
 * @throws {ErroRequisicao}
 */
function validarCorpoContato(corpo) {
  const c = lerCorpoPermitido(corpo, ALLOWLIST_CONTATO, "na identificação do participante");
  if (typeof c.chat_jid !== "string" || !PADRAO_GRUPO.test(c.chat_jid)) throw new ErroRequisicao("Grupo inválido.");
  if (typeof c.participante_jid !== "string" || !PADRAO_PARTICIPANTE.test(c.participante_jid)) throw new ErroRequisicao("Participante inválido.");
  return { hash_empresa: c.hash_empresa, chat_jid: c.chat_jid, participante_jid: c.participante_jid };
}

/**
 * Erro de negócio da operação de grupo: PROPRIO_NUMERO é 400; os demais códigos são 409 com `codigo`.
 * @param {import("express").Response} res
 * @param {InstanceType<typeof ErroGrupo>} erro
 */
function responderErroGrupo(res, erro) {
  if (erro.codigo === "PROPRIO_NUMERO") res.status(400).json({ msg: erro.message, codigo: erro.codigo });
  else responder409(res, erro.codigo, erro.message);
}

/**
 * @param {import("express").Response} res
 * @param {"DESCONECTADA" | "NAO_ADMIN" | "OCUPADA" | "CRIACAO_NAO_CONFIRMADA" | "SEM_PARTICIPANTE_VALIDO" | "FORA_DO_GRUPO" | "SEM_WHATSAPP"} codigo
 * @param {string} msg
 */
const responder409 = (res, codigo, msg) => void res.status(409).json({ msg, codigo });

/**
 * @param {import("../whatsapp/envio").ManagerEnvio} [manager]
 * @param {{
 *   desligamento?: Pick<import("../utils/desligamento").Desligamento, "recusarDuranteEncerramento"> & Partial<Pick<import("../utils/desligamento").Desligamento, "aoIniciarEncerramento" | "estaEncerrando">>,
 *   travaGrupo?: import("../whatsapp/travaGrupo").TravaGrupo,
 *   dormir?: (segundos: number, sinal?: AbortSignal) => Promise<void>,
 *   msPrazoCriacao?: number,
 *   msPrazoConsulta?: number,
 * }} [opcoes] estado de desligamento, trava das operações de grupo, relógio da pausa entre adições e prazos técnicos do groupCreate e da consulta do número (os testes injetam)
 * @returns {(server: import("express").Express) => void}
 */
function criarGrupoController(manager, { desligamento = desligamentoDoProcesso, travaGrupo = travaGrupoDoProcesso, dormir, msPrazoCriacao, msPrazoConsulta } = {}) {
  // Desligamento: a pausa entre as adições para na hora e o restante sai NAO_PROCESSADO, dentro do teto.
  desligamento.aoIniciarEncerramento?.(() => travaGrupo.abortarTodas());
  /** @returns {ManagerGrupo} */
  const obterManager = () => manager ?? /** @type {ManagerGrupo} */ (/** @type {unknown} */ (require("../whatsapp/instanciaManager")));
  /** @type {import("express").RequestHandler} */
  const recusarDuranteEncerramento = (req, res, next) => desligamento.recusarDuranteEncerramento(req, res, next);

  return function GrupoController(server) {
    server.post("/equipe/:cod_equipe/grupo/participantes", exigirTokenServico, recusarDuranteEncerramento, async (req, res) => {
      let cod;
      try {
        cod = normalizarCodEquipe(/** @type {string} */ (req.params.cod_equipe));
      } catch {
        res.status(400).json({ msg: "Código da equipe inválido." });
        return;
      }
      try {
        const corpo = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
        // O grupo inválido é 400 mesmo com a equipe desconectada (nunca 409).
        if (typeof corpo.chat_jid !== "string" || !PADRAO_GRUPO.test(corpo.chat_jid)) {
          res.status(400).json({ msg: "Grupo inválido." });
          return;
        }
        const { adapter, socket } = obterSocketDaEquipe(obterManager(), cod, corpo.hash_empresa);
        const consultar = /** @type {{ obterParticipantesGrupo?: (chatJid: string) => Promise<import("../whatsapp/nomeGrupo").ParticipanteGrupo[]> }} */ (adapter).obterParticipantesGrupo;
        if (typeof consultar !== "function") throw new ErroConsultaGrupo("FALHA");
        const todos = await consultar.call(adapter, corpo.chat_jid);
        const participantes = todos.filter((p) => !ehProprio(p, { jid: socket.user?.id, lid: socket.user?.lid })).map(({ jid, lid, telefone, admin }) => ({ jid, lid, telefone, admin }));
        res.status(200).json({ participantes });
      } catch (erro) {
        if (erro instanceof ErroEnvio) {
          res.status(STATUS_DO_ERRO[erro.codigo] ?? 500).json({ msg: erro.message });
          return;
        }
        if (erro instanceof ErroConsultaGrupo) {
          const { status, msg } = RESPOSTA_DO_ERRO_GRUPO[erro.codigo];
          console.error(`[GRUPO] Consulta de participantes da equipe ${cod} falhou: ${erro.codigo}`);
          res.status(status).json({ msg });
          return;
        }
        console.error(`[GRUPO] Erro inesperado na consulta de participantes da equipe ${cod}:`, erro instanceof Error ? erro.name : "erro");
        res.status(500).json({ msg: "Erro interno ao consultar os participantes." });
      }
    });

    server.post("/equipe/:cod_equipe/grupo/participante/contato", exigirTokenServico, recusarDuranteEncerramento, async (req, res) => {
      let cod;
      try {
        cod = normalizarCodEquipe(/** @type {string} */ (req.params.cod_equipe));
      } catch {
        res.status(400).json({ msg: "Código da equipe inválido." });
        return;
      }
      try {
        const dados = validarCorpoContato(req.body);
        const { adapter } = obterSocketDaEquipe(obterManager(), cod, dados.hash_empresa);
        const resolver = /** @type {{ resolverContatoParticipante?: import("../whatsapp/BaileysAdapter").BaileysAdapter["resolverContatoParticipante"] }} */ (adapter).resolverContatoParticipante;
        if (typeof resolver !== "function") throw new ErroConsultaGrupo("FALHA");
        const contato = await resolver.call(adapter, dados.chat_jid, dados.participante_jid, { msPrazoConsulta });
        res.status(200).json(contato);
      } catch (erro) {
        if (erro instanceof ErroRequisicao) {
          res.status(400).json({ msg: erro.message });
          return;
        }
        if (erro instanceof ErroGrupo) {
          responderErroGrupo(res, erro);
          return;
        }
        if (erro instanceof ErroEnvio) {
          if (erro.codigo === "EQUIPE_DESCONECTADA") responder409(res, "DESCONECTADA", erro.message);
          else res.status(STATUS_DO_ERRO[erro.codigo] ?? 500).json({ msg: erro.message });
          return;
        }
        if (erro instanceof ErroConsultaGrupo) {
          const { status, msg } = RESPOSTA_DO_ERRO_CONTATO[erro.codigo];
          console.error(`[GRUPO] Identificação de participante da equipe ${cod} falhou: ${erro.codigo}`);
          res.status(status).json({ msg });
          return;
        }
        console.error(`[GRUPO] Erro inesperado na identificação de participante da equipe ${cod}:`, erro instanceof Error ? erro.name : "erro");
        res.status(500).json({ msg: "Erro interno ao identificar o participante." });
      }
    });

    /**
     * Rota de operação de grupo com trava (adição e criação): token, 503, validação (400), tenant (404), equipe
     * ocupada (409 OCUPADA), desconectada (409), trava de grupo, aborto se o back fechar a conexão e a mesma
     * tabela de erros.
     * @template {{ hash_empresa: unknown }} D
     * @param {string} caminho
     * @param {{
     *   rotulo: string,
     *   validar: (corpo: unknown) => D,
     *   executar: (adapter: any, dados: D, sinal: AbortSignal) => Promise<{ corpo: any, participantes: { status: string }[] }>,
     *   msgErro500: string,
     * }} def
     */
    function operacaoDeGrupo(caminho, { rotulo, validar, executar, msgErro500 }) {
      server.post(caminho, exigirTokenServico, recusarDuranteEncerramento, async (req, res) => {
        let cod;
        try {
          cod = normalizarCodEquipe(/** @type {string} */ (req.params.cod_equipe));
        } catch {
          res.status(400).json({ msg: "Código da equipe inválido." });
          return;
        }
        /** @type {AbortSignal | null} */
        let sinal = null;
        let emOperacao = true;
        try {
          const dados = validar(req.body);
          const gerente = obterManager();
          /** @type {ReturnType<typeof obterSocketDaEquipe> | null} */
          let achado = null;
          /** @type {InstanceType<typeof ErroEnvio> | null} */
          let desconectada = null;
          try {
            achado = obterSocketDaEquipe(gerente, cod, dados.hash_empresa);
          } catch (erro) {
            // O tenant e o corpo vêm antes (400/404); a equipe ocupada vem antes da desconectada.
            if (erro instanceof ErroEnvio && erro.codigo === "EQUIPE_DESCONECTADA") desconectada = erro;
            else throw erro;
          }
          if (gerente.equipeOcupada?.(cod) || travaGrupo.ocupada(cod)) {
            responder409(res, "OCUPADA", MSG_OCUPADA);
            return;
          }
          if (!achado) throw desconectada ?? new ErroGrupo("DESCONECTADA");
          sinal = travaGrupo.entrar(cod);
          if (!sinal) {
            responder409(res, "OCUPADA", MSG_OCUPADA);
            return;
          }
          // O back desistiu (prazo esgotado, conexão fechada) antes da resposta: o laço para, para não
          // continuar mexendo no grupo sem que o back saiba. A trava cai no `finally`.
          res.once("close", () => {
            if (emOperacao && !res.writableFinished) travaGrupo.abortar(cod);
          });
          const { corpo, participantes } = await executar(achado.adapter, dados, sinal);
          /** @type {Record<string, number>} */
          const contagens = {};
          for (const p of participantes) contagens[p.status] = (contagens[p.status] ?? 0) + 1;
          console.log(`[GRUPO] ${rotulo} da equipe ${cod}: ${participantes.length} telefone(s), ${JSON.stringify(contagens)}.`);
          res.status(200).json(corpo);
        } catch (erro) {
          if (erro instanceof ErroRequisicao) {
            res.status(400).json({ msg: erro.message });
            return;
          }
          if (erro instanceof ErroGrupo) {
            if (erro.codigo === "CRIACAO_NAO_CONFIRMADA") {
              res.status(504).json({ msg: erro.message });
            } else if (erro.codigo === "SEM_PARTICIPANTE_VALIDO") {
              res.status(409).json({ msg: erro.message, codigo: erro.codigo, participantes: erro.participantes ?? [] });
            } else if (erro.codigo === "DESCONECTADA" && desligamento.estaEncerrando?.()) {
              // Abortada pelo desligamento gracioso antes de criar: nada foi criado, o back tenta de novo depois.
              res.set("Retry-After", String(SEGUNDOS_RETRY_AFTER)).status(503).json({ msg: MSG_REINICIANDO });
            } else {
              responderErroGrupo(res, erro);
            }
            return;
          }
          if (erro instanceof ErroEnvio) {
            if (erro.codigo === "EQUIPE_DESCONECTADA") responder409(res, "DESCONECTADA", erro.message);
            else res.status(STATUS_DO_ERRO[erro.codigo] ?? 500).json({ msg: erro.message });
            return;
          }
          if (erro instanceof ErroConsultaGrupo) {
            const { status, msg } = RESPOSTA_DO_ERRO_GRUPO[erro.codigo];
            console.error(`[GRUPO] ${rotulo} da equipe ${cod} falhou: ${erro.codigo}`);
            res.status(status).json({ msg });
            return;
          }
          console.error(`[GRUPO] Erro inesperado: ${rotulo} da equipe ${cod}:`, erro instanceof Error ? erro.name : "erro");
          res.status(500).json({ msg: msgErro500 });
        } finally {
          emOperacao = false;
          if (sinal) travaGrupo.sair(cod, sinal);
        }
      });
    }

    operacaoDeGrupo("/equipe/:cod_equipe/grupo/participantes/adicionar", {
      rotulo: "Adição de participantes",
      validar: validarCorpoAdicao,
      msgErro500: "Erro interno ao adicionar os participantes.",
      async executar(adapter, dados, sinal) {
        const adicionar = /** @type {{ adicionarParticipantesGrupo?: import("../whatsapp/BaileysAdapter").BaileysAdapter["adicionarParticipantesGrupo"] }} */ (adapter).adicionarParticipantesGrupo;
        if (typeof adicionar !== "function") throw new ErroConsultaGrupo("FALHA");
        const participantes = await adicionar.call(adapter, dados.chat_jid, {
          telefones: dados.telefones,
          segundosIntervalo: dados.segundosIntervalo,
          convite: dados.convite,
          dormir,
          sinal,
        });
        return { corpo: { participantes }, participantes };
      },
    });

    operacaoDeGrupo("/equipe/:cod_equipe/grupo/criar", {
      rotulo: "Criação de grupo",
      validar: validarCorpoCriacao,
      msgErro500: "Erro interno ao criar o grupo.",
      async executar(adapter, dados, sinal) {
        const criar = /** @type {{ criarGrupo?: import("../whatsapp/BaileysAdapter").BaileysAdapter["criarGrupo"] }} */ (adapter).criarGrupo;
        if (typeof criar !== "function") throw new ErroConsultaGrupo("FALHA");
        const criado = await criar.call(adapter, dados.nome_grupo, {
          telefones: dados.telefones,
          segundosIntervalo: dados.segundosIntervalo,
          convite: dados.convite,
          dormir,
          sinal,
          msPrazoCriacao,
        });
        return { corpo: criado, participantes: criado.participantes };
      },
    });
  };
}

const GrupoController = criarGrupoController();

module.exports = Object.assign(GrupoController, { criarGrupoController, ALLOWLIST_ADICAO, ALLOWLIST_CRIACAO, ALLOWLIST_CONTATO });
