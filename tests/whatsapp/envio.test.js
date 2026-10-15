// @ts-check
// Pipeline de saída: o conteúdo do cliente vira o conteúdo Baileys certo (texto, imagem, vídeo,
// áudio/nota de voz, documento, citação e menções), o id é gerado e marcado no cache de eco ANTES do
// `sendMessage`, e nenhum conteúdo interno chega ao socket. Socket e manager são falsos.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const baileysFalso = require("../helpers/baileysFalso");

baileysFalso.instalarBaileysFalso();
const { montarConteudo, montarCitacao, criarEnvio, ErroEnvio } = require("../../src/whatsapp/envio");
const arquivos = require("../helpers/arquivosMidia");
const { JID_CLIENTE, JID_GRUPO, JID_PARTICIPANTE, LID_CLIENTE, EU } = require("../helpers/mensagensWa");

beforeEach(() => baileysFalso.limparHistorico());

/** Campos que nunca podem chegar ao WhatsApp (SPEC: conteúdo interno). */
const CAMPOS_INTERNOS = ["transcricao", "nota_interna", "explicacao"];

/**
 * Todas as chaves de um objeto, em qualquer profundidade (Buffers não são percorridos).
 * @param {any} valor
 * @returns {string[]}
 */
function todasAsChaves(valor) {
  if (!valor || typeof valor !== "object" || Buffer.isBuffer(valor)) return [];
  return Object.entries(valor).flatMap(([chave, item]) => [chave, ...todasAsChaves(item)]);
}

/**
 * Equipe falsa: adapter com socket conectado que guarda cada `sendMessage` e a ordem das chamadas.
 * @param {{ status?: string, hashEmpresa?: string, falhar?: boolean, semSocket?: boolean, registradas?: { cod_equipe: string, hash_empresa: string }[] }} [opcoes]
 */
function equipeFalsa({ status = "CONECTADO", hashEmpresa = "hash-a", falhar = false, semSocket = false, registradas = [] } = {}) {
  /** @type {string[]} */
  const ordem = [];
  /** @type {{ jid: string, conteudo: any, opcoes: any }[]} */
  const envios = [];
  const socket = {
    user: { id: EU.jid, lid: EU.lid },
    /** @param {string} jid @param {any} conteudo @param {any} opcoes */
    async sendMessage(jid, conteudo, opcoes) {
      ordem.push(`sendMessage:${opcoes?.messageId}`);
      envios.push({ jid, conteudo, opcoes });
      if (falhar) throw Object.assign(new Error(`falha ao enviar para ${jid}`), { name: "Boom" });
      return { key: { remoteJid: jid, fromMe: true, id: opcoes.messageId }, message: {}, messageTimestamp: 1760400123 };
    },
  };
  const adapter = {
    codEquipe: "7",
    hashEmpresa,
    obterStatusConexao: () => ({ status_conexao: status, ultimo_erro_conexao: null }),
    socketConectado: () => (semSocket || status !== "CONECTADO" ? null : socket),
    /** @param {string} id */
    marcarEnviadaPeloCrm: (id) => void ordem.push(`marcar:${id}`),
  };
  const manager = {
    /** @param {string | number} cod */
    obter: (cod) => (String(cod) === "7" ? /** @type {any} */ (adapter) : null),
    listarRegistradas: () => registradas,
  };
  return { manager, adapter, socket, envios, ordem };
}

test("um PDF vira { document, mimetype, fileName } com a legenda em caption", () => {
  const buffer = arquivos.pdf();
  const conteudo = montarConteudo({ midia: { buffer, mimetype: "application/pdf", nome: "boleto.pdf", legenda: "Segue o boleto" } });
  assert.deepEqual(conteudo, { document: buffer, mimetype: "application/pdf", fileName: "boleto.pdf", caption: "Segue o boleto" });
});

