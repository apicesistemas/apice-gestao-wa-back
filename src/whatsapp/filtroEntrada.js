// @ts-check
// Normalização pura da entrada (base: filtroEntrada do apice-financeiro-wa-wa-back). Recebe um
// WAMessage do `messages.upsert` do Baileys 6.7.24 e devolve a MensagemRecebida que vai ao back,
// ou `null` quando a mensagem não é registrada. Nada é baixado nem consultado aqui: a mídia vai só
// com os metadados (o download é da Task 4.2), e a resolução de LID ↔ telefone que depende de
// cache ou de rede fica no resolverLid.
//
// Diferenças em relação às referências (que só aceitam conversa individual):
// - grupos (`@g.us`) são registrados, com o participante remetente;
// - todos os tipos são registrados (figurinha, localização, vCard, reação, edição, exclusão);
// - `fromMe` (celular ou WhatsApp Web da equipe) vira `origem: APARELHO`; quem separa o eco dos
//   envios do CRM é o registroAparelho;
// - `@lid` sem telefone não é descartado: a mensagem fica identificada pelo LID.
// Status, broadcast e newsletter continuam ignorados.

/** @typedef {"GRUPO" | "PRIVADO"} TipoChat */
/**
 * @typedef {"TEXTO" | "IMAGEM" | "VIDEO" | "AUDIO" | "DOCUMENTO" | "FIGURINHA" | "LOCALIZACAO" | "CONTATO"
 *   | "REACAO" | "EDICAO" | "EXCLUSAO"} TipoMensagem
 */
/** @typedef {"CLIENTE" | "APARELHO"} OrigemMensagem */
/** @typedef {{ jid: string | null, lid: string | null, telefone: string | null }} Identidade */
/** @typedef {Identidade & { nome: string | null }} Remetente */
/**
 * @typedef {{
 *   mimetype: string | null,
 *   tamanho_bytes: number | null,
 *   nome_arquivo: string | null,
 *   duracao_segundos: number | null,
 *   ptt: boolean,
 *   gif: boolean,
 * }} MetadadosMidia
 */
/**
 * @typedef {{
 *   latitude: number | null,
 *   longitude: number | null,
 *   nome: string | null,
 *   endereco: string | null,
 *   ao_vivo: boolean,
 * }} Localizacao
 */
/**
 * @typedef {{
 *   remoteJid: string,
 *   fromMe: boolean,
 *   id: string,
 *   participant?: string,
 *   senderPn?: string,
 *   senderLid?: string,
 *   participantPn?: string,
 *   participantLid?: string,
 * }} ChaveMensagem
 */
/**
 * @typedef {{
 *   mensagem_wa_id: string,
 *   chat_jid: string,
 *   tipo_chat: TipoChat,
 *   remetente: Remetente,
 *   contato: Identidade | null,
 *   tipo: TipoMensagem,
 *   texto: string | null,
 *   legenda: string | null,
 *   midia: MetadadosMidia | null,
 *   localizacao: Localizacao | null,
 *   vcards: { nome: string | null, vcard: string | null }[],
 *   citacao: { mensagem_wa_id: string } | null,
 *   alvo: { mensagem_wa_id: string } | null,
 *   mencoes: string[],
 *   origem: OrigemMensagem,
 *   timestamp_wa: number | null,
 *   key: ChaveMensagem,
 *   bruto: any,
 * }} MensagemRecebida
 */
/** @typedef {{ jid?: string | null, lid?: string | null }} IdentidadePropria */

/** Charset aceito pelo back para o id da mensagem: ASCII visível, sem espaço nem controle. */
const PADRAO_ID_MENSAGEM = /^[\x21-\x7e]{1,128}$/;
const PADRAO_LID = /^\d{1,25}@lid$/;
const PADRAO_TELEFONE_JID = /^(\d{8,15})@s\.whatsapp\.net$/;
const PADRAO_GRUPO = /^[\d-]{1,40}@g\.us$/;

/** Envelopes que só embrulham o conteúdo real em `<envelope>.message` (mesma lista do Baileys). */
const ENVELOPES = [
  "ephemeralMessage",
  "viewOnceMessage",
  "viewOnceMessageV2",
  "viewOnceMessageV2Extension",
  "documentWithCaptionMessage",
  "editedMessage",
];

