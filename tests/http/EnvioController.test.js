// @ts-check
// Contrato HTTP do envio (back → wa-back): `POST /equipe/:cod_equipe/enviar` (multipart) e
// `POST /equipe/:cod_equipe/reagir` (JSON). A allowlist recusa qualquer campo fora do conteúdo do
// cliente (transcrição, nota interna, explicação) com 400 sem tocar o socket; equipe desconectada
// responde 409, nunca 200. Manager, adapter e socket são falsos.
const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const baileysFalso = require("../helpers/baileysFalso");

baileysFalso.instalarBaileysFalso();
const { registrarControllers } = require("../../src/http");
const { criarEnvioController } = require("../../src/http/EnvioController");
const arquivos = require("../helpers/arquivosMidia");
const { JID_CLIENTE, JID_GRUPO, JID_PARTICIPANTE, EU } = require("../helpers/mensagensWa");

const TOKEN = "token-back-para-wa";
const tokenOriginal = process.env.WA_BACK_ADMIN_TOKEN;
const tetoOriginal = process.env.MIDIA_TETO_BYTES;

/** Estado da equipe falsa 7 (hash-a), trocado por teste. */
const estado = { status: "CONECTADO", falhar: false };
/** @type {{ jid: string, conteudo: any, opcoes: any }[]} */
const envios = [];
/** @type {string[]} */
const marcadas = [];

const socket = {
  user: { id: EU.jid, lid: EU.lid },
  /** @param {string} jid @param {any} conteudo @param {any} opcoes */
  async sendMessage(jid, conteudo, opcoes) {
    envios.push({ jid, conteudo, opcoes });
    if (estado.falhar) throw new Error(`Connection Closed ${jid}`);
    return { key: { remoteJid: jid, fromMe: true, id: opcoes.messageId }, message: {}, messageTimestamp: 1760400500 };
  },
};
const adapter = {
  codEquipe: "7",
  hashEmpresa: "hash-a",
  obterStatusConexao: () => ({ status_conexao: estado.status, ultimo_erro_conexao: null }),
  socketConectado: () => (estado.status === "CONECTADO" ? socket : null),
  /** @param {string} id */
  marcarEnviadaPeloCrm: (id) => void marcadas.push(id),
};
const manager = {
  /** @param {string | number} cod */
  obter: (cod) => (String(cod) === "7" ? /** @type {any} */ (adapter) : null),
  listarRegistradas: () => [],
};

/** @type {http.Server} */
let servidor;
let baseUrl = "";

before(async () => {
  process.env.WA_BACK_ADMIN_TOKEN = TOKEN;
  const app = express();
  app.use(express.json());
  registrarControllers(app, [criarEnvioController(/** @type {any} */ (manager))]);
  servidor = http.createServer(app);
  await new Promise((resolve) => servidor.listen(0, () => resolve(undefined)));
  const endereco = servidor.address();
  assert.ok(endereco && typeof endereco === "object");
  baseUrl = `http://127.0.0.1:${endereco.port}`;
});

after(async () => {
  await new Promise((resolve) => servidor.close(() => resolve(undefined)));
  if (tokenOriginal === undefined) delete process.env.WA_BACK_ADMIN_TOKEN;
  else process.env.WA_BACK_ADMIN_TOKEN = tokenOriginal;
});

beforeEach(() => {
  estado.status = "CONECTADO";
  estado.falhar = false;
  envios.length = 0;
  marcadas.length = 0;
  if (tetoOriginal === undefined) delete process.env.MIDIA_TETO_BYTES;
  else process.env.MIDIA_TETO_BYTES = tetoOriginal;
});

/**
 * @param {Record<string, string>} campos campos de texto (antes do arquivo, como o back envia)
 * @param {{ buffer: Buffer, mimetype: string, nome: string } | null} [arquivo]
 */
function formulario(campos, arquivo = null) {
  const form = new FormData();
  for (const [nome, valor] of Object.entries(campos)) form.append(nome, valor);
  if (arquivo) form.append("midia", new Blob([arquivo.buffer], { type: arquivo.mimetype }), arquivo.nome);
  return form;
}

/**
 * @param {string} cod
 * @param {FormData | string} corpo
 * @param {{ token?: string | null, contentType?: string }} [opcoes]
 */