test("um documento sem nome recebe um nome com a extensão do tipo, e um nome com caminho fica só com o arquivo", () => {
  assert.equal(montarConteudo({ midia: { buffer: arquivos.pdf(), mimetype: "application/pdf" } }).fileName, "documento.pdf");
  assert.equal(montarConteudo({ midia: { buffer: arquivos.pdf(), mimetype: "application/pdf", nome: "..\\..\\pasta/relatorio" } }).fileName, "relatorio.pdf");
});

test("um áudio gravado vira { audio, ptt: true } em ogg/opus com a duração real em seconds", () => {
  const buffer = arquivos.oggOpus(5);
  const conteudo = montarConteudo({ midia: { buffer, mimetype: "audio/ogg", ptt: true } });
  assert.deepEqual(conteudo, { audio: buffer, mimetype: "audio/ogg; codecs=opus", ptt: true, seconds: 5 });
});

test("uma nota de voz que não é ogg/opus legível é recusada sem montar conteúdo", () => {
  assert.throws(
    () => montarConteudo({ midia: { buffer: arquivos.mp3(), mimetype: "audio/mpeg", ptt: true } }),
    (erro) => erro instanceof ErroEnvio && erro.codigo === "CONTEUDO_INVALIDO"
  );
});

test("um arquivo de áudio comum vai com ptt false e seconds sempre preenchido (o Baileys nunca mede em disco)", () => {
  const conteudo = montarConteudo({ midia: { buffer: arquivos.mp3(), mimetype: "audio/mpeg", ptt: false } });
  assert.equal(conteudo.ptt, false);
  assert.equal(conteudo.mimetype, "audio/mpeg");
  assert.equal(typeof conteudo.seconds, "number");
});

test("imagem e vídeo saem com jpegThumbnail null (sem miniatura em disco) e a legenda em caption", () => {
  const jpeg = arquivos.jpeg();
  assert.deepEqual(montarConteudo({ midia: { buffer: jpeg, mimetype: "image/jpeg", legenda: "Foto" } }), {
    image: jpeg,
    mimetype: "image/jpeg",
    caption: "Foto",
    jpegThumbnail: null,
  });
  const mp4 = arquivos.mp4();
  assert.deepEqual(montarConteudo({ midia: { buffer: mp4, mimetype: "video/mp4" } }), { video: mp4, mimetype: "video/mp4", jpegThumbnail: null });
});

test("texto vira { text } e as menções vão em mentions", () => {
  assert.deepEqual(montarConteudo({ texto: "Olá" }), { text: "Olá" });
  assert.deepEqual(montarConteudo({ texto: "Oi @5511900000002" }, { mencoes: [JID_PARTICIPANTE] }), {
    text: "Oi @5511900000002",
    mentions: [JID_PARTICIPANTE],
  });
});

test("campos internos no conteúdo nunca chegam ao conteúdo Baileys (teste de contrato)", () => {
  const conteudos = [
    montarConteudo(/** @type {any} */ ({ texto: "Olá", transcricao: "x", nota_interna: "y", explicacao: "z" })),
    montarConteudo(/** @type {any} */ ({ midia: { buffer: arquivos.pdf(), mimetype: "application/pdf", transcricao: "x", explicacao: "z" } })),
  ];
  for (const conteudo of conteudos) {
    for (const campo of CAMPOS_INTERNOS) assert.ok(!todasAsChaves(conteudo).includes(campo), `${campo} vazou`);
  }
});

test("a citação usa a key original e o message guardado; Buffers serializados pelo back voltam a ser Buffer", () => {
  const key = { remoteJid: JID_GRUPO, fromMe: false, id: "3EB0ORIGINAL1", participant: JID_PARTICIPANTE };
  const citacao = montarCitacao(
    { key, message: { imageMessage: { caption: "foto", mediaKey: { type: "Buffer", data: Buffer.from("chave").toString("base64") } } }, pushName: "ignorado" },
    JID_GRUPO
  );
  assert.deepEqual(citacao?.key, key);
  assert.ok(Buffer.isBuffer(citacao?.message.imageMessage.mediaKey));
  assert.equal(citacao?.message.imageMessage.mediaKey.toString(), "chave");
  assert.ok(!("pushName" in /** @type {any} */ (citacao)));
});