/** `proto.Message.ProtocolMessage.Type` (número decodificado ou nome, se vier de JSON). */
const PROTOCOLO_REVOKE = new Set([0, "REVOKE"]);
const PROTOCOLO_EDICAO = new Set([14, "MESSAGE_EDIT"]);

/** Campos da `key` que o Baileys precisa para citar, reagir e baixar a mídia depois. */
const CAMPOS_KEY = /** @type {const} */ (["participant", "senderPn", "senderLid", "participantPn", "participantLid"]);

/**
 * @param {unknown} id
 * @returns {id is string}
 */
function mensagemWaIdValido(id) {
  return typeof id === "string" && PADRAO_ID_MENSAGEM.test(id);
}

/**
 * `usuario@dominio` sem o sufixo de aparelho (`:n`): `5511...:7@s.whatsapp.net` → `5511...@s.whatsapp.net`.
 * @param {unknown} jid
 * @returns {string | null}
 */
function normalizarJid(jid) {
  if (typeof jid !== "string") return null;
  const arroba = jid.indexOf("@");
  if (arroba <= 0) return null;
  const usuario = jid.slice(0, arroba).split(":")[0];
  const dominio = jid.slice(arroba + 1).toLowerCase();
  return usuario && dominio ? `${usuario}@${dominio}` : null;
}

/**
 * `<dígitos>@lid` sem o sufixo de aparelho, ou null se não for LID.
 * @param {unknown} jid
 * @returns {string | null}
 */
function lidDe(jid) {
  const n = normalizarJid(jid);
  return n && PADRAO_LID.test(n) ? n : null;
}

/**
 * Telefone (só dígitos, com DDI) de um JID `...@s.whatsapp.net`, ou null.
 * @param {unknown} jid
 * @returns {string | null}
 */
function telefoneDe(jid) {
  const n = normalizarJid(jid);
  return n?.match(PADRAO_TELEFONE_JID)?.[1] ?? null;
}

/**
 * @param {string | null} jid já normalizado
 * @returns {TipoChat | null}
 */
function tipoDoChat(jid) {
  if (!jid) return null;
  if (PADRAO_GRUPO.test(jid)) return "GRUPO";
  if (lidDe(jid) || telefoneDe(jid)) return "PRIVADO";
  return null; // status, broadcast, newsletter e qualquer outro domínio
}

/**
 * @param {unknown} valor
 * @returns {string | null}
 */
function texto(valor) {
  return typeof valor === "string" && valor !== "" ? valor : null;
}

/**
 * @param {unknown} valor
 * @returns {number | null}
 */
function numero(valor) {
  return typeof valor === "number" && Number.isFinite(valor) ? valor : null;
}

/**
 * Long do protobufjs (`{ low, high, unsigned }`, com ou sem `toNumber`).
 * @param {any} valor
 * @returns {boolean}
 */
function ehLong(valor) {
  return (
    valor !== null &&
    typeof valor === "object" &&
    Number.isInteger(valor.low) &&
    Number.isInteger(valor.high) &&
    (typeof valor.toNumber === "function" || typeof valor.unsigned === "boolean")
  );
}

/**
 * Inteiro não negativo vindo como number, string numérica ou Long; inválido → null.
 * @param {any} valor
 * @returns {number | null}
 */
function inteiroDe(valor) {
  /** @type {number | null} */
  let n = null;
  if (typeof valor === "number") n = valor;
  else if (typeof valor === "string" && /^\d+$/.test(valor)) n = Number(valor);
  else if (valor && typeof valor.toNumber === "function") n = valor.toNumber();
  else if (ehLong(valor)) n = (valor.high >>> 0) * 2 ** 32 + (valor.low >>> 0);
  return n !== null && Number.isSafeInteger(n) && n >= 0 ? n : null;
}

/**
 * Cópia do WAMessage em JSON puro, reversível pelo `BufferJSON.reviver` do Baileys: Buffer e
 * Uint8Array viram `{ type: "Buffer", data: <base64> }`, Long vira número, função e `undefined` somem.
 * @param {any} valor
 * @param {WeakSet<object>} [emAndamento] guarda contra ciclo
 * @returns {any}
 */