function postEnviar(cod, corpo, { token = TOKEN, contentType } = {}) {
  /** @type {Record<string, string>} */
  const headers = {};
  if (token) headers["X-Internal-Token"] = token;
  if (contentType) headers["Content-Type"] = contentType;
  return fetch(`${baseUrl}/equipe/${cod}/enviar`, { method: "POST", headers, body: corpo });
}

/**
 * @param {string} cod
 * @param {unknown} corpo
 * @param {string | null} [token]
 */
function postReagir(cod, corpo, token = TOKEN) {
  /** @type {Record<string, string>} */
  const headers = { "Content-Type": "application/json" };
  if (token) headers["X-Internal-Token"] = token;
  return fetch(`${baseUrl}/equipe/${cod}/reagir`, { method: "POST", headers, body: JSON.stringify(corpo) });
}

const BASE = { hash_empresa: "hash-a", chat_jid: JID_CLIENTE };

/**
 * @param {Response} resposta
 * @param {number} status
 */
async function esperarErro(resposta, status) {
  assert.equal(resposta.status, status);
  const corpo = /** @type {any} */ (await resposta.json());
  assert.equal(typeof corpo.msg, "string");
  assert.ok(corpo.msg.length > 0);
  return corpo;
}

test("sem o token de serviço as rotas respondem 401 sem tocar o socket", async () => {
  assert.equal((await postEnviar("7", formulario({ ...BASE, tipo: "TEXTO", texto: "Oi" }), { token: null })).status, 401);
  assert.equal((await postEnviar("7", formulario({ ...BASE, tipo: "TEXTO", texto: "Oi" }), { token: "errado" })).status, 401);
  assert.equal((await postReagir("7", { ...BASE, key: { remoteJid: JID_CLIENTE, fromMe: false, id: "3EB0A" }, emoji: "👍" }, null)).status, 401);
  assert.equal(envios.length, 0);
});

test("TEXTO: 200 { mensagem_wa_id, key, timestamp_wa, status: ENVIADA }, com o id marcado no cache de eco", async () => {
  const resposta = await postEnviar("7", formulario({ ...BASE, tipo: "TEXTO", texto: "Olá, tudo certo?" }));
  assert.equal(resposta.status, 200);
  const corpo = await resposta.json();
  assert.equal(envios.length, 1);
  const id = envios[0].opcoes.messageId;
  assert.deepEqual(corpo, { mensagem_wa_id: id, key: { remoteJid: JID_CLIENTE, fromMe: true, id }, timestamp_wa: 1760400500, status: "ENVIADA" });
  assert.deepEqual(marcadas, [id]);
  assert.deepEqual(envios[0].conteudo, { text: "Olá, tudo certo?" });
});

test("DOCUMENTO PDF vira { document, mimetype, fileName } com a legenda; a citação usa quoted com a key original", async () => {
  const pdf = arquivos.pdf();
  const key = { remoteJid: JID_CLIENTE, fromMe: false, id: "3EB0PERGUNTA" };
  const resposta = await postEnviar(
    "7",
    formulario(
      { ...BASE, tipo: "DOCUMENTO", legenda: "Segue", nome_arquivo: "boleto.pdf", citacao: JSON.stringify({ key, message: { conversation: "Manda o boleto?" } }) },
      { buffer: pdf, mimetype: "application/pdf", nome: "boleto.pdf" }
    )
  );
  assert.equal(resposta.status, 200);
  const { conteudo, opcoes } = envios[0];
  assert.ok(Buffer.isBuffer(conteudo.document));
  assert.ok(conteudo.document.equals(pdf));
  assert.equal(conteudo.mimetype, "application/pdf");
  assert.equal(conteudo.fileName, "boleto.pdf");
  assert.equal(conteudo.caption, "Segue");
  assert.deepEqual(opcoes.quoted.key, key);
  assert.deepEqual(opcoes.quoted.message, { conversation: "Manda o boleto?" });
});

