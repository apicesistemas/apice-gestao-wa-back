// @ts-check
// Envio do atendente (Task 7.2). Só o back chama estas rotas (token de serviço em `X-Internal-Token`,
// conferido ANTES de ler o corpo), uma mensagem por requisição (nada de envio em massa):
//
// - `POST /equipe/:cod_equipe/enviar` (multipart/form-data): campos `hash_empresa`, `chat_jid`,
//   `tipo` (TEXTO | IMAGEM | VIDEO | AUDIO | DOCUMENTO), `texto` (TEXTO), `legenda` (IMAGEM, VIDEO,
//   DOCUMENTO), `nome_arquivo` (DOCUMENTO), `ptt` ("true" | "false", AUDIO), `citacao` (JSON
//   `{ key, message }`) e `mencoes` (JSON array de JIDs), e o arquivo no campo `midia`;
// - `POST /equipe/:cod_equipe/reagir` (JSON): `{ hash_empresa, chat_jid, key, emoji }`.
//
// O contrato aceita SÓ o conteúdo destinado ao cliente: é uma allowlist, e qualquer outro campo
// (transcrição, nota interna, explicação da resolução ou o que for) responde 400 sem tocar o
// Baileys. A mídia é validada pelo conteúdo (magic bytes) e pelo teto do ambiente, tudo em memória.
//
// Respostas: 200 `{ mensagem_wa_id, key, timestamp_wa, status: "ENVIADA" }` (reagir: `{ status }`);
// 400 campo inválido, fora da allowlist ou tipo divergente; 401 sem token; 404 equipe de outra
// empresa; 409 equipe desconectada ou sem instância (nunca 200); 502 falha no `sendMessage`;
// 503 durante o desligamento gracioso (o pedido é recusado, nunca aceito e descartado: o back pode
// tentar de novo depois do Retry-After); 504 "Envio não confirmado." quando o `sendMessage` passa do
// prazo (a mensagem pode ter saído).
const express = require("express");
const exigirTokenServico = require("./exigirTokenServico");
const { criarEnvio, ErroEnvio, EXTENSAO_DOCUMENTO } = require("../whatsapp/envio");
const { criarReacao } = require("../whatsapp/reacao");
const { normalizarCodEquipe } = require("../whatsapp/BaileysAdapter");
const { validarMidia } = require("../whatsapp/tipoMidia");
const { obterLimitesMidia } = require("../whatsapp/midiaEntrada");
const desligamentoDoProcesso = require("../utils/desligamento").padrao;

/** Folga do corpo multipart além do teto do arquivo (campos de texto, citação e boundaries). */
const MARGEM_CORPO_BYTES = 1024 * 1024;

/** @typedef {"TEXTO" | "IMAGEM" | "VIDEO" | "AUDIO" | "DOCUMENTO"} TipoEnvio */

/** Campos aceitos em qualquer tipo. */
const CAMPOS_COMUNS = ["hash_empresa", "chat_jid", "tipo", "citacao", "mencoes"];
/** Campos próprios de cada tipo (o resto da allowlist). */
/** @type {Record<TipoEnvio, string[]>} */
const CAMPOS_DO_TIPO = {
  TEXTO: ["texto"],
  IMAGEM: ["legenda", "midia"],
  VIDEO: ["legenda", "midia"],
  AUDIO: ["ptt", "midia"],
  DOCUMENTO: ["legenda", "nome_arquivo", "midia"],
};
const ALLOWLIST_ENVIO = new Set([...CAMPOS_COMUNS, ...Object.values(CAMPOS_DO_TIPO).flat()]);
const ALLOWLIST_REACAO = new Set(["hash_empresa", "chat_jid", "key", "emoji"]);

/** Tipos de conteúdo (detectados pelos magic bytes) aceitos em cada tipo de envio. */
/** @type {Record<Exclude<TipoEnvio, "TEXTO">, Set<string>>} */
const MIMES_DO_TIPO = {
  IMAGEM: new Set(["image/jpeg", "image/png"]),
  VIDEO: new Set(["video/mp4", "video/3gpp"]),
  AUDIO: new Set(["audio/ogg", "audio/mpeg", "audio/aac", "audio/mp4", "audio/amr"]),
  DOCUMENTO: new Set(Object.keys(EXTENSAO_DOCUMENTO)),
};

/** @type {Record<import("../whatsapp/tipoMidia").MotivoRecusaMidia, string>} */
const MSG_RECUSA_MIDIA = {
  MIDIA_VAZIA: "O arquivo enviado está vazio.",
  ACIMA_DO_TETO: "O arquivo está acima do tamanho máximo permitido.",
  TIPO_NAO_RECONHECIDO: "Tipo de arquivo não aceito para envio.",
  TIPO_DIVERGENTE: "O conteúdo do arquivo não corresponde ao tipo informado.",
};