function paraJson(valor, emAndamento = new WeakSet()) {
  if (valor === null || typeof valor === "string" || typeof valor === "boolean") return valor;
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : null;
  if (typeof valor === "bigint") return Number.isSafeInteger(Number(valor)) ? Number(valor) : valor.toString();
  if (typeof valor !== "object") return undefined;
  if (valor instanceof Uint8Array) {
    return { type: "Buffer", data: Buffer.from(valor.buffer, valor.byteOffset, valor.byteLength).toString("base64") };
  }
  if (valor.type === "Buffer" && Array.isArray(valor.data)) return { type: "Buffer", data: Buffer.from(valor.data).toString("base64") };
  if (ehLong(valor)) {
    const n = typeof valor.toNumber === "function" ? valor.toNumber() : inteiroDe(valor);
    return Number.isSafeInteger(n) ? n : String(valor);
  }
  if (emAndamento.has(valor)) return null;
  emAndamento.add(valor);
  /** @type {any} */
  let copia;
  if (Array.isArray(valor)) {
    copia = valor.map((item) => paraJson(item, emAndamento) ?? null);
  } else {
    copia = {};
    for (const [chave, item] of Object.entries(valor)) {
      const convertido = paraJson(item, emAndamento);
      if (convertido !== undefined) copia[chave] = convertido;
    }
  }
  emAndamento.delete(valor);
  return copia;
}

/**
 * Tira os envelopes (temporária, visualização única, documento com legenda, edição).
 * @param {any} conteudo
 * @returns {any}
 */
function desembrulhar(conteudo) {
  let atual = conteudo;
  for (let i = 0; i < 5; i += 1) {
    const envelope = ENVELOPES.map((nome) => atual?.[nome]).find((e) => e && typeof e === "object" && e.message);
    if (!envelope) break;
    atual = envelope.message;
  }
  return atual;
}

/**
 * @param {any} m conteúdo já desembrulhado
 * @returns {string | null}
 */
function textoDe(m) {
  return texto(m?.conversation) ?? texto(m?.extendedTextMessage?.text);
}

/**
 * @param {any} no nó da mídia (`imageMessage`, `audioMessage`...)
 * @param {boolean} [ptt]
 * @param {boolean} [gif] verdadeiro só para vídeo com `gifPlayback === true` (GIF do WhatsApp: mp4 sem áudio)
 * @returns {MetadadosMidia}
 */
function metadadosMidia(no, ptt = false, gif = false) {
  return {
    mimetype: texto(no.mimetype),
    tamanho_bytes: inteiroDe(no.fileLength),
    nome_arquivo: texto(no.fileName),
    duracao_segundos: inteiroDe(no.seconds),
    ptt,
    gif,
  };
}

/**
 * Citação e menções do `contextInfo` do nó da mensagem.
 * @param {any} no
 * @returns {{ citacao: { mensagem_wa_id: string } | null, mencoes: string[] }}
 */
function contexto(no) {
  const info = no?.contextInfo;
  const citada = info?.stanzaId;
  const mencoes = Array.isArray(info?.mentionedJid) ? info.mentionedJid.map(normalizarJid).filter(Boolean) : [];
  return { citacao: mensagemWaIdValido(citada) ? { mensagem_wa_id: citada } : null, mencoes };
}

/**
 * Menções do conteúdo editado: o `contextInfo` do texto (`extendedTextMessage`) ou, na edição de
 * legenda, o do nó da mídia (imagem, vídeo, documento). O `documentWithCaptionMessage` já vem
 * desembrulhado em `documentMessage`. `protocolMessage.editedMessage` é um `Message` direto.
 * @param {any} editado conteúdo já desembrulhado
 * @returns {string[]}
 */
function mencoesDaEdicao(editado) {
  for (const no of [editado?.extendedTextMessage, editado?.imageMessage, editado?.videoMessage, editado?.documentMessage]) {
    const { mencoes } = contexto(no);
    if (mencoes.length > 0) return mencoes;
  }
  return [];
}

/**
 * Nó da mídia com legenda (imagem, vídeo, documento) de um conteúdo, para a legenda editada.
 * @param {any} m
 * @returns {string | null}
 */
function legendaDe(m) {
  return texto(m?.imageMessage?.caption) ?? texto(m?.videoMessage?.caption) ?? texto(m?.documentMessage?.caption);
}

/**
 * @typedef {{
 *   tipo: TipoMensagem,
 *   texto?: string | null,
 *   legenda?: string | null,
 *   midia?: MetadadosMidia | null,
 *   localizacao?: Localizacao | null,
 *   vcards?: { nome: string | null, vcard: string | null }[],
 *   citacao?: { mensagem_wa_id: string } | null,
 *   alvo?: { mensagem_wa_id: string } | null,
 *   mencoes?: string[],
 * }} Conteudo
 */