test("AUDIO gravado (ptt=true) vira { audio, ptt: true } em ogg/opus com seconds", async () => {
  const resposta = await postEnviar("7", formulario({ ...BASE, tipo: "AUDIO", ptt: "true" }, { buffer: arquivos.oggOpus(3), mimetype: "audio/ogg; codecs=opus", nome: "voz.ogg" }));
  assert.equal(resposta.status, 200);
  const { conteudo } = envios[0];
  assert.ok(Buffer.isBuffer(conteudo.audio));
  assert.equal(conteudo.ptt, true);
  assert.equal(conteudo.mimetype, "audio/ogg; codecs=opus");
  assert.equal(conteudo.seconds, 3);
});

test("IMAGEM e VIDEO saem com jpegThumbnail null; menções em grupo vão em mentions", async () => {
  const imagem = await postEnviar(
    "7",
    formulario({ ...BASE, chat_jid: JID_GRUPO, tipo: "IMAGEM", legenda: "@5511900000002 olha", mencoes: JSON.stringify([JID_PARTICIPANTE]) }, { buffer: arquivos.jpeg(), mimetype: "image/jpeg", nome: "foto.jpg" })
  );
  assert.equal(imagem.status, 200);
  assert.equal(envios[0].jid, JID_GRUPO);
  assert.equal(envios[0].conteudo.jpegThumbnail, null);
  assert.equal(envios[0].conteudo.caption, "@5511900000002 olha");
  assert.deepEqual(envios[0].conteudo.mentions, [JID_PARTICIPANTE]);

  const video = await postEnviar("7", formulario({ ...BASE, tipo: "VIDEO" }, { buffer: arquivos.mp4(), mimetype: "video/mp4", nome: "video.mp4" }));
  assert.equal(video.status, 200);
  assert.ok(Buffer.isBuffer(envios[1].conteudo.video));
  assert.equal(envios[1].conteudo.jpegThumbnail, null);
});

test("payload com campos internos (transcricao, nota_interna, explicacao) é rejeitado com 400 sem chamar o Baileys (teste de contrato)", async () => {
  for (const campo of ["transcricao", "nota_interna", "explicacao"]) {
    const resposta = await postEnviar("7", formulario({ ...BASE, tipo: "TEXTO", texto: "Oi", [campo]: "conteúdo interno" }));
    await esperarErro(resposta, 400);
    const comArquivo = await postEnviar("7", formulario({ ...BASE, tipo: "DOCUMENTO", [campo]: "conteúdo interno" }, { buffer: arquivos.pdf(), mimetype: "application/pdf", nome: "a.pdf" }));
    await esperarErro(comArquivo, 400);
    const reacao = await postReagir("7", { ...BASE, key: { remoteJid: JID_CLIENTE, fromMe: false, id: "3EB0A" }, emoji: "👍", [campo]: "conteúdo interno" });
    await esperarErro(reacao, 400);
  }
  // Qualquer outro campo fora da allowlist também.
  await esperarErro(await postEnviar("7", formulario({ ...BASE, tipo: "TEXTO", texto: "Oi", resolucao: "x" })), 400);
  assert.equal(envios.length, 0);
  assert.deepEqual(marcadas, []);
});

test("envio TEXTO com campos da pesquisa de satisfação (comentario, nota, token, titulo_ticket) responde 400 sem chamar o Baileys (teste de contrato)", async () => {
  for (const campo of ["comentario", "nota", "token", "titulo_ticket"]) {
    await esperarErro(await postEnviar("7", formulario({ ...BASE, tipo: "TEXTO", texto: "Avalie nosso atendimento.", [campo]: "valor" })), 400);
  }
  await esperarErro(await postEnviar("7", formulario({ ...BASE, tipo: "TEXTO", texto: "Avalie nosso atendimento.", comentario: "x", nota: "5", token: "t", titulo_ticket: "y" })), 400);
  assert.equal(envios.length, 0);
  assert.deepEqual(marcadas, []);
  // O corpo da pesquisa (só o texto com o link) segue aceito.
  const ok = await postEnviar("7", formulario({ ...BASE, tipo: "TEXTO", texto: "Avalie: https://exemplo.invalido/pesquisa/abc" }));
  assert.equal(ok.status, 200);
  assert.equal(envios.length, 1);
});

