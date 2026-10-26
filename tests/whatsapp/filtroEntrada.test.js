// @ts-check
// normalizarMensagem: função pura sobre o WAMessage do `messages.upsert`. Payloads montados pelos
// builders de tests/helpers/mensagensWa.js (dados fictícios).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { normalizarMensagem } = require("../../src/whatsapp/filtroEntrada");
const {
  mensagemWa,
  mensagemGrupo,
  long,
  TELEFONE_CLIENTE,
  JID_CLIENTE,
  LID_CLIENTE,
  JID_GRUPO,
  TELEFONE_PARTICIPANTE,
  JID_PARTICIPANTE,
  LID_PARTICIPANTE,
  TELEFONE_EQUIPE,
  EU,
  TIMESTAMP,
} = require("../helpers/mensagensWa");

const REMETENTE_CLIENTE = { jid: JID_CLIENTE, lid: null, telefone: TELEFONE_CLIENTE, nome: "Cliente Teste" };
const CONTATO_CLIENTE = { jid: JID_CLIENTE, lid: null, telefone: TELEFONE_CLIENTE };

/**
 * MensagemRecebida sem `key` e `bruto` (conferidos em testes próprios).
 * @param {any} waMessage
 * @param {any} [opcoes]
 * @returns {any}
 */
function normalizarSemBruto(waMessage, opcoes) {
  const r = normalizarMensagem(waMessage, opcoes);
  assert.ok(r, "a mensagem deveria ser normalizada, não ignorada");
  const { key, bruto, ...resto } = r;
  return resto;
}

/**
 * Campos padrão de uma mensagem privada do cliente; o teste sobrescreve só o que muda.
 * @param {any} waMessage
 * @param {Record<string, any>} campos
 */
function esperadoPrivado(waMessage, campos) {
  return {
    mensagem_wa_id: waMessage.key.id,
    chat_jid: JID_CLIENTE,
    tipo_chat: "PRIVADO",
    remetente: REMETENTE_CLIENTE,
    contato: CONTATO_CLIENTE,
    texto: null,
    legenda: null,
    midia: null,
    localizacao: null,
    vcards: [],
    citacao: null,
    alvo: null,
    mencoes: [],
    origem: "CLIENTE",
    timestamp_wa: TIMESTAMP,
    ...campos,
  };
}

// ---------- cada tipo de payload ----------

test("texto (conversation) produz TEXTO com o remetente, o contato e a origem CLIENTE", () => {
  const msg = mensagemWa({ conversation: "Bom dia, *preciso* de ajuda 🙂" });
  assert.deepEqual(normalizarSemBruto(msg), esperadoPrivado(msg, { tipo: "TEXTO", texto: "Bom dia, *preciso* de ajuda 🙂" }));
});

test("texto em extendedTextMessage também é TEXTO", () => {
  const msg = mensagemWa({ extendedTextMessage: { text: "segue o link https://exemplo.com" } });
  const r = normalizarSemBruto(msg);
  assert.equal(r.tipo, "TEXTO");
  assert.equal(r.texto, "segue o link https://exemplo.com");
});

test("imagem com legenda produz IMAGEM com legenda e os metadados da mídia (sem baixar nada)", () => {
  const msg = mensagemWa({
    imageMessage: {
      mimetype: "image/jpeg",
      fileLength: long(48213),
      caption: "print do erro",
      mediaKey: Buffer.from("chave-fake"),
      jpegThumbnail: new Uint8Array([1, 2, 3]),
    },
  });
  assert.deepEqual(
    normalizarSemBruto(msg),
    esperadoPrivado(msg, {
      tipo: "IMAGEM",
      legenda: "print do erro",
      midia: { mimetype: "image/jpeg", tamanho_bytes: 48213, nome_arquivo: null, duracao_segundos: null, ptt: false, gif: false },
    })
  );
});

test("áudio PTT produz AUDIO com ptt verdadeiro e a duração declarada", () => {
  const msg = mensagemWa({ audioMessage: { mimetype: "audio/ogg; codecs=opus", fileLength: "15320", seconds: 9, ptt: true } });
  assert.deepEqual(
    normalizarSemBruto(msg),
    esperadoPrivado(msg, {
      tipo: "AUDIO",
      midia: { mimetype: "audio/ogg; codecs=opus", tamanho_bytes: 15320, nome_arquivo: null, duracao_segundos: 9, ptt: true, gif: false },
    })
  );
});

test("arquivo de áudio que não é nota de voz tem ptt falso", () => {
  const msg = mensagemWa({ audioMessage: { mimetype: "audio/mpeg", fileLength: 100, seconds: 3 } });
  assert.equal(normalizarSemBruto(msg).midia.ptt, false);
});

test("documento PDF com legenda (documentWithCaptionMessage) produz DOCUMENTO com o nome do arquivo", () => {
  const msg = mensagemWa({
    documentWithCaptionMessage: {
      message: {
        documentMessage: { mimetype: "application/pdf", fileLength: 2048, fileName: "nota-fiscal.pdf", caption: "segue a nota" },
      },
    },
  });
  assert.deepEqual(
    normalizarSemBruto(msg),
    esperadoPrivado(msg, {
      tipo: "DOCUMENTO",
      legenda: "segue a nota",
      midia: { mimetype: "application/pdf", tamanho_bytes: 2048, nome_arquivo: "nota-fiscal.pdf", duracao_segundos: null, ptt: false, gif: false },
    })
  );
});