test("uma citação de outro grupo, sem message ou com key inválida é recusada", () => {
  const recusada = (/** @type {any} */ citacao, chat = JID_GRUPO) =>
    assert.throws(() => montarCitacao(citacao, chat), (erro) => erro instanceof ErroEnvio && erro.codigo === "CONTEUDO_INVALIDO");
  recusada({ key: { remoteJid: "120363000000000999@g.us", fromMe: false, id: "3EB0X" }, message: { conversation: "a" } });
  recusada({ key: { remoteJid: JID_GRUPO, fromMe: false, id: "3EB0X" } });
  recusada({ key: { remoteJid: JID_GRUPO, id: "3EB0X" }, message: { conversation: "a" } });
  recusada({ key: { remoteJid: JID_GRUPO, fromMe: false, id: "" }, message: { conversation: "a" } });
  recusada({ key: { remoteJid: JID_GRUPO, fromMe: false, id: "3EB0X" }, message: { conversation: "a" } }, JID_CLIENTE);
  // Conversa privada: o contato pode aparecer por telefone ou por LID, e os dois valem.
  assert.ok(montarCitacao({ key: { remoteJid: JID_CLIENTE, fromMe: true, id: "3EB0X" }, message: { conversation: "a" } }, LID_CLIENTE));
});

test("enviar gera o id, marca no cache de eco ANTES do sendMessage e passa messageId e quoted", async () => {
  const { manager, envios, ordem } = equipeFalsa();
  const { enviar } = criarEnvio({ manager });
  const key = { remoteJid: JID_CLIENTE, fromMe: false, id: "3EB0ORIGINAL2" };
  const resultado = await enviar("7", {
    hash_empresa: "hash-a",
    chat_jid: JID_CLIENTE,
    conteudo: { texto: "Resposta" },
    citacao: { key, message: { conversation: "Pergunta" } },
  });

  assert.equal(envios.length, 1);
  const id = envios[0].opcoes.messageId;
  assert.match(id, /^3EB0FALSO/);
  assert.deepEqual(baileysFalso.idsGerados, [EU.jid]);
  assert.deepEqual(ordem, [`marcar:${id}`, `sendMessage:${id}`]);
  assert.equal(envios[0].jid, JID_CLIENTE);
  assert.deepEqual(envios[0].conteudo, { text: "Resposta" });
  assert.deepEqual(envios[0].opcoes.quoted.key, key);
  assert.deepEqual(envios[0].opcoes.quoted.message, { conversation: "Pergunta" });
  assert.deepEqual(resultado, {
    mensagem_wa_id: id,
    key: { remoteJid: JID_CLIENTE, fromMe: true, id },
    timestamp_wa: 1760400123,
    status: "ENVIADA",
  });
});

test("em grupo as menções vão no conteúdo e o envio sai para o JID do grupo", async () => {
  const { manager, envios } = equipeFalsa();
  await criarEnvio({ manager }).enviar("7", {
    hash_empresa: "hash-a",
    chat_jid: JID_GRUPO,
    conteudo: { texto: "@5511900000002 veja" },
    mencoes: [JID_PARTICIPANTE],
  });
  assert.equal(envios[0].jid, JID_GRUPO);
  assert.deepEqual(envios[0].conteudo.mentions, [JID_PARTICIPANTE]);
});