test("equipe desconectada responde 409, nunca 200, no enviar e no reagir", async () => {
  for (const status of ["DESCONECTADO", "ERRO", "QR_PENDENTE"]) {
    estado.status = status;
    await esperarErro(await postEnviar("7", formulario({ ...BASE, tipo: "TEXTO", texto: "Oi" })), 409);
    await esperarErro(await postReagir("7", { ...BASE, key: { remoteJid: JID_CLIENTE, fromMe: false, id: "3EB0A" }, emoji: "👍" }), 409);
  }
  // Equipe sem instância neste processo.
  await esperarErro(await postEnviar("9", formulario({ ...BASE, tipo: "TEXTO", texto: "Oi" })), 409);
  assert.equal(envios.length, 0);
});

test("equipe de outra empresa responde 404; cod_equipe inválido responde 400", async () => {
  await esperarErro(await postEnviar("7", formulario({ ...BASE, hash_empresa: "hash-b", tipo: "TEXTO", texto: "Oi" })), 404);
  await esperarErro(await postReagir("7", { ...BASE, hash_empresa: "hash-b", key: { remoteJid: JID_CLIENTE, fromMe: false, id: "3EB0A" }, emoji: "👍" }), 404);
  await esperarErro(await postEnviar("abc", formulario({ ...BASE, tipo: "TEXTO", texto: "Oi" })), 400);
  assert.equal(envios.length, 0);
});

test("falha no sendMessage responde 502 com msg genérica, nunca 200", async () => {
  estado.falhar = true;
  const corpo = await esperarErro(await postEnviar("7", formulario({ ...BASE, tipo: "TEXTO", texto: "Oi" })), 502);
  assert.ok(!corpo.msg.includes("5511"));
  await esperarErro(await postReagir("7", { ...BASE, key: { remoteJid: JID_CLIENTE, fromMe: false, id: "3EB0A" }, emoji: "👍" }), 502);
});

test("conteúdo divergente do tipo, arquivo acima do teto e campos inválidos respondem 400 sem tocar o socket", async () => {
  const pdf = { buffer: arquivos.pdf(), mimetype: "application/pdf", nome: "a.pdf" };
  const casos = [
    // tipo divergente: PDF como imagem, JPEG declarado como PDF, nota de voz que não é ogg/opus
    formulario({ ...BASE, tipo: "IMAGEM" }, pdf),
    formulario({ ...BASE, tipo: "DOCUMENTO" }, { buffer: arquivos.jpeg(), mimetype: "application/pdf", nome: "a.pdf" }),
    formulario({ ...BASE, tipo: "AUDIO", ptt: "true" }, { buffer: arquivos.mp3(), mimetype: "audio/mpeg", nome: "a.mp3" }),
    // mídia sem arquivo, texto com arquivo, tipo desconhecido, campo que não é do tipo
    formulario({ ...BASE, tipo: "IMAGEM" }),
    formulario({ ...BASE, tipo: "TEXTO", texto: "Oi" }, pdf),
    formulario({ ...BASE, tipo: "FIGURINHA" }, pdf),
    formulario({ ...BASE, tipo: "TEXTO", texto: "Oi", legenda: "x" }),
    formulario({ ...BASE, tipo: "TEXTO" }),
    // hash_empresa ausente, chat_jid inválido, JSON inválido em citacao/mencoes, ptt fora de "true"/"false"
    formulario({ chat_jid: JID_CLIENTE, tipo: "TEXTO", texto: "Oi" }),
    formulario({ ...BASE, chat_jid: "status@broadcast", tipo: "TEXTO", texto: "Oi" }),
    formulario({ ...BASE, tipo: "TEXTO", texto: "Oi", citacao: "{nao json" }),
    formulario({ ...BASE, tipo: "TEXTO", texto: "Oi", mencoes: "[1,2]" }),
    formulario({ ...BASE, tipo: "AUDIO", ptt: "sim" }, { buffer: arquivos.oggOpus(2), mimetype: "audio/ogg", nome: "a.ogg" }),
  ];
  for (const corpo of casos) await esperarErro(await postEnviar("7", corpo), 400);

  // Campo repetido.
  const repetido = formulario({ ...BASE, tipo: "TEXTO", texto: "Oi" });
  repetido.append("texto", "de novo");
  await esperarErro(await postEnviar("7", repetido), 400);

  // Acima do teto configurado no ambiente.
  process.env.MIDIA_TETO_BYTES = "64";
  await esperarErro(await postEnviar("7", formulario({ ...BASE, tipo: "DOCUMENTO" }, { buffer: Buffer.concat([arquivos.pdf(), Buffer.alloc(100)]), mimetype: "application/pdf", nome: "a.pdf" })), 400);

  // Corpo que não é multipart.
  await esperarErro(await postEnviar("7", JSON.stringify({ ...BASE, tipo: "TEXTO", texto: "Oi" }), { contentType: "application/json" }), 400);
  assert.equal(envios.length, 0);
});