test("documento sem legenda (documentMessage) também é DOCUMENTO", () => {
  const msg = mensagemWa({ documentMessage: { mimetype: "application/pdf", fileLength: 10, fileName: "boleto.pdf" } });
  const r = normalizarSemBruto(msg);
  assert.equal(r.tipo, "DOCUMENTO");
  assert.equal(r.legenda, null);
  assert.equal(r.midia.nome_arquivo, "boleto.pdf");
});

test("vídeo produz VIDEO com legenda e duração", () => {
  const msg = mensagemWa({ videoMessage: { mimetype: "video/mp4", fileLength: 900000, seconds: 12, caption: "veja" } });
  assert.deepEqual(
    normalizarSemBruto(msg),
    esperadoPrivado(msg, {
      tipo: "VIDEO",
      legenda: "veja",
      midia: { mimetype: "video/mp4", tamanho_bytes: 900000, nome_arquivo: null, duracao_segundos: 12, ptt: false, gif: false },
    })
  );
});

test("GIF (videoMessage com gifPlayback) é VIDEO com midia.gif verdadeiro; vídeo comum e ptvMessage sem gifPlayback têm gif falso", () => {
  const gif = normalizarSemBruto(mensagemWa({ videoMessage: { mimetype: "video/mp4", fileLength: 1000, seconds: 2, gifPlayback: true } }));
  assert.equal(gif.tipo, "VIDEO");
  assert.equal(gif.midia.gif, true);
  const ptvGif = normalizarSemBruto(mensagemWa({ ptvMessage: { mimetype: "video/mp4", fileLength: 1000, gifPlayback: true } }));
  assert.equal(ptvGif.midia.gif, true);
  assert.equal(normalizarSemBruto(mensagemWa({ videoMessage: { mimetype: "video/mp4", fileLength: 1000, gifPlayback: false } })).midia.gif, false);
  assert.equal(normalizarSemBruto(mensagemWa({ videoMessage: { mimetype: "video/mp4", fileLength: 1000 } })).midia.gif, false);
  assert.equal(normalizarSemBruto(mensagemWa({ stickerMessage: { mimetype: "image/webp", gifPlayback: true } })).midia.gif, false);
  assert.equal(normalizarSemBruto(mensagemWa({ imageMessage: { mimetype: "image/jpeg", gifPlayback: true } })).midia.gif, false);
});

test("figurinha produz FIGURINHA com os metadados", () => {
  const msg = mensagemWa({ stickerMessage: { mimetype: "image/webp", fileLength: 5120 } });
  assert.deepEqual(
    normalizarSemBruto(msg),
    esperadoPrivado(msg, {
      tipo: "FIGURINHA",
      midia: { mimetype: "image/webp", tamanho_bytes: 5120, nome_arquivo: null, duracao_segundos: null, ptt: false, gif: false },
    })
  );
});

test("localização produz LOCALIZACAO com latitude, longitude, nome e endereço", () => {
  const msg = mensagemWa({
    locationMessage: { degreesLatitude: -23.5, degreesLongitude: -46.6, name: "Escritório", address: "Rua Fictícia, 100" },
  });
  assert.deepEqual(
    normalizarSemBruto(msg),
    esperadoPrivado(msg, {
      tipo: "LOCALIZACAO",
      localizacao: { latitude: -23.5, longitude: -46.6, nome: "Escritório", endereco: "Rua Fictícia, 100", ao_vivo: false },
    })
  );
});

test("localização em tempo real também é LOCALIZACAO (ao_vivo)", () => {
  const msg = mensagemWa({ liveLocationMessage: { degreesLatitude: 1, degreesLongitude: 2 } });
  const r = normalizarSemBruto(msg);
  assert.equal(r.tipo, "LOCALIZACAO");
  assert.deepEqual(r.localizacao, { latitude: 1, longitude: 2, nome: null, endereco: null, ao_vivo: true });
});

test("vCard produz CONTATO com o nome e o vCard; vários contatos viram vários vcards", () => {
  const vcard = "BEGIN:VCARD\nVERSION:3.0\nFN:Fulano Teste\nTEL;waid=5511900000003:+55 11 90000-0003\nEND:VCARD";
  const um = mensagemWa({ contactMessage: { displayName: "Fulano Teste", vcard } });
  assert.deepEqual(normalizarSemBruto(um), esperadoPrivado(um, { tipo: "CONTATO", vcards: [{ nome: "Fulano Teste", vcard }] }));

  const varios = mensagemWa({
    contactsArrayMessage: {
      displayName: "2 contatos",
      contacts: [
        { displayName: "A", vcard: "BEGIN:VCARD\nFN:A\nEND:VCARD" },
        { displayName: "B", vcard: "BEGIN:VCARD\nFN:B\nEND:VCARD" },
      ],
    },
  });
  const r = normalizarSemBruto(varios);
  assert.equal(r.tipo, "CONTATO");
  assert.deepEqual(r.vcards.map((/** @type {any} */ v) => v.nome), ["A", "B"]);
});