/** @type {Record<import("../whatsapp/envio").CodigoErroEnvio, number>} */
const STATUS_DO_ERRO = {
  CONTEUDO_INVALIDO: 400,
  EQUIPE_NAO_ENCONTRADA: 404,
  EQUIPE_DESCONECTADA: 409,
  FALHA_ENVIO: 502,
  ENVIO_NAO_CONFIRMADO: 504,
};

class ErroRequisicao extends Error {}

/** @param {string} mensagem */
const recusar = (mensagem) => new ErroRequisicao(mensagem);

/**
 * @param {unknown} valor
 * @returns {string | null}
 */
function codEquipeValido(valor) {
  try {
    return normalizarCodEquipe(/** @type {string} */ (valor));
  } catch {
    return null;
  }
}

/**
 * Lê o corpo multipart em memória (nunca em disco), com o teto do arquivo mais a folga dos campos.
 * @type {import("express").RequestHandler}
 */
function lerMultipart(req, res, next) {
  if (!req.is("multipart/form-data")) {
    res.status(400).json({ msg: "O envio precisa ser multipart/form-data." });
    return;
  }
  const limite = obterLimitesMidia().tetoBytes + MARGEM_CORPO_BYTES;
  express.raw({ type: "multipart/form-data", limit: limite })(req, res, (erro) => {
    if (!erro) return next();
    const muitoGrande = /** @type {{ type?: unknown }} */ (erro)?.type === "entity.too.large";
    res.status(400).json({ msg: muitoGrande ? MSG_RECUSA_MIDIA.ACIMA_DO_TETO : "Corpo da requisição inválido." });
  });
}

/**
 * @param {string} texto
 * @param {string} campo
 * @returns {any}
 */
function lerJson(texto, campo) {
  try {
    return JSON.parse(texto);
  } catch {
    throw recusar(`O campo ${campo} não é um JSON válido.`);
  }
}

/**
 * Valida o formulário contra a allowlist e monta os dados do envio (conteúdo só do cliente).
 * @param {FormData} form
 * @returns {Promise<Parameters<ReturnType<typeof criarEnvio>["enviar"]>[1]>}
 */
async function dadosDoFormulario(form) {
  const nomes = new Set(form.keys());
  for (const nome of nomes) {
    if (!ALLOWLIST_ENVIO.has(nome)) throw recusar(`Campo não permitido no envio: ${nome.slice(0, 40)}.`);
    if (form.getAll(nome).length > 1) throw recusar(`O campo ${nome} foi enviado mais de uma vez.`);
  }

  /** @param {string} nome @returns {string | undefined} */
  const texto = (nome) => {
    const valor = form.get(nome);
    if (valor === null) return undefined;
    if (typeof valor !== "string") throw recusar(`O campo ${nome} precisa ser texto.`);
    return valor;
  };

  const tipo = /** @type {TipoEnvio} */ (texto("tipo"));
  if (!tipo || !Object.hasOwn(CAMPOS_DO_TIPO, tipo)) throw recusar("Tipo de envio inválido.");
  const permitidos = new Set([...CAMPOS_COMUNS, ...CAMPOS_DO_TIPO[tipo]]);
  for (const nome of nomes) {
    if (!permitidos.has(nome)) throw recusar(`O campo ${nome} não se aplica ao tipo ${tipo}.`);
  }

  const citacaoTexto = texto("citacao");
  const mencoesTexto = texto("mencoes");
  const mencoes = mencoesTexto === undefined ? [] : lerJson(mencoesTexto, "mencoes");
  if (!Array.isArray(mencoes) || !mencoes.every((m) => typeof m === "string")) throw recusar("Menções inválidas.");
  const base = {
    hash_empresa: texto("hash_empresa") ?? "",
    chat_jid: texto("chat_jid") ?? "",
    citacao: citacaoTexto === undefined ? null : lerJson(citacaoTexto, "citacao"),
    mencoes,
  };

  if (tipo === "TEXTO") {
    const conteudoTexto = texto("texto");
    if (!conteudoTexto || conteudoTexto.trim() === "") throw recusar("Informe o texto da mensagem.");
    return { ...base, conteudo: { texto: conteudoTexto } };
  }

  const arquivo = form.get("midia");
  if (!(arquivo instanceof Blob)) throw recusar("Envie o arquivo no campo midia.");
  const pttTexto = texto("ptt");
  if (pttTexto !== undefined && pttTexto !== "true" && pttTexto !== "false") throw recusar('O campo ptt deve ser "true" ou "false".');
  const ptt = pttTexto === "true";

  const buffer = Buffer.from(await arquivo.arrayBuffer());
  const validacao = validarMidia(buffer, arquivo.type, obterLimitesMidia().tetoBytes);
  if (!validacao.ok) throw recusar(MSG_RECUSA_MIDIA[validacao.motivo]);
  // Um M4A com brand genérica é detectado como vídeo MP4: no envio de áudio, é áudio.
  const mimetype = tipo === "AUDIO" && validacao.mimetype === "video/mp4" ? "audio/mp4" : validacao.mimetype;
  if (!MIMES_DO_TIPO[tipo].has(mimetype)) throw recusar(MSG_RECUSA_MIDIA.TIPO_DIVERGENTE);
  if (ptt && mimetype !== "audio/ogg") throw recusar("A nota de voz precisa ser um áudio ogg/opus.");

  const nomeArquivo = texto("nome_arquivo") ?? (arquivo instanceof File ? arquivo.name : undefined);
  return {
    ...base,
    conteudo: { midia: { buffer, mimetype, legenda: texto("legenda") ?? null, nome: nomeArquivo ?? null, ptt } },
  };
}