test("equipe desconectada ou sem socket: EQUIPE_DESCONECTADA, sem gerar id nem chamar o sendMessage", async () => {
  for (const opcoes of [{ status: "ERRO" }, { status: "QR_PENDENTE" }, { semSocket: true }]) {
    const { manager, envios, ordem } = equipeFalsa(opcoes);
    await assert.rejects(
      criarEnvio({ manager }).enviar("7", { hash_empresa: "hash-a", chat_jid: JID_CLIENTE, conteudo: { texto: "Oi" } }),
      (erro) => erro instanceof ErroEnvio && erro.codigo === "EQUIPE_DESCONECTADA"
    );
    assert.equal(envios.length, 0);
    assert.deepEqual(ordem, []);
  }
  // Sem instância em memória também é desconectada.
  const { manager } = equipeFalsa();
  await assert.rejects(
    criarEnvio({ manager }).enviar("8", { hash_empresa: "hash-a", chat_jid: JID_CLIENTE, conteudo: { texto: "Oi" } }),
    (erro) => erro instanceof ErroEnvio && erro.codigo === "EQUIPE_DESCONECTADA"
  );
});

test("equipe de outra empresa (instância ou registro de pareadas): EQUIPE_NAO_ENCONTRADA", async () => {
  const { manager, envios } = equipeFalsa({ hashEmpresa: "hash-b" });
  await assert.rejects(
    criarEnvio({ manager }).enviar("7", { hash_empresa: "hash-a", chat_jid: JID_CLIENTE, conteudo: { texto: "Oi" } }),
    (erro) => erro instanceof ErroEnvio && erro.codigo === "EQUIPE_NAO_ENCONTRADA"
  );
  assert.equal(envios.length, 0);
  const outra = equipeFalsa({ registradas: [{ cod_equipe: "8", hash_empresa: "hash-b" }] });
  await assert.rejects(
    criarEnvio({ manager: outra.manager }).enviar("8", { hash_empresa: "hash-a", chat_jid: JID_CLIENTE, conteudo: { texto: "Oi" } }),
    (erro) => erro instanceof ErroEnvio && erro.codigo === "EQUIPE_NAO_ENCONTRADA"
  );
});

test("falha no sendMessage vira FALHA_ENVIO com mensagem genérica (sem JID)", async () => {
  const { manager } = equipeFalsa({ falhar: true });
  await assert.rejects(
    criarEnvio({ manager }).enviar("7", { hash_empresa: "hash-a", chat_jid: JID_CLIENTE, conteudo: { texto: "Oi" } }),
    (erro) => erro instanceof ErroEnvio && erro.codigo === "FALHA_ENVIO" && !erro.message.includes("5511")
  );
});

test("chat_jid inválido, de status ou de broadcast e menções inválidas são recusados sem chamar o socket", async () => {
  const { manager, envios } = equipeFalsa();
  const { enviar } = criarEnvio({ manager });
  for (const chat_jid of ["", "5511900000001", "status@broadcast", "123@newsletter", "abc@s.whatsapp.net"]) {
    await assert.rejects(enviar("7", { hash_empresa: "hash-a", chat_jid, conteudo: { texto: "Oi" } }), (erro) => erro instanceof ErroEnvio && erro.codigo === "CONTEUDO_INVALIDO");
  }
  for (const mencoes of [["abc"], [JID_GRUPO], /** @type {any} */ ("x")]) {
    await assert.rejects(
      enviar("7", { hash_empresa: "hash-a", chat_jid: JID_GRUPO, conteudo: { texto: "Oi" }, mencoes }),
      (erro) => erro instanceof ErroEnvio && erro.codigo === "CONTEUDO_INVALIDO"
    );
  }
  await assert.rejects(enviar("7", { hash_empresa: "hash-a", chat_jid: JID_CLIENTE, conteudo: { texto: "   " } }), (erro) => erro instanceof ErroEnvio);
  assert.equal(envios.length, 0);
});

// Task 14.3: prazo do sendMessage e cache de reenvio (getMessage).

/**
 * Equipe falsa com um sendMessage controlado pelo teste e um adapter que guarda o `guardarEnviada`.
 * @param {(jid: string, conteudo: any, opcoes: any) => Promise<any>} sendMessage
 */