test("reação produz REACAO com o emoji e a mensagem alvo; reação removida tem texto vazio", () => {
  const msg = mensagemWa({ reactionMessage: { key: { remoteJid: JID_CLIENTE, fromMe: true, id: "3EB0ALVO0001" }, text: "👍" } });
  assert.deepEqual(normalizarSemBruto(msg), esperadoPrivado(msg, { tipo: "REACAO", texto: "👍", alvo: { mensagem_wa_id: "3EB0ALVO0001" } }));

  const removida = mensagemWa({ reactionMessage: { key: { remoteJid: JID_CLIENTE, fromMe: true, id: "3EB0ALVO0001" }, text: "" } });
  assert.equal(normalizarSemBruto(removida).texto, "");
});

test("citação preenche citacao.mensagem_wa_id com o stanzaId (texto e mídia) e as menções", () => {
  const msg = mensagemWa({
    extendedTextMessage: {
      text: "isso aqui @5511900000002",
      contextInfo: { stanzaId: "3EB0CITADA01", participant: JID_PARTICIPANTE, mentionedJid: [JID_PARTICIPANTE] },
    },
  });
  assert.deepEqual(
    normalizarSemBruto(msg),
    esperadoPrivado(msg, {
      tipo: "TEXTO",
      texto: "isso aqui @5511900000002",
      citacao: { mensagem_wa_id: "3EB0CITADA01" },
      mencoes: [JID_PARTICIPANTE],
    })
  );

  const imagem = mensagemWa({ imageMessage: { mimetype: "image/png", caption: "esse", contextInfo: { stanzaId: "3EB0CITADA02" } } });
  assert.deepEqual(normalizarSemBruto(imagem).citacao, { mensagem_wa_id: "3EB0CITADA02" });
});

test("edição produz EDICAO com o novo texto e a mensagem alvo (com e sem o envelope editedMessage)", () => {
  const protocolo = { key: { remoteJid: JID_CLIENTE, fromMe: false, id: "3EB0ORIGINAL" }, type: 14, editedMessage: { conversation: "texto corrigido" } };
  const comEnvelope = mensagemWa({ editedMessage: { message: { protocolMessage: protocolo } } });
  assert.deepEqual(
    normalizarSemBruto(comEnvelope),
    esperadoPrivado(comEnvelope, { tipo: "EDICAO", texto: "texto corrigido", alvo: { mensagem_wa_id: "3EB0ORIGINAL" } })
  );

  const direta = mensagemWa({ protocolMessage: protocolo });
  assert.equal(normalizarSemBruto(direta).tipo, "EDICAO");

  const legenda = mensagemWa({ protocolMessage: { ...protocolo, editedMessage: { imageMessage: { caption: "nova legenda" } } } });
  const r = normalizarSemBruto(legenda);
  assert.equal(r.texto, null);
  assert.equal(r.legenda, "nova legenda");
});

test("exclusão (protocolMessage REVOKE) produz EXCLUSAO com a mensagem alvo", () => {
  const msg = mensagemWa({ protocolMessage: { key: { remoteJid: JID_CLIENTE, fromMe: false, id: "3EB0APAGADA1" }, type: 0 } });
  assert.deepEqual(normalizarSemBruto(msg), esperadoPrivado(msg, { tipo: "EXCLUSAO", alvo: { mensagem_wa_id: "3EB0APAGADA1" } }));
});

test("conteúdo em mensagem temporária (ephemeralMessage) ou de visualização única é desembrulhado", () => {
  const temporaria = mensagemWa({ ephemeralMessage: { message: { extendedTextMessage: { text: "some em 7 dias" } } } });
  assert.equal(normalizarSemBruto(temporaria).texto, "some em 7 dias");
  const unica = mensagemWa({ viewOnceMessageV2: { message: { imageMessage: { mimetype: "image/jpeg", fileLength: 1 } } } });
  assert.equal(normalizarSemBruto(unica).tipo, "IMAGEM");
});

// ---------- grupo ----------

test("mensagem em @g.us identifica o grupo e o participante remetente (telefone e LID)", () => {
  const msg = mensagemGrupo({ conversation: "bom dia, grupo" });
  assert.deepEqual(normalizarSemBruto(msg), {
    ...esperadoPrivado(msg, { tipo: "TEXTO", texto: "bom dia, grupo" }),
    chat_jid: JID_GRUPO,
    tipo_chat: "GRUPO",
    remetente: { jid: JID_PARTICIPANTE, lid: LID_PARTICIPANTE, telefone: TELEFONE_PARTICIPANTE, nome: "Participante Teste" },
    contato: null,
  });
});

test("participante de grupo em @lid usa o participantPn como telefone", () => {
  const msg = mensagemGrupo(
    { conversation: "oi" },
    { key: { participant: "100000000000002:5@lid", participantLid: undefined, participantPn: JID_PARTICIPANTE } }
  );
  assert.deepEqual(normalizarSemBruto(msg).remetente, {
    jid: LID_PARTICIPANTE,
    lid: LID_PARTICIPANTE,
    telefone: TELEFONE_PARTICIPANTE,
    nome: "Participante Teste",
  });
});