/**
 * @param {unknown} valor
 * @returns {string | null} texto aparado, ou null se vazio
 */
function limpo(valor) {
  return typeof valor === "string" && valor.trim() !== "" ? valor.trim() : null;
}

/**
 * @param {unknown} valor
 * @returns {any[]}
 */
function lista(valor) {
  return Array.isArray(valor) ? valor : [];
}

/**
 * @param {unknown} json
 * @returns {any} objeto, ou null se não for um JSON de objeto
 */
function lerJson(json) {
  if (typeof json !== "string") return null;
  try {
    const valor = JSON.parse(json);
    return valor && typeof valor === "object" ? valor : null;
  } catch {
    return null;
  }
}

/** "Rótulo: valor" (link, telefone); sem rótulo, só o valor; sem os dois, null. @param {unknown} rotulo @param {unknown} valor */
function rotuloComValor(rotulo, valor) {
  const r = limpo(rotulo);
  const v = limpo(valor);
  return r && v ? `${r}: ${v}` : (r ?? v);
}

/** Aviso fixo quando o cabeçalho traz imagem, vídeo ou documento (a mídia do cabeçalho não é baixada). */
const MARCADOR_ANEXO = "[Anexo não exibido]";

/** @param {any} no nó que pode ter mídia no cabeçalho */
function temMidiaNoCabecalho(no) {
  return Boolean(no?.imageMessage || no?.videoMessage || no?.documentMessage);
}

/**
 * Partes não vazias separadas por linha em branco e, no fim, o bloco "[Opções]" com um marcador por opção.
 * @param {unknown[]} partes título, corpo, rodapé...
 * @param {unknown[]} [opcoes] rótulos dos botões ou das linhas da lista
 * @param {boolean} [comAnexo] acrescenta o `MARCADOR_ANEXO` como primeira parte, mas só se houver texto ou opção
 * @returns {string | null} null sem nenhum texto e sem nenhuma opção
 */
function textoInterativo(partes, opcoes = [], comAnexo = false) {
  const blocos = partes.map(limpo).filter((p) => p !== null);
  const itens = opcoes.map(limpo).filter((o) => o !== null);
  if (itens.length > 0) blocos.push(`[Opções]\n${itens.map((o) => `• ${o}`).join("\n")}`);
  if (blocos.length === 0) return null; // só o marcador não justifica registrar
  if (comAnexo) blocos.unshift(MARCADOR_ANEXO);
  return blocos.join("\n\n");
}

/** Rótulos dos botões do `nativeFlowMessage` (`buttonParamsJson` é string JSON; inválido = botão ignorado). @param {any[]} botoes */
function opcoesNativas(botoes) {
  return botoes.flatMap((botao) => {
    const p = lerJson(botao?.buttonParamsJson);
    if (!p) return [];
    // `title` é o rótulo do botão que abre a lista (como o `buttonText` do listMessage): só as linhas viram opções.
    if (botao.name === "single_select") return lista(p.sections).flatMap((s) => lista(s?.rows).map((r) => r?.title));
    if (botao.name === "cta_url") return [rotuloComValor(p.display_text, p.url)];
    if (botao.name === "cta_call") return [rotuloComValor(p.display_text, p.phone_number)];
    return [p.display_text];
  });
}

/** @param {any} botao `TemplateButton` do `hydratedButtons` */
function opcaoDoModelo(botao) {
  if (botao?.quickReplyButton) return botao.quickReplyButton.displayText;
  if (botao?.urlButton) return rotuloComValor(botao.urlButton.displayText, botao.urlButton.url);
  if (botao?.callButton) return rotuloComValor(botao.callButton.displayText, botao.callButton.phoneNumber);
  return null;
}

/** @param {any} no `interactiveMessage` */
const interativa = (no) =>
  textoInterativo(
    [no.header?.title, no.header?.subtitle, no.body?.text, no.footer?.text],
    opcoesNativas(lista(no.nativeFlowMessage?.buttons)),
    temMidiaNoCabecalho(no.header)
  );

/** @param {any} no `buttonsMessage` */
const comBotoes = (no) =>
  textoInterativo([no.text, no.contentText, no.footerText], lista(no.buttons).map((b) => b?.buttonText?.displayText), temMidiaNoCabecalho(no));