test("reagir: 200 { status: ENVIADA } com { react: { text, key } }; emoji vazio remove; key inválida responde 400", async () => {
  const key = { remoteJid: JID_CLIENTE, fromMe: false, id: "3EB0ALVO" };
  const resposta = await postReagir("7", { ...BASE, key, emoji: "❤️" });
  assert.equal(resposta.status, 200);
  assert.deepEqual(await resposta.json(), { status: "ENVIADA" });
  assert.deepEqual(envios[0].conteudo, { react: { text: "❤️", key } });
  assert.deepEqual(marcadas, [envios[0].opcoes.messageId]);

  assert.equal((await postReagir("7", { ...BASE, key, emoji: "" })).status, 200);
  assert.equal(envios[1].conteudo.react.text, "");

  await esperarErro(await postReagir("7", { ...BASE, key: { remoteJid: JID_GRUPO, fromMe: false, id: "3EB0X" }, emoji: "👍" }), 400);
  await esperarErro(await postReagir("7", { ...BASE, key }), 400);
  await esperarErro(await postReagir("7", { chat_jid: JID_CLIENTE, key, emoji: "👍" }), 400);
  assert.equal(envios.length, 2);
});

// ---- Fase 18: quebras de linha. O multipart/form-data normaliza as quebras dos campos de texto para
// CRLF (o FormData do Node faz isso de verdade neste teste); o que chega ao Baileys usa só "\n". ----

test("multipart real: o texto '*Ana*\nlinha1\nlinha2' chega ao sendMessage com \n (sem \r)", async () => {
  const resposta = await postEnviar("7", formulario({ ...BASE, tipo: "TEXTO", texto: "*Ana*\r\nlinha1\r\nlinha2" }));
  assert.equal(resposta.status, 200);
  assert.deepEqual(envios[0].conteudo, { text: "*Ana*\nlinha1\nlinha2" });
});

test("\r isolado também vira \n, e nada mais muda (linhas em branco e espaços ficam)", async () => {
  await postEnviar("7", formulario({ ...BASE, tipo: "TEXTO", texto: "a\rb\r\n\r\n c  \n" }));
  assert.equal(envios[0].conteudo.text, "a\nb\n\n c  \n");
});

test("a legenda de imagem com \r\n também é normalizada", async () => {
  const resposta = await postEnviar(
    "7",
    formulario({ ...BASE, tipo: "IMAGEM", legenda: "*Ana*\r\nolha isto" }, { buffer: arquivos.jpeg(), mimetype: "image/jpeg", nome: "foto.jpg" })
  );
  assert.equal(resposta.status, 200);
  assert.equal(envios[0].conteudo.caption, "*Ana*\nolha isto");
});

test("texto sem quebras fica idêntico", async () => {
  await postEnviar("7", formulario({ ...BASE, tipo: "TEXTO", texto: "Olá, tudo certo?" }));
  assert.equal(envios[0].conteudo.text, "Olá, tudo certo?");
});

test("o limite de tamanho vale depois da normalização (CRLF não conta em dobro)", async () => {
  const texto = "x\r\n".repeat(30000); // 90.000 caracteres crus, 60.000 depois da normalização
  const ok = await postEnviar("7", formulario({ ...BASE, tipo: "TEXTO", texto }));
  assert.equal(ok.status, 200);
  const longo = await postEnviar("7", formulario({ ...BASE, tipo: "TEXTO", texto: "y".repeat(65537) }));
  assert.equal(longo.status, 400);
  const legendaLonga = await postEnviar("7", formulario({ ...BASE, tipo: "IMAGEM", legenda: "z".repeat(1025) }, { buffer: arquivos.jpeg(), mimetype: "image/jpeg", nome: "foto.jpg" }));
  assert.equal(legendaLonga.status, 400);
});