test("mensagem de grupo enviada pelo aparelho tem origem APARELHO e o grupo como chat", () => {
  const msg = mensagemGrupo({ conversation: "respondendo pelo celular" }, { key: { fromMe: true, participant: EU.jid, participantLid: EU.lid }, pushName: null });
  const r = normalizarSemBruto(msg, { eu: EU });
  assert.equal(r.origem, "APARELHO");
  assert.equal(r.tipo_chat, "GRUPO");
  assert.equal(r.chat_jid, JID_GRUPO);
  assert.equal(r.remetente.telefone, TELEFONE_EQUIPE);
});

// ---------- aparelho (fromMe) ----------

test("fromMe digitada no aparelho vira origem APARELHO, com a equipe como remetente e o cliente como contato", () => {
  const msg = mensagemWa({ conversation: "enviado pelo celular" }, { key: { fromMe: true }, pushName: null });
  assert.deepEqual(
    normalizarSemBruto(msg, { eu: EU }),
    esperadoPrivado(msg, {
      tipo: "TEXTO",
      texto: "enviado pelo celular",
      origem: "APARELHO",
      remetente: { jid: `${TELEFONE_EQUIPE}@s.whatsapp.net`, lid: "100000000000099@lid", telefone: TELEFONE_EQUIPE, nome: null },
    })
  );
});

test("fromMe em @lid nunca usa o senderPn como telefone do contato (ele é o número da equipe)", () => {
  const msg = mensagemWa(
    { conversation: "oi" },
    { key: { remoteJid: LID_CLIENTE, fromMe: true, senderPn: `${TELEFONE_EQUIPE}@s.whatsapp.net` }, pushName: null }
  );
  const r = normalizarSemBruto(msg, { eu: EU });
  assert.deepEqual(r.contato, { jid: LID_CLIENTE, lid: LID_CLIENTE, telefone: null });
  assert.equal(r.origem, "APARELHO");
});

// ---------- LID ----------

test("mensagem @lid sem senderPn é normalizada pelo LID (telefone null), sem ser descartada", () => {
  const msg = mensagemWa({ conversation: "oi" }, { key: { remoteJid: LID_CLIENTE } });
  const r = normalizarSemBruto(msg);
  assert.equal(r.chat_jid, LID_CLIENTE);
  assert.equal(r.tipo_chat, "PRIVADO");
  assert.deepEqual(r.remetente, { jid: LID_CLIENTE, lid: LID_CLIENTE, telefone: null, nome: "Cliente Teste" });
  assert.deepEqual(r.contato, { jid: LID_CLIENTE, lid: LID_CLIENTE, telefone: null });
});

test("mensagem @lid com senderPn traz o telefone; @s.whatsapp.net com senderLid traz o LID", () => {
  const lid = mensagemWa({ conversation: "oi" }, { key: { remoteJid: LID_CLIENTE, senderPn: JID_CLIENTE } });
  assert.deepEqual(normalizarSemBruto(lid).remetente, { jid: LID_CLIENTE, lid: LID_CLIENTE, telefone: TELEFONE_CLIENTE, nome: "Cliente Teste" });

  const pn = mensagemWa({ conversation: "oi" }, { key: { senderLid: LID_CLIENTE } });
  assert.deepEqual(normalizarSemBruto(pn).contato, { jid: JID_CLIENTE, lid: LID_CLIENTE, telefone: TELEFONE_CLIENTE });
});

// ---------- ignoradas ----------

test("status, broadcast, newsletter, sem conteúdo, sem id e protocolo sem conteúdo útil são ignorados (null)", () => {
  const texto = { conversation: "oi" };
  assert.equal(normalizarMensagem(mensagemWa(texto, { key: { remoteJid: "status@broadcast", participant: JID_CLIENTE } })), null);
  assert.equal(normalizarMensagem(mensagemWa(texto, { key: { remoteJid: "1700000000@broadcast" } })), null);
  assert.equal(normalizarMensagem(mensagemWa(texto, { key: { remoteJid: "120363000000000009@newsletter" } })), null);
  assert.equal(normalizarMensagem(mensagemWa(undefined)), null, "stub sem message");
  assert.equal(normalizarMensagem(mensagemWa(texto, { key: { id: "" } })), null);
  assert.equal(normalizarMensagem(mensagemWa({ protocolMessage: { type: 3, ephemeralExpiration: 86400 } })), null);
  assert.equal(normalizarMensagem(mensagemWa({ senderKeyDistributionMessage: { groupId: JID_GRUPO } })), null);
  assert.equal(normalizarMensagem(null), null);
  assert.equal(normalizarMensagem({}), null);
});

test("conversa do número com ele mesmo é ignorada", () => {
  const msg = mensagemWa({ conversation: "nota" }, { key: { remoteJid: `${TELEFONE_EQUIPE}@s.whatsapp.net`, fromMe: true } });
  assert.equal(normalizarMensagem(msg, { eu: EU }), null);
});

// ---------- key e bruto ----------