/** @param {any} t `hydratedTemplate` ou `hydratedFourRowTemplate` (pode ser undefined) */
const hidratado = (t) =>
  textoInterativo(
    [t?.hydratedTitleText, t?.hydratedContentText, t?.hydratedFooterText],
    lista(t?.hydratedButtons).map(opcaoDoModelo),
    temMidiaNoCabecalho(t)
  );

/** @param {any} no `templateMessage`: o primeiro dos três formatos que render texto */
const modelo = (no) =>
  (no.interactiveMessageTemplate ? interativa(no.interactiveMessageTemplate) : null) ??
  hidratado(no.hydratedTemplate) ??
  hidratado(no.hydratedFourRowTemplate);

/** @param {any} no `listMessage` */
function listaDeOpcoes(no) {
  const opcoes = lista(no.sections).flatMap((s) =>
    lista(s?.rows).map((r) => {
      const descricao = limpo(r?.description);
      return limpo(r?.title) && descricao ? `${limpo(r.title)} (${descricao})` : r?.title;
    })
  );
  return textoInterativo([no.title, no.description, no.footerText], opcoes);
}

/** Resposta de `interactiveMessage`: o corpo; sem ele, um texto legível do `paramsJson`. @param {any} no */
function respostaInterativa(no) {
  const p = lerJson(no.nativeFlowResponseMessage?.paramsJson);
  return limpo(no.body?.text) ?? limpo(p?.title) ?? limpo(p?.display_text) ?? limpo(p?.text);
}

/** Mensagens com botões, lista e modelo, e as respostas a elas, lidas como texto. `[campo do proto, leitor do texto]`. */
const FORMATOS_INTERATIVOS = /** @type {[string, (no: any) => string | null][]} */ ([
  ["interactiveMessage", interativa],
  ["buttonsMessage", comBotoes],
  ["templateMessage", modelo],
  ["listMessage", listaDeOpcoes],
  ["buttonsResponseMessage", (no) => limpo(no.selectedDisplayText)],
  ["templateButtonReplyMessage", (no) => limpo(no.selectedDisplayText)],
  ["listResponseMessage", (no) => limpo(no.title)],
  ["interactiveResponseMessage", respostaInterativa],
]);

/**
 * @param {any} m conteúdo já desembrulhado
 * @returns {Conteudo | null} TEXTO do primeiro formato que render texto; null se nenhum rendeu
 */
function extrairInterativo(m) {
  for (const [campo, ler] of FORMATOS_INTERATIVOS) {
    const no = m[campo];
    if (!no || typeof no !== "object") continue;
    const conteudo = ler(no);
    if (conteudo !== null) return { tipo: "TEXTO", texto: conteudo, ...contexto(no) };
  }
  return null;
}

/**
 * Filtro comum da entrada e do log de descarte: id válido e chat de grupo ou privado, fora a conversa do
 * número da equipe com ele mesmo. Status, broadcast e newsletter não passam.
 * @param {any} key `key` do WAMessage
 * @param {IdentidadePropria | null | undefined} eu
 * @returns {{ chatJid: string, tipoChat: TipoChat } | null} null quando o chat é ignorado
 */
function chatRegistravel(key, eu) {
  if (!key || typeof key !== "object" || !mensagemWaIdValido(key.id) || typeof key.remoteJid !== "string") return null;
  const chatJid = normalizarJid(key.remoteJid);
  const tipoChat = tipoDoChat(chatJid);
  if (!chatJid || !tipoChat) return null;
  const proprio = identidadePropria(eu);
  if (tipoChat === "PRIVADO" && (chatJid === proprio.jid || chatJid === proprio.lid)) return null;
  return { chatJid, tipoChat };
}

/** Ruído esperado (nada para o atendente): metadados, chaves de grupo, reação, protocolo, enquete, fixar/manter e chamada. */
const CHAVES_RUIDO = new Set([
  "messageContextInfo", "senderKeyDistributionMessage", "protocolMessage", "reactionMessage", "pollUpdateMessage",
  "keepInChatMessage", "pinInChatMessage", "call", "callLogMesssage",
]);

/**
 * Nomes (só os nomes) das chaves do conteúdo de uma mensagem que `normalizarMensagem` devolveu null, para o log
 * de descarte. Formato tratado que chega aqui é porque nada foi extraído (ex.: resposta sem texto legível), e
 * aparece de propósito. Vazio para stub sem `message`, chat que a entrada ignora (status, broadcast, conversa
 * do número com ele mesmo), ruído esperado e enquete (`pollCreationMessage*`). Nunca devolve valores.
 * @param {any} waMessage
 * @param {{ eu?: IdentidadePropria | null }} [opcoes] mesmo `eu` do `normalizarMensagem`
 * @returns {string[]}
 */