/**
 * Resposta de erro do envio/reação: só `{ msg }` em pt-BR, nunca o erro do Baileys.
 * @param {import("express").Response} res
 * @param {unknown} erro
 * @param {string} cod
 */
function responderErro(res, erro, cod) {
  if (erro instanceof ErroRequisicao) {
    res.status(400).json({ msg: erro.message });
    return;
  }
  if (erro instanceof ErroEnvio) {
    res.status(STATUS_DO_ERRO[erro.codigo] ?? 500).json({ msg: erro.message });
    return;
  }
  console.error(`[ENVIO] Erro inesperado no envio da equipe ${cod}:`, erro instanceof Error ? erro.name : "erro");
  res.status(500).json({ msg: "Erro interno ao enviar a mensagem." });
}

/**
 * Monta o controller sobre um manager (o do processo, ou o dos testes).
 * @param {import("../whatsapp/envio").ManagerEnvio} [manager]
 * @param {{
 *   desligamento?: Pick<import("../utils/desligamento").Desligamento, "recusarDuranteEncerramento">,
 *   prazoEnvioMs?: number,
 * }} [opcoes] estado de desligamento (padrão: o do processo) e prazo do `sendMessage` (padrão: ENVIO_PRAZO_MS)
 * @returns {(server: import("express").Express) => void}
 */
function criarEnvioController(manager, { desligamento = desligamentoDoProcesso, prazoEnvioMs } = {}) {
  const { enviar } = criarEnvio({ manager, prazoMs: prazoEnvioMs });
  const { reagir } = criarReacao({ manager });
  /** 503 durante o desligamento; fora dele, a requisição é rastreada até responder. @type {import("express").RequestHandler} */
  const recusarDuranteEncerramento = (req, res, next) => desligamento.recusarDuranteEncerramento(req, res, next);

  return function EnvioController(server) {
    server.post(
      "/equipe/:cod_equipe/enviar",
      exigirTokenServico,
      recusarDuranteEncerramento,
      (req, res, next) => {
        if (!codEquipeValido(req.params.cod_equipe)) {
          res.status(400).json({ msg: "Código da equipe inválido." });
          return;
        }
        next();
      },
      lerMultipart,
      async (req, res) => {
        const cod = /** @type {string} */ (codEquipeValido(req.params.cod_equipe));
        try {
          if (!Buffer.isBuffer(req.body)) throw recusar("Corpo da requisição inválido.");
          /** @type {FormData} */
          let form;
          try {
            form = await new Response(req.body, { headers: { "content-type": String(req.get("content-type")) } }).formData();
          } catch {
            throw recusar("Corpo multipart inválido.");
          }
          const dados = await dadosDoFormulario(form);
          res.status(200).json(await enviar(cod, dados));
        } catch (erro) {
          responderErro(res, erro, cod);
        }
      }
    );

    server.post("/equipe/:cod_equipe/reagir", exigirTokenServico, recusarDuranteEncerramento, async (req, res) => {
      const cod = codEquipeValido(req.params.cod_equipe);
      if (!cod) {
        res.status(400).json({ msg: "Código da equipe inválido." });
        return;
      }
      try {
        const corpo = req.body;
        if (!corpo || typeof corpo !== "object" || Array.isArray(corpo)) throw recusar("Corpo da requisição inválido.");
        for (const nome of Object.keys(corpo)) {
          if (!ALLOWLIST_REACAO.has(nome)) throw recusar(`Campo não permitido na reação: ${nome.slice(0, 40)}.`);
        }
        res.status(200).json(await reagir(cod, corpo.chat_jid, corpo.key, corpo.emoji, corpo.hash_empresa));
      } catch (erro) {
        responderErro(res, erro, cod);
      }
    });
  };
}

const EnvioController = criarEnvioController();

module.exports = Object.assign(EnvioController, { criarEnvioController, ALLOWLIST_ENVIO, ALLOWLIST_REACAO });