test("key guarda o necessário para citar e reagir depois, e bruto é o WAMessage serializável em JSON", () => {
  const msg = mensagemGrupo({
    imageMessage: { mimetype: "image/jpeg", fileLength: long(10), mediaKey: Buffer.from("chave"), jpegThumbnail: new Uint8Array([9, 8]) },
  });
  const r = normalizarMensagem(msg);
  assert.ok(r);
  assert.deepEqual(r.key, {
    remoteJid: JID_GRUPO,
    fromMe: false,
    id: msg.key.id,
    participant: JID_PARTICIPANTE,
    participantLid: LID_PARTICIPANTE,
  });

  const json = JSON.parse(JSON.stringify(r.bruto));
  assert.deepEqual(json, r.bruto, "bruto é JSON puro (sem Buffer, Long nem função)");
  assert.deepEqual(json.key, r.key);
  assert.equal(json.messageTimestamp, TIMESTAMP);
  assert.equal(json.pushName, "Participante Teste");
  // Buffers no formato do BufferJSON do Baileys (base64), para reconstruir o WAMessage depois.
  assert.deepEqual(json.message.imageMessage.mediaKey, { type: "Buffer", data: Buffer.from("chave").toString("base64") });
  assert.deepEqual(json.message.imageMessage.jpegThumbnail, { type: "Buffer", data: Buffer.from([9, 8]).toString("base64") });
  assert.equal(json.message.imageMessage.fileLength, 10);
});

test("normalizarMensagem é pura: não altera o payload recebido", () => {
  const msg = mensagemWa({ imageMessage: { mimetype: "image/jpeg", fileLength: long(10), caption: "x" } });
  const antes = JSON.stringify(msg);
  normalizarMensagem(msg, { eu: EU });
  assert.equal(JSON.stringify(msg), antes);
  assert.deepEqual(normalizarMensagem(msg, { eu: EU }), normalizarMensagem(msg, { eu: EU }));
});

test("34.2 regressão: stub CALL_MISSED_*, message.call e registro de chamada (callLogMesssage, inclusive embrulhado) continuam fora do normalizarMensagem", () => {
  const chave = { remoteJid: JID_CLIENTE, fromMe: false };
  const casos = [
    { key: { ...chave, id: "3EB0R00001" }, messageStubType: 40, messageTimestamp: TIMESTAMP },
    { key: { ...chave, id: "3EB0R00002" }, messageStubType: 41, messageTimestamp: TIMESTAMP },
    { key: { ...chave, id: "3EB0R00003" }, messageStubType: 45, messageTimestamp: TIMESTAMP },
    { key: { ...chave, id: "3EB0R00004" }, message: { call: { callKey: Buffer.from("k") } }, messageTimestamp: TIMESTAMP },
    { key: { ...chave, fromMe: true, id: "3EB0R00005" }, message: { callLogMesssage: { callOutcome: 0, isVideo: true, durationSecs: 3 } }, messageTimestamp: TIMESTAMP },
    { key: { ...chave, fromMe: true, id: "3EB0R00006" }, message: { ephemeralMessage: { message: { callLogMesssage: { callOutcome: 1 } } } }, messageTimestamp: TIMESTAMP },
  ];
  for (const caso of casos) assert.equal(normalizarMensagem(caso, { eu: EU }), null, caso.key.id);
});

// ---------- botões, listas, modelos e respostas (viram TEXTO) ----------

const { chavesDescartadas } = require("../../src/whatsapp/filtroEntrada");

/** @param {any} message @param {any} [opcoes] */
const textoDe = (message, opcoes) => normalizarSemBruto(mensagemWa(message), opcoes);

/** @param {string} nome @param {any} params */
const nativo = (nome, params) => ({ name: nome, buttonParamsJson: typeof params === "string" ? params : JSON.stringify(params) });

const MENSAGEM_BOT = {
  interactiveMessage: {
    body: { text: "Bem-vindo(a)! Como podemos ajudar?" },
    footer: { text: "Escolha uma opção" },
    nativeFlowMessage: {
      buttons: [
        nativo("quick_reply", { display_text: "Já sou cliente", id: "1" }),
        nativo("quick_reply", { display_text: "Quero contratar", id: "2" }),
      ],
    },
  },
};

test("interactiveMessage com quick_reply vira TEXTO com o corpo, o rodapé e as opções listadas", () => {
  const r = textoDe(MENSAGEM_BOT);
  assert.equal(r.tipo, "TEXTO");
  assert.equal(r.texto, "Bem-vindo(a)! Como podemos ajudar?\n\nEscolha uma opção\n\n[Opções]\n• Já sou cliente\n• Quero contratar");
  assert.equal(r.midia, null);
  assert.equal(r.origem, "CLIENTE");
});