function chavesDescartadas(waMessage, { eu } = {}) {
  if (!chatRegistravel(waMessage?.key, eu)) return [];
  const m = desembrulhar(waMessage.message);
  if (!m || typeof m !== "object") return [];
  return Object.entries(m)
    .filter(([chave, valor]) => valor != null && !CHAVES_RUIDO.has(chave) && !chave.startsWith("pollCreationMessage"))
    .map(([chave]) => chave);
}

/**
 * Tipo e campos de conteúdo; null para o que não é registrado (protocolo sem conteúdo útil,
 * distribuição de chave, enquete, stub sem `message`, mensagem de botões sem nenhum texto).
 * @param {any} m conteúdo já desembrulhado
 * @returns {Conteudo | null}
 */
function extrairConteudo(m) {
  if (!m || typeof m !== "object") return null;

  const protocolo = m.protocolMessage;
  if (protocolo) {
    const alvo = protocolo.key?.id;
    if (!mensagemWaIdValido(alvo)) return null;
    if (PROTOCOLO_REVOKE.has(protocolo.type)) return { tipo: "EXCLUSAO", alvo: { mensagem_wa_id: alvo } };
    if (PROTOCOLO_EDICAO.has(protocolo.type)) {
      const editado = desembrulhar(protocolo.editedMessage);
      return {
        tipo: "EDICAO",
        texto: textoDe(editado),
        legenda: legendaDe(editado),
        alvo: { mensagem_wa_id: alvo },
        mencoes: mencoesDaEdicao(editado),
      };
    }
    return null;
  }

  if (m.reactionMessage) {
    const alvo = m.reactionMessage.key?.id;
    if (!mensagemWaIdValido(alvo)) return null;
    // Texto vazio = reação removida.
    const emoji = typeof m.reactionMessage.text === "string" ? m.reactionMessage.text : "";
    return { tipo: "REACAO", texto: emoji, alvo: { mensagem_wa_id: alvo } };
  }

  const conteudoTexto = textoDe(m);
  if (conteudoTexto !== null) return { tipo: "TEXTO", texto: conteudoTexto, ...contexto(m.extendedTextMessage) };

  if (m.imageMessage) return { tipo: "IMAGEM", legenda: texto(m.imageMessage.caption), midia: metadadosMidia(m.imageMessage), ...contexto(m.imageMessage) };
  const video = m.videoMessage ?? m.ptvMessage;
  if (video) return { tipo: "VIDEO", legenda: texto(video.caption), midia: metadadosMidia(video, false, video.gifPlayback === true), ...contexto(video) };
  if (m.audioMessage) return { tipo: "AUDIO", midia: metadadosMidia(m.audioMessage, m.audioMessage.ptt === true), ...contexto(m.audioMessage) };
  if (m.documentMessage) {
    return { tipo: "DOCUMENTO", legenda: texto(m.documentMessage.caption), midia: metadadosMidia(m.documentMessage), ...contexto(m.documentMessage) };
  }
  if (m.stickerMessage) return { tipo: "FIGURINHA", midia: metadadosMidia(m.stickerMessage), ...contexto(m.stickerMessage) };

  const local = m.locationMessage ?? m.liveLocationMessage;
  if (local) {
    return {
      tipo: "LOCALIZACAO",
      localizacao: {
        latitude: numero(local.degreesLatitude),
        longitude: numero(local.degreesLongitude),
        nome: texto(local.name),
        endereco: texto(local.address),
        ao_vivo: !m.locationMessage,
      },
      ...contexto(local),
    };
  }

  /** @param {any} c */
  const vcard = (c) => ({ nome: texto(c?.displayName), vcard: texto(c?.vcard) });
  if (m.contactMessage) return { tipo: "CONTATO", vcards: [vcard(m.contactMessage)], ...contexto(m.contactMessage) };
  if (Array.isArray(m.contactsArrayMessage?.contacts)) {
    return { tipo: "CONTATO", vcards: m.contactsArrayMessage.contacts.map(vcard), ...contexto(m.contactsArrayMessage) };
  }

  return extrairInterativo(m);
}