function equipeComSend(sendMessage) {
  /** @type {{ id: string, message: any, jid: string }[]} */
  const guardadas = [];
  const socket = { user: { id: EU.jid, lid: EU.lid }, sendMessage };
  const adapter = {
    codEquipe: "7",
    hashEmpresa: "hash-a",
    socketConectado: () => socket,
    marcarEnviadaPeloCrm: () => {},
    /** @param {string} id @param {any} message @param {string} jid */
    guardarEnviada: (id, message, jid) => void guardadas.push({ id, message, jid }),
  };
  const manager = { obter: () => /** @type {any} */ (adapter), listarRegistradas: () => [] };
  return { manager, guardadas };
}

test("o envio confirmado guarda o message devolvido pelo sendMessage no cache de reenvio, com o destino", async () => {
  const message = { extendedTextMessage: { text: "Resposta" } };
  const { manager, guardadas } = equipeComSend(async (jid, _c, opcoes) => ({ key: { remoteJid: jid, fromMe: true, id: opcoes.messageId }, message }));
  const resultado = await criarEnvio({ manager }).enviar("7", { hash_empresa: "hash-a", chat_jid: JID_CLIENTE, conteudo: { texto: "Resposta" } });
  assert.deepEqual(guardadas, [{ id: resultado.mensagem_wa_id, message, jid: JID_CLIENTE }]);
});

test("sendMessage que passa do prazo vira ENVIO_NAO_CONFIRMADO (\"Envio não confirmado.\"), sem esperar para sempre", async () => {
  const { manager } = equipeComSend(() => new Promise(() => {}));
  const inicio = Date.now();
  await assert.rejects(
    criarEnvio({ manager, prazoMs: 30 }).enviar("7", { hash_empresa: "hash-a", chat_jid: JID_CLIENTE, conteudo: { texto: "Oi" } }),
    (erro) => erro instanceof ErroEnvio && erro.codigo === "ENVIO_NAO_CONFIRMADO" && erro.message === "Envio não confirmado."
  );
  assert.ok(Date.now() - inicio < 1000);
});

test("um sendMessage que termina depois do prazo ainda entra no cache de reenvio (a mensagem saiu)", async () => {
  /** @type {(valor: any) => void} */
  let concluir = () => {};
  const { manager, guardadas } = equipeComSend((jid, _c, opcoes) => new Promise((resolve) => (concluir = () => resolve({ key: { remoteJid: jid, fromMe: true, id: opcoes.messageId }, message: { conversation: "Oi" } }))));
  await assert.rejects(
    criarEnvio({ manager, prazoMs: 20 }).enviar("7", { hash_empresa: "hash-a", chat_jid: JID_CLIENTE, conteudo: { texto: "Oi" } }),
    (erro) => erro instanceof ErroEnvio && erro.codigo === "ENVIO_NAO_CONFIRMADO"
  );
  concluir(undefined);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(guardadas.length, 1);
  assert.deepEqual(guardadas[0].message, { conversation: "Oi" });
});

test("obterPrazoEnvioMs lê ENVIO_PRAZO_MS e cai no padrão (abaixo do prazo do back) quando vazio ou inválido", () => {
  const { obterPrazoEnvioMs, PRAZO_ENVIO_PADRAO_MS } = require("../../src/whatsapp/envio");
  assert.equal(obterPrazoEnvioMs({}), PRAZO_ENVIO_PADRAO_MS);
  assert.equal(obterPrazoEnvioMs({ ENVIO_PRAZO_MS: "x" }), PRAZO_ENVIO_PADRAO_MS);
  assert.equal(obterPrazoEnvioMs({ ENVIO_PRAZO_MS: "0" }), PRAZO_ENVIO_PADRAO_MS);
  assert.equal(obterPrazoEnvioMs({ ENVIO_PRAZO_MS: "45000" }), 45000);
  assert.ok(PRAZO_ENVIO_PADRAO_MS < 120_000, "o back desiste do envio em 120 s");
});