test("interactiveMessage: título, subtítulo, cta_url, cta_call, single_select; botão com JSON inválido ou sem rótulo é ignorado", () => {
  const r = textoDe({
    interactiveMessage: {
      header: { title: "Título", subtitle: "Subtítulo", imageMessage: { mimetype: "image/jpeg" } },
      body: { text: "Corpo" },
      nativeFlowMessage: {
        buttons: [
          nativo("cta_url", { display_text: "Site", url: "https://exemplo.com.br" }),
          nativo("cta_url", { display_text: "Sem link" }),
          nativo("cta_url", { url: "https://sem-rotulo.com.br" }),
          nativo("cta_call", { display_text: "Ligar", phone_number: "+5511900000000" }),
          nativo("cta_copy", { display_text: "Copiar código", copy_code: "123" }),
          nativo("single_select", { title: "Menu", sections: [{ rows: [{ title: "Financeiro" }, { title: "Suporte" }, {}] }, null, {}] }),
          nativo("single_select", { sections: "x" }),
          nativo("quick_reply", "{não é json"),
          nativo("quick_reply", "42"),
          nativo("quick_reply", { id: "sem-rotulo" }),
          { name: "quick_reply" },
          null,
        ],
      },
    },
  });
  assert.equal(
    r.texto,
    "[Anexo não exibido]\n\nTítulo\n\nSubtítulo\n\nCorpo\n\n[Opções]\n• Site: https://exemplo.com.br\n• Sem link\n• https://sem-rotulo.com.br\n• Ligar: +5511900000000\n• Copiar código\n• Financeiro\n• Suporte"
  );
  assert.ok(!r.texto.includes("Menu"), "o title do single_select é o botão que abre a lista, não uma opção");
  assert.equal(r.midia, null, "a mídia do cabeçalho não é baixada: só o texto entra");
});

test("mídia no cabeçalho: [Anexo não exibido] vira a primeira parte (interactive, buttons, hydratedTemplate e hydratedFourRowTemplate); sozinho, não justifica registrar", () => {
  for (const midia of ["imageMessage", "videoMessage", "documentMessage"]) {
    const no = { [midia]: { mimetype: "x/y" } };
    assert.equal(textoDe({ interactiveMessage: { header: no, body: { text: "Oi" } } }).texto, "[Anexo não exibido]\n\nOi", `interactive ${midia}`);
    assert.equal(textoDe({ buttonsMessage: { ...no, contentText: "Oi" } }).texto, "[Anexo não exibido]\n\nOi", `buttons ${midia}`);
    assert.equal(textoDe({ templateMessage: { hydratedTemplate: { ...no, hydratedContentText: "Oi" } } }).texto, "[Anexo não exibido]\n\nOi", `hydrated ${midia}`);
    assert.equal(textoDe({ templateMessage: { hydratedFourRowTemplate: { ...no, hydratedContentText: "Oi" } } }).texto, "[Anexo não exibido]\n\nOi", `fourRow ${midia}`);
  }
  assert.equal(
    textoDe({ interactiveMessage: { header: { imageMessage: {} }, nativeFlowMessage: { buttons: [nativo("quick_reply", { display_text: "Sim" })] } } }).texto,
    "[Anexo não exibido]\n\n[Opções]\n• Sim"
  );
  // Só o marcador, sem texto nem opção: continua descartada.
  assert.equal(normalizarMensagem(mensagemWa({ interactiveMessage: { header: { imageMessage: {} } } })), null);
  assert.equal(normalizarMensagem(mensagemWa({ buttonsMessage: { documentMessage: {} } })), null);
  assert.equal(normalizarMensagem(mensagemWa({ templateMessage: { hydratedTemplate: { videoMessage: {} } } })), null);
});

test("nó vazio não esconde o seguinte: interactiveMessage vazio + buttonsMessage com texto; templateMessage cai de um formato para o outro", () => {
  const vazio = { interactiveMessage: { body: { text: " " } } };
  assert.equal(textoDe({ ...vazio, buttonsMessage: { contentText: "Olá", buttons: [{ buttonText: { displayText: "Sim" } }] } }).texto, "Olá\n\n[Opções]\n• Sim");

  const interativo = MENSAGEM_BOT.interactiveMessage;
  assert.equal(textoDe({ templateMessage: { interactiveMessageTemplate: { body: {} }, hydratedTemplate: { hydratedContentText: "Do hydrated" } } }).texto, "Do hydrated");
  assert.equal(textoDe({ templateMessage: { hydratedTemplate: { hydratedButtons: [{}] }, hydratedFourRowTemplate: { hydratedContentText: "Do four row" } } }).texto, "Do four row");
  assert.equal(textoDe({ templateMessage: { interactiveMessageTemplate: { body: {} }, hydratedTemplate: {}, hydratedFourRowTemplate: { hydratedContentText: "Do four row" } } }).texto, "Do four row");
  assert.equal(textoDe({ templateMessage: { interactiveMessageTemplate: interativo, hydratedTemplate: { hydratedContentText: "ignorado" } } }).texto, textoDe(MENSAGEM_BOT).texto);
});

test("JSON com __proto__ em buttonParamsJson e paramsJson: rótulo ignorado e Object.prototype intacto", () => {
  const envenenado = '{"__proto__":{"display_text":"x","title":"x"}}';
  assert.equal(normalizarMensagem(mensagemWa({ interactiveMessage: { nativeFlowMessage: { buttons: [nativo("quick_reply", envenenado)] } } })), null);
  assert.equal(normalizarMensagem(mensagemWa({ interactiveResponseMessage: { nativeFlowResponseMessage: { paramsJson: envenenado } } })), null);
  assert.equal(/** @type {any} */ ({}).display_text, undefined);
  assert.equal(/** @type {any} */ ({}).title, undefined);
});

test("mensagem só com botões, sem corpo, vira TEXTO só com as opções", () => {
  const r = textoDe({ interactiveMessage: { nativeFlowMessage: { buttons: [nativo("quick_reply", { display_text: "Sim" })] } } });
  assert.equal(r.texto, "[Opções]\n• Sim");
});