/**
 * Identidade de um JID, com o identificador alternativo que o Baileys manda na `key`
 * (`senderPn`/`participantPn` quando o JID é LID, `senderLid`/`participantLid` quando é telefone).
 * @param {unknown} jid
 * @param {unknown} [pnAlternativo]
 * @param {unknown} [lidAlternativo]
 * @returns {Identidade}
 */
function identidadeDe(jid, pnAlternativo, lidAlternativo) {
  const normalizado = normalizarJid(jid);
  return {
    jid: normalizado,
    lid: lidDe(normalizado) ?? lidDe(lidAlternativo),
    telefone: telefoneDe(normalizado) ?? telefoneDe(pnAlternativo),
  };
}

/**
 * Identidade do número da equipe (o socket: `sock.user.id` e `sock.user.lid`).
 * @param {IdentidadePropria | null | undefined} eu
 * @returns {Identidade}
 */
function identidadePropria(eu) {
  return { jid: normalizarJid(eu?.jid), lid: lidDe(eu?.lid), telefone: telefoneDe(eu?.jid) };
}

/**
 * @param {ChaveMensagem} key
 * @returns {ChaveMensagem}
 */
function copiarKey(key) {
  /** @type {ChaveMensagem} */
  const copia = { remoteJid: key.remoteJid, fromMe: key.fromMe === true, id: key.id };
  for (const campo of CAMPOS_KEY) {
    if (typeof key[campo] === "string" && key[campo] !== "") copia[campo] = key[campo];
  }
  return copia;
}

/**
 * Normaliza um WAMessage do `messages.upsert`. Função pura: não altera a entrada nem consulta nada.
 * @param {any} waMessage
 * @param {{ eu?: IdentidadePropria | null }} [opcoes] `eu`: número da equipe, para o remetente das
 *   mensagens do aparelho e para ignorar a conversa do número com ele mesmo
 * @returns {MensagemRecebida | null} null quando a mensagem não deve ser registrada
 */
function normalizarMensagem(waMessage, { eu } = {}) {
  const key = waMessage?.key;
  const chat = chatRegistravel(key, eu);
  if (!chat) return null;
  const { chatJid, tipoChat } = chat;
  const proprio = identidadePropria(eu);

  const conteudo = extrairConteudo(desembrulhar(waMessage.message));
  if (!conteudo) return null;

  const fromMe = key.fromMe === true;
  // Nome do perfil (pushName): só para exibição, nunca identifica o contato.
  const pushName = waMessage.pushName;
  const nome = !fromMe && typeof pushName === "string" && pushName.trim() !== "" ? pushName : null;

  /** @type {Remetente} */
  let remetente;
  /** @type {Identidade | null} */
  let contato = null;
  if (tipoChat === "GRUPO") {
    const participante = identidadeDe(key.participant ?? waMessage.participant, key.participantPn, key.participantLid);
    const base = fromMe
      ? { jid: participante.jid ?? proprio.jid, lid: participante.lid ?? proprio.lid, telefone: participante.telefone ?? proprio.telefone }
      : participante;
    remetente = { ...base, nome };
  } else if (fromMe) {
    // Em mensagem própria o `senderPn`/`senderLid` é o NÚMERO DA EQUIPE: nunca vira o contato.
    contato = identidadeDe(chatJid);
    remetente = { ...proprio, nome: null };
  } else {
    contato = identidadeDe(chatJid, key.senderPn, key.senderLid);
    remetente = { ...contato, nome };
  }

  return {
    mensagem_wa_id: key.id,
    chat_jid: chatJid,
    tipo_chat: tipoChat,
    remetente,
    contato,
    tipo: conteudo.tipo,
    texto: conteudo.texto ?? null,
    legenda: conteudo.legenda ?? null,
    midia: conteudo.midia ?? null,
    localizacao: conteudo.localizacao ?? null,
    vcards: conteudo.vcards ?? [],
    citacao: conteudo.citacao ?? null,
    alvo: conteudo.alvo ?? null,
    mencoes: conteudo.mencoes ?? [],
    origem: fromMe ? "APARELHO" : "CLIENTE",
    timestamp_wa: inteiroDe(waMessage.messageTimestamp),
    key: copiarKey(key),
    bruto: paraJson(waMessage),
  };
}

module.exports = { normalizarMensagem, chavesDescartadas, normalizarJid, lidDe, telefoneDe, mensagemWaIdValido, paraJson, desembrulhar };