test("mensagem interativa sem texto e sem opção é descartada", () => {
  assert.equal(normalizarMensagem(mensagemWa({ interactiveMessage: { body: { text: "  " } } })), null);
  assert.equal(normalizarMensagem(mensagemWa({ interactiveMessage: { nativeFlowMessage: { buttons: [nativo("quick_reply", "x")] } } })), null);
  assert.equal(normalizarMensagem(mensagemWa({ buttonsMessage: {} })), null);
  assert.equal(normalizarMensagem(mensagemWa({ listMessage: { sections: [] } })), null);
  assert.equal(normalizarMensagem(mensagemWa({ templateMessage: {} })), null);
  assert.equal(normalizarMensagem(mensagemWa({ buttonsResponseMessage: {} })), null);
  assert.equal(normalizarMensagem(mensagemWa({ interactiveResponseMessage: { nativeFlowResponseMessage: { paramsJson: "{}" } } })), null);
});

test("buttonsMessage: texto, corpo, rodapé e botões", () => {
  const r = textoDe({
    buttonsMessage: {
      text: "Atendimento",
      contentText: "Como posso ajudar?",
      footerText: "Ápice",
      buttons: [{ buttonText: { displayText: "Suporte" } }, { buttonText: { displayText: "Vendas" } }, {}],
    },
  });
  assert.equal(r.texto, "Atendimento\n\nComo posso ajudar?\n\nÁpice\n\n[Opções]\n• Suporte\n• Vendas");
});

test("templateMessage: hydratedTemplate com resposta rápida, link e ligação; hydratedFourRowTemplate; interactiveMessageTemplate", () => {
  const hidratado = {
    hydratedTitleText: "Pedido",
    hydratedContentText: "Seu pedido saiu",
    hydratedFooterText: "Obrigado",
    hydratedButtons: [
      { quickReplyButton: { displayText: "Rastrear", id: "a" } },
      { urlButton: { displayText: "Ver site", url: "https://exemplo.com.br/p" } },
      { callButton: { displayText: "Ligar", phoneNumber: "+5511900000000" } },
      { index: 3 },
      null,
    ],
  };
  const esperado = "Pedido\n\nSeu pedido saiu\n\nObrigado\n\n[Opções]\n• Rastrear\n• Ver site: https://exemplo.com.br/p\n• Ligar: +5511900000000";
  assert.equal(textoDe({ templateMessage: { hydratedTemplate: hidratado } }).texto, esperado);
  assert.equal(textoDe({ templateMessage: { hydratedFourRowTemplate: hidratado } }).texto, esperado);
  assert.equal(textoDe({ templateMessage: { interactiveMessageTemplate: MENSAGEM_BOT.interactiveMessage } }).texto, textoDe(MENSAGEM_BOT).texto);
});

test("listMessage: título, descrição, rodapé e linhas (com descrição entre parênteses)", () => {
  const r = textoDe({
    listMessage: {
      title: "Menu",
      description: "Escolha",
      footerText: "Rodapé",
      buttonText: "Ver opções",
      sections: [
        { title: "A", rows: [{ title: "Financeiro", description: "Boletos" }, { title: "Suporte" }, { description: "sem título" }] },
        { rows: [{ title: "Vendas", description: "  " }] },
      ],
    },
  });
  assert.equal(r.texto, "Menu\n\nEscolha\n\nRodapé\n\n[Opções]\n• Financeiro (Boletos)\n• Suporte\n• Vendas");
});

test("respostas a botão, modelo, lista e fluxo nativo viram TEXTO só com o rótulo escolhido", () => {
  assert.equal(textoDe({ buttonsResponseMessage: { selectedButtonId: "1", selectedDisplayText: "Já sou cliente" } }).texto, "Já sou cliente");
  assert.equal(textoDe({ templateButtonReplyMessage: { selectedId: "1", selectedDisplayText: "Rastrear" } }).texto, "Rastrear");
  assert.equal(textoDe({ listResponseMessage: { title: "Financeiro", description: "Boletos", singleSelectReply: { selectedRowId: "x" } } }).texto, "Financeiro");
  assert.equal(textoDe({ interactiveResponseMessage: { body: { text: "Quero contratar" }, nativeFlowResponseMessage: { name: "quick_reply", paramsJson: '{"id":"2"}' } } }).texto, "Quero contratar");
  assert.equal(textoDe({ interactiveResponseMessage: { nativeFlowResponseMessage: { paramsJson: '{"id":"2","title":"Suporte"}' } } }).texto, "Suporte");
  assert.equal(textoDe({ interactiveResponseMessage: { nativeFlowResponseMessage: { paramsJson: '{"display_text":"Vendas"}' } } }).texto, "Vendas");
  assert.equal(textoDe({ interactiveResponseMessage: { nativeFlowResponseMessage: { paramsJson: '{"text":"Outro"}' } } }).texto, "Outro");
});

test("resposta a botão guarda a citação (stanzaId da mensagem de botões) e as menções", () => {
  const r = textoDe({
    buttonsResponseMessage: {
      selectedDisplayText: "Quero contratar",
      contextInfo: { stanzaId: "3EB0BOTOES01", mentionedJid: [`${TELEFONE_PARTICIPANTE}:3@s.whatsapp.net`] },
    },
  });
  assert.deepEqual(r.citacao, { mensagem_wa_id: "3EB0BOTOES01" });
  assert.deepEqual(r.mencoes, [JID_PARTICIPANTE]);
  assert.deepEqual(textoDe({ interactiveMessage: { ...MENSAGEM_BOT.interactiveMessage, contextInfo: { stanzaId: "3EB0X" } } }).citacao, { mensagem_wa_id: "3EB0X" });
});

test("origem APARELHO: resposta a botão digitada no celular da equipe", () => {
  const msg = mensagemWa({ buttonsResponseMessage: { selectedDisplayText: "Sim" } }, { key: { fromMe: true }, pushName: null });
  const r = normalizarSemBruto(msg, { eu: EU });
  assert.equal(r.origem, "APARELHO");
  assert.equal(r.tipo, "TEXTO");
  assert.equal(r.texto, "Sim");
  assert.equal(r.remetente.nome, null);
});

test("envelopes (viewOnce, ephemeral, viewOnceV2) em volta do interactiveMessage são tirados", () => {
  const esperado = textoDe(MENSAGEM_BOT).texto;
  assert.equal(textoDe({ viewOnceMessage: { message: { messageContextInfo: { deviceListMetadata: {} }, ...MENSAGEM_BOT } } }).texto, esperado);
  assert.equal(textoDe({ ephemeralMessage: { message: MENSAGEM_BOT } }).texto, esperado);
  assert.equal(textoDe({ ephemeralMessage: { message: { viewOnceMessageV2: { message: MENSAGEM_BOT } } } }).texto, esperado);
});

test("enquete continua descartada (fora do escopo)", () => {
  assert.equal(normalizarMensagem(mensagemWa({ pollCreationMessageV3: { name: "Qual?", options: [{ optionName: "A" }] } })), null);
  assert.equal(normalizarMensagem(mensagemWa({ pollUpdateMessage: {} })), null);
});

test("chavesDescartadas devolve só nomes de formatos desconhecidos, sem ruído esperado nem valores", () => {
  const msg = (/** @type {any} */ message) => mensagemWa(message);
  assert.deepEqual(chavesDescartadas(msg({ eventMessage: { name: "segredo" }, messageContextInfo: {}, senderKeyDistributionMessage: {} })), ["eventMessage"]);
  assert.deepEqual(chavesDescartadas(msg({ ephemeralMessage: { message: { orderMessage: {}, productMessage: {} } } })), ["orderMessage", "productMessage"]);
  assert.deepEqual(chavesDescartadas(msg({ eventMessage: undefined, groupInviteMessage: null })), []);
  for (const ruido of ["protocolMessage", "reactionMessage", "pollUpdateMessage", "pollCreationMessage", "pollCreationMessageV3", "keepInChatMessage", "pinInChatMessage", "call", "callLogMesssage"]) {
    assert.deepEqual(chavesDescartadas(msg({ [ruido]: {} })), [], ruido);
  }
  assert.deepEqual(chavesDescartadas(mensagemWa(undefined)), [], "stub sem message");
  assert.deepEqual(chavesDescartadas(null), []);
  assert.deepEqual(chavesDescartadas({ message: "texto" }), []);
});

test("chavesDescartadas: formato tratado que não rendeu texto aparece (resposta sem texto legível, interactiveMessage vazio ou só com mídia no cabeçalho)", () => {
  const resposta = mensagemWa({ interactiveResponseMessage: { nativeFlowResponseMessage: { paramsJson: '{"id":"2"}' } } });
  assert.equal(normalizarMensagem(resposta), null);
  assert.deepEqual(chavesDescartadas(resposta), ["interactiveResponseMessage"]);

  const vazio = mensagemWa({ interactiveMessage: { nativeFlowMessage: { buttons: [] } } });
  assert.equal(normalizarMensagem(vazio), null);
  assert.deepEqual(chavesDescartadas(vazio), ["interactiveMessage"]);

  const soMidia = mensagemWa({ viewOnceMessage: { message: { interactiveMessage: { header: { imageMessage: { mimetype: "image/jpeg" } } } } } });
  assert.equal(normalizarMensagem(soMidia), null);
  assert.deepEqual(chavesDescartadas(soMidia), ["interactiveMessage"]);
});

test("chavesDescartadas: chat que a entrada ignora (status, broadcast, conversa do número com ele mesmo, sem id) não gera log", () => {
  const texto = { conversation: "oi" };
  assert.deepEqual(chavesDescartadas(mensagemWa(texto, { key: { remoteJid: "status@broadcast", participant: JID_CLIENTE } })), []);
  assert.deepEqual(chavesDescartadas(mensagemWa(texto, { key: { remoteJid: "120363000000000009@newsletter" } })), []);
  assert.deepEqual(chavesDescartadas(mensagemWa(texto, { key: { id: "" } })), []);
  const propria = mensagemWa(texto, { key: { remoteJid: `${TELEFONE_EQUIPE}@s.whatsapp.net`, fromMe: true } });
  assert.deepEqual(chavesDescartadas(propria, { eu: EU }), []);
  assert.deepEqual(chavesDescartadas(mensagemWa({ conversation: "" , eventMessage: {} })), ["conversation", "eventMessage"]);
});
