// @ts-check
// Adição de participantes (Fase 28, Task 28.1): consulta do número, mapa de status do IQ, adição em série
// com ritmo, convite v4 e aborto. O socket, o adapter e o relógio (`dormir`) são falsos; nenhum número
// real, nenhuma conexão real.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const baileysFalso = require("../helpers/baileysFalso");

baileysFalso.instalarBaileysFalso();
const {
  consultarNumero,
  mapearStatusAdicao,
  adicionarEmSerie,
  enviarConviteV4,
  dormirPadrao,
  ErroGrupo,
} = require("../../src/whatsapp/grupoGestao");
const { EU } = require("../helpers/mensagensWa");

const { criarGrupoFalso, conteudoComAddRequest } = baileysFalso;
const GRUPO = "120363000000000001@g.us";
const FONE_A = "5511900000010";
const FONE_B = "5511900000011";
const FONE_C = "5511900000012";
const JID_A = `${FONE_A}@s.whatsapp.net`;
const JID_B = `${FONE_B}@s.whatsapp.net`;
const JID_C = `${FONE_C}@s.whatsapp.net`;
const NUMEROS = { [FONE_A]: JID_A, [FONE_B]: JID_B, [FONE_C]: JID_C };

beforeEach(() => baileysFalso.limparHistorico());

/**
 * @param {{ participantes?: any[], numeros?: any, adds?: any, desconectado?: boolean, aoChamar?: (e: string) => void | Promise<void>, criacao?: any, falhaMetadata?: boolean }} [config]
 */
function montar({ participantes = [], numeros = NUMEROS, adds = {}, desconectado = false, aoChamar, criacao, falhaMetadata } = {}) {
  const grupo = criarGrupoFalso({ numeros, adds, aoChamar, participantes, criacao, falhaMetadata });
  const socket = { user: { id: EU.jid, lid: EU.lid }, ...grupo.metodos };
  /** @type {string[]} */
  const marcadas = [];
  const adapter = {
    socketConectado: () => (desconectado ? null : socket),
    obterParticipantesGrupo: async () => participantes,
    obterNomeGrupo: async () => "Suporte Loja Centro",
    marcarEnviadaPeloCrm: (/** @type {string} */ id) => {
      marcadas.push(id);
      grupo.chamadas.ordem.push("marcar");
    },
    guardarEnviada: () => {},
  };
  /** @type {number[]} */
  const pausas = [];
  const dormir = async (/** @type {number} */ segundos) => {
    pausas.push(segundos);
    grupo.chamadas.ordem.push("dormir");
  };
  return { grupo, socket, adapter, marcadas, pausas, dormir };
}

/** Captura console.log/error durante `corpo` e devolve as linhas. */
async function capturarConsole(/** @type {() => Promise<unknown>} */ corpo) {
  /** @type {string[]} */
  const linhas = [];
  const originais = { log: console.log, error: console.error };
  const gravar = (/** @type {any[]} */ ...args) => void linhas.push(args.map(String).join(" "));
  console.log = gravar;
  console.error = gravar;
  try {
    await corpo();
  } finally {
    console.log = originais.log;
    console.error = originais.error;
  }
  return linhas;
}

// ---------- mapearStatusAdicao ----------

test("200, 403 com add_request, 408, 409 e código desconhecido viram ADICIONADO, CONVITE_NECESSARIO, SAIU_RECENTEMENTE, JA_PARTICIPA e FALHA", () => {
  assert.equal(mapearStatusAdicao("200", undefined).status, "ADICIONADO");
  assert.equal(mapearStatusAdicao(200, undefined).status, "ADICIONADO", "número também é aceito");
  assert.equal(mapearStatusAdicao("408", undefined).status, "SAIU_RECENTEMENTE");
  assert.equal(mapearStatusAdicao("409", undefined).status, "JA_PARTICIPA");
  for (const desconhecido of ["500", "401", "", "abc", undefined, null, {}, 0]) {
    assert.equal(mapearStatusAdicao(desconhecido, undefined).status, "FALHA");
  }
  const r403 = mapearStatusAdicao("403", conteudoComAddRequest(JID_A, "CODIGO-FALSO", 1760000000));
  assert.deepEqual(r403, { status: "CONVITE_NECESSARIO", pedidoConvite: { inviteCode: "CODIGO-FALSO", inviteExpiration: 1760000000 } });
});

test("403 com content sem add_request ou em formato inesperado não quebra (CONVITE_NECESSARIO sem pedido)", () => {
  /** @type {any} */
  const ciclico = { tag: "participant", attrs: {}, content: [] };
  ciclico.content.push(ciclico);
  const formatos = [
    undefined,
    null,
    "texto",
    42,
    [],
    {},
    { tag: "participant", attrs: {}, content: "texto" },
    { tag: "participant", attrs: {}, content: [null, 3, "x"] },
    { tag: "participant", attrs: {}, content: [{ tag: "add_request", attrs: {} }] },
    { tag: "participant", attrs: {}, content: [{ tag: "add_request", attrs: { code: "", expiration: "10" } }] },
    { tag: "participant", attrs: {}, content: [{ tag: "add_request", attrs: { code: "X", expiration: "ontem" } }] },
    { tag: "participant", attrs: {}, content: [{ tag: "add_request", attrs: { code: "X", expiration: "-5" } }] },
    ciclico,
  ];
  for (const content of formatos) {
    assert.deepEqual(mapearStatusAdicao("403", content), { status: "CONVITE_NECESSARIO", pedidoConvite: null });
  }
});

test("o add_request é achado também quando o content já é o próprio nó ou está um nível abaixo", () => {
  const proprio = { tag: "add_request", attrs: { code: "ABC", expiration: "1760000001" } };
  assert.deepEqual(mapearStatusAdicao("403", proprio).pedidoConvite, { inviteCode: "ABC", inviteExpiration: 1760000001 });
  const aninhado = { tag: "participant", attrs: {}, content: [{ tag: "x", attrs: {}, content: [proprio] }] };
  assert.deepEqual(mapearStatusAdicao("403", aninhado).pedidoConvite, { inviteCode: "ABC", inviteExpiration: 1760000001 });
});

// ---------- consultarNumero ----------

test("consultarNumero devolve o jid REAL do onWhatsApp (9º dígito) e o LID quando vem", async () => {
  const { socket, grupo } = montar({ numeros: { [FONE_A]: { jid: "551100000010@s.whatsapp.net", lid: "100000000000010@lid" } } });
  const numero = await consultarNumero(socket, FONE_A);
  assert.deepEqual(numero, { jid: "551100000010@s.whatsapp.net", lid: "100000000000010@lid" });
  assert.deepEqual(grupo.chamadas.onWhatsApp, [[JID_A]], "um telefone por consulta");
});

test("consultarNumero: número omitido, exists false ou jid que não é de telefone → null", async () => {
  const { socket } = montar({ numeros: {} });
  assert.equal(await consultarNumero(socket, FONE_A), null);
  assert.equal(await consultarNumero({ onWhatsApp: async () => [{ jid: JID_A, exists: false }] }, FONE_A), null);
  assert.equal(await consultarNumero({ onWhatsApp: async () => [{ jid: "120363000000000001@g.us", exists: true }] }, FONE_A), null);
  assert.equal(await consultarNumero({ onWhatsApp: async () => undefined }, FONE_A), null);
  assert.equal(await consultarNumero({ onWhatsApp: async () => [null] }, FONE_A), null);
});

test("consultarNumero rejeita com o prazo técnico esgotado, com falha e sem onWhatsApp", async () => {
  await assert.rejects(consultarNumero({ onWhatsApp: () => new Promise(() => {}) }, FONE_A, { msPrazo: 15 }), { name: "TimeoutError" });
  await assert.rejects(consultarNumero({ onWhatsApp: async () => Promise.reject(new Error("boom")) }, FONE_A), { message: "boom" });
  await assert.rejects(consultarNumero({}, FONE_A));
});

// ---------- adicionarEmSerie ----------

test("o add usa o jid devolvido pelo onWhatsApp (9º dígito), nunca o digitado", async () => {
  const real = "551100000010@s.whatsapp.net";
  const { adapter, grupo, dormir } = montar({ numeros: { [FONE_A]: real } });
  const r = await adicionarEmSerie(adapter, GRUPO, [FONE_A], { segundosIntervalo: 5, dormir });
  assert.deepEqual(r, [{ telefone: FONE_A, status: "ADICIONADO", convite_enviado: false }]);
  assert.deepEqual(grupo.chamadas.add, [{ jid: GRUPO, alvos: [real], acao: "add" }]);
});

test("telefone ausente no onWhatsApp → SEM_WHATSAPP, sem IQ de adição e sem pausa", async () => {
  const { adapter, grupo, pausas, dormir } = montar({ numeros: {} });
  const r = await adicionarEmSerie(adapter, GRUPO, [FONE_A], { segundosIntervalo: 5, dormir });
  assert.deepEqual(r, [{ telefone: FONE_A, status: "SEM_WHATSAPP", convite_enviado: false }]);
  assert.equal(grupo.chamadas.add.length, 0);
  assert.deepEqual(pausas, []);
});

test("já participante (por telefone, pelo telefone real ou pelo LID) → JA_PARTICIPA, sem IQ", async () => {
  const participantes = [
    { jid: "100000000000001@lid", lid: "100000000000001@lid", telefone: FONE_A, admin: false },
    { jid: "551100000011@s.whatsapp.net", lid: null, telefone: "551100000011", admin: false },
    { jid: "100000000000012@lid", lid: "100000000000012@lid", telefone: null, admin: false },
  ];
  const numeros = {
    [FONE_A]: JID_A,
    [FONE_B]: "551100000011@s.whatsapp.net", // digitado com 9º dígito, real sem
    [FONE_C]: { jid: JID_C, lid: "100000000000012@lid" }, // só o LID bate
  };
  const { adapter, grupo, pausas, dormir } = montar({ participantes, numeros });
  const r = await adicionarEmSerie(adapter, GRUPO, [FONE_A, FONE_B, FONE_C], { segundosIntervalo: 5, dormir });
  assert.deepEqual(r.map((x) => x.status), ["JA_PARTICIPA", "JA_PARTICIPA", "JA_PARTICIPA"]);
  assert.equal(grupo.chamadas.add.length, 0);
  assert.deepEqual(pausas, [], "sem IQ não há pausa");
});

test("um IQ por telefone, com dormir(segundos_intervalo) depois de cada IQ; resposta na ordem da entrada", async () => {
  const { adapter, grupo, pausas, dormir } = montar({ numeros: { [FONE_A]: JID_A, [FONE_C]: JID_C } }); // B sem WhatsApp
  const r = await adicionarEmSerie(adapter, GRUPO, [FONE_A, FONE_B, FONE_C], { segundosIntervalo: 7, dormir });
  assert.deepEqual(r.map((x) => [x.telefone, x.status]), [
    [FONE_A, "ADICIONADO"],
    [FONE_B, "SEM_WHATSAPP"],
    [FONE_C, "ADICIONADO"],
  ]);
  assert.deepEqual(grupo.chamadas.add.map((c) => c.alvos), [[JID_A], [JID_C]]);
  assert.deepEqual(pausas, [7], "sem pausa depois do último telefone");
  assert.deepEqual(grupo.chamadas.ordem, ["onWhatsApp", "add", "dormir", "onWhatsApp", "onWhatsApp", "add"]);
});

test("os códigos do IQ viram os status do contrato, e a lista vazia ou o erro do add viram FALHA sem parar o laço", async () => {
  const adds = {
    [JID_A]: { status: "408" },
    [JID_B]: { status: "409" },
    [JID_C]: { status: "500" },
  };
  const { adapter, dormir } = montar({ adds });
  const r = await adicionarEmSerie(adapter, GRUPO, [FONE_A, FONE_B, FONE_C], { segundosIntervalo: 1, dormir });
  assert.deepEqual(r.map((x) => x.status), ["SAIU_RECENTEMENTE", "JA_PARTICIPA", "FALHA"]);

  const vazio = montar({ adds: { [JID_A]: [] } });
  const r2 = await adicionarEmSerie(vazio.adapter, GRUPO, [FONE_A, FONE_B], { segundosIntervalo: 1, dormir: vazio.dormir });
  assert.deepEqual(r2.map((x) => x.status), ["FALHA", "ADICIONADO"]);

  const erro = montar({ adds: { [JID_A]: Object.assign(new Error(`falha ${FONE_A}`), { name: "ErroDoBaileys" }) } });
  const linhas = await capturarConsole(async () => {
    const r3 = await adicionarEmSerie(erro.adapter, GRUPO, [FONE_A, FONE_B], { segundosIntervalo: 1, dormir: erro.dormir });
    assert.deepEqual(r3.map((x) => x.status), ["FALHA", "ADICIONADO"]);
  });
  assert.match(linhas.join("\n"), /ErroDoBaileys/);
  assert.doesNotMatch(linhas.join("\n"), new RegExp(FONE_A), "a mensagem do erro (com telefone) não vai ao log");
});

test("falha ou prazo do onWhatsApp → FALHA daquele telefone, sem IQ, e o laço segue", async () => {
  const { adapter, grupo, pausas, dormir } = montar({ numeros: { [FONE_A]: new Error("rede"), [FONE_B]: JID_B } });
  const r = await adicionarEmSerie(adapter, GRUPO, [FONE_A, FONE_B], { segundosIntervalo: 3, dormir });
  assert.deepEqual(r.map((x) => x.status), ["FALHA", "ADICIONADO"]);
  assert.deepEqual(grupo.chamadas.add.map((c) => c.alvos), [[JID_B]]);
  assert.deepEqual(pausas, [], "o único IQ é do último telefone");
});

test("prazo técnico do IQ de adição esgotado → FALHA", async () => {
  const { adapter, socket } = montar();
  socket.groupParticipantsUpdate = () => new Promise(() => {});
  const r = await adicionarEmSerie(adapter, GRUPO, [FONE_A], { segundosIntervalo: 0, dormir: async () => {}, msPrazoAdicao: 15 });
  assert.equal(r[0]?.status, "FALHA");
});

test("convite só com `convite` no corpo e só no 403 com add_request; o id é marcado ANTES do sendMessage", async () => {
  const content = conteudoComAddRequest(JID_A, "CODIGO-FALSO", 1760000000);
  const adds = { [JID_A]: { status: "403", content }, [JID_B]: { status: "403", content: { tag: "participant", attrs: {} } }, [JID_C]: { status: "200" } };

  const sem = montar({ adds });
  const rSem = await adicionarEmSerie(sem.adapter, GRUPO, [FONE_A], { segundosIntervalo: 1, dormir: sem.dormir });
  assert.deepEqual(rSem, [{ telefone: FONE_A, status: "CONVITE_NECESSARIO", convite_enviado: false }]);
  assert.equal(sem.grupo.chamadas.envios.length, 0, "sem `convite` não convida");

  const com = montar({ adds });
  const r = await adicionarEmSerie(com.adapter, GRUPO, [FONE_A, FONE_B, FONE_C], {
    segundosIntervalo: 1,
    convite: { texto: "Convite para o grupo de suporte." },
    dormir: com.dormir,
  });
  assert.deepEqual(r, [
    { telefone: FONE_A, status: "CONVITE_NECESSARIO", convite_enviado: true },
    { telefone: FONE_B, status: "CONVITE_NECESSARIO", convite_enviado: false },
    { telefone: FONE_C, status: "ADICIONADO", convite_enviado: false },
  ]);
  assert.equal(com.grupo.chamadas.envios.length, 1, "só o 403 com add_request convida");
  const envio = /** @type {any} */ (com.grupo.chamadas.envios[0]);
  assert.equal(envio.jid, JID_A, "o convite vai em mensagem privada ao jid do onWhatsApp");
  assert.deepEqual(envio.conteudo, {
    groupInvite: { jid: GRUPO, name: "Suporte Loja Centro", caption: "Convite para o grupo de suporte.", inviteCode: "CODIGO-FALSO", inviteExpiration: 1760000000 },
  });
  assert.equal(com.marcadas.length, 1);
  assert.equal(envio.opcoes.messageId, com.marcadas[0], "o id enviado é o marcado como do CRM");
  const ordem = com.grupo.chamadas.ordem;
  assert.ok(ordem.indexOf("marcar") < ordem.indexOf("sendMessage"), "marcarEnviadaPeloCrm antes do sendMessage");
  assert.deepEqual(com.pausas, [1, 1], "uma pausa por telefone com IQ, o convite na mesma pausa, e nenhuma depois do último");
});

test("falha no envio do convite: o telefone fica CONVITE_NECESSARIO sem convite_enviado e o laço segue", async () => {
  const adds = { [JID_A]: { status: "403", content: conteudoComAddRequest(JID_A, "CODIGO-FALSO", 1760000000) } };
  const m = montar({ adds });
  m.socket.sendMessage = async () => Promise.reject(Object.assign(new Error(`erro ${JID_A} CODIGO-FALSO`), { name: "ErroEnvioFalso" }));
  /** @type {any[]} */
  let r = [];
  const linhas = await capturarConsole(async () => {
    r = await adicionarEmSerie(m.adapter, GRUPO, [FONE_A, FONE_B], { segundosIntervalo: 1, convite: { texto: "Convite" }, dormir: m.dormir });
  });
  assert.deepEqual(r.map((x) => [x.status, x.convite_enviado]), [["CONVITE_NECESSARIO", false], ["ADICIONADO", false]]);
  assert.match(linhas.join("\n"), /ErroEnvioFalso/);
  assert.doesNotMatch(linhas.join("\n"), /CODIGO-FALSO|@s\.whatsapp\.net/);
});

test("abortar durante a pausa: o laço para em seguida e o restante sai NAO_PROCESSADO", async () => {
  const controlador = new AbortController();
  const m = montar();
  const dormir = async () => {
    m.grupo.chamadas.ordem.push("dormir");
    controlador.abort();
  };
  const r = await adicionarEmSerie(m.adapter, GRUPO, [FONE_A, FONE_B, FONE_C], { segundosIntervalo: 5, dormir, sinal: controlador.signal });
  assert.deepEqual(r.map((x) => x.status), ["ADICIONADO", "NAO_PROCESSADO", "NAO_PROCESSADO"]);
  assert.equal(m.grupo.chamadas.add.length, 1);
  assert.equal(m.grupo.chamadas.onWhatsApp.length, 1);
});

test("já abortada antes de começar: tudo NAO_PROCESSADO, sem consultar nem adicionar", async () => {
  const controlador = new AbortController();
  controlador.abort();
  const m = montar();
  const r = await adicionarEmSerie(m.adapter, GRUPO, [FONE_A, FONE_B], { segundosIntervalo: 5, dormir: m.dormir, sinal: controlador.signal });
  assert.deepEqual(r, [
    { telefone: FONE_A, status: "NAO_PROCESSADO", convite_enviado: false },
    { telefone: FONE_B, status: "NAO_PROCESSADO", convite_enviado: false },
  ]);
  assert.equal(m.grupo.chamadas.onWhatsApp.length + m.grupo.chamadas.add.length, 0);
});

/** Erro como o `assertNodeErrorFree` do Baileys 6.7.24: `new Boom(texto, { data: +codigo })` (statusCode 500, código em `data`). */
const boom = (/** @type {number} */ data, /** @type {string} */ texto) => Object.assign(new Error(texto), { data, output: { statusCode: 500 } });

test("limite de envio do WhatsApp (429) no add para o laço, lido de `data` do Boom real (statusCode 500), com qualquer texto", async () => {
  const formatos = [
    boom(429, "rate-overlimit"),
    boom(429, "texto diferente"),
    Object.assign(new Error("rate-overlimit"), { output: { statusCode: 429 } }),
    new Error("rate-overlimit"),
  ];
  for (const limite of formatos) {
    const m = montar({ adds: { [JID_A]: limite } });
    const r = await adicionarEmSerie(m.adapter, GRUPO, [FONE_A, FONE_B], { segundosIntervalo: 5, dormir: m.dormir });
    assert.deepEqual(r.map((x) => x.status), ["FALHA", "NAO_PROCESSADO"]);
    assert.equal(m.grupo.chamadas.add.length, 1);
  }
  const outro = montar({ adds: { [JID_A]: boom(500, "internal-server-error") } });
  const r2 = await adicionarEmSerie(outro.adapter, GRUPO, [FONE_A, FONE_B], { segundosIntervalo: 5, dormir: outro.dormir });
  assert.deepEqual(r2.map((x) => x.status), ["FALHA", "ADICIONADO"], "outro código não para o laço");
});

test("status do add que chega por exceção (Boom com `data` 403, 408 ou 409) vira o status do contrato, não FALHA", async () => {
  const m = montar({ adds: { [JID_A]: boom(403, "forbidden"), [JID_B]: boom(408, "x"), [JID_C]: boom(409, "conflict") } });
  const r = await adicionarEmSerie(m.adapter, GRUPO, [FONE_A, FONE_B, FONE_C], { segundosIntervalo: 1, convite: { texto: "Convite" }, dormir: m.dormir });
  assert.deepEqual(r.map((x) => [x.status, x.convite_enviado]), [["CONVITE_NECESSARIO", false], ["SAIU_RECENTEMENTE", false], ["JA_PARTICIPA", false]]);
  assert.equal(m.grupo.chamadas.envios.length, 0, "sem add_request não há convite");
});

test("abort durante o onWhatsApp: o telefone em andamento e o restante saem NAO_PROCESSADO, sem IQ de adição", async () => {
  const controlador = new AbortController();
  const m = montar({ aoChamar: (e) => (e === "onWhatsApp" ? controlador.abort() : undefined) });
  const r = await adicionarEmSerie(m.adapter, GRUPO, [FONE_A, FONE_B], { segundosIntervalo: 5, dormir: m.dormir, sinal: controlador.signal });
  assert.deepEqual(r.map((x) => x.status), ["NAO_PROCESSADO", "NAO_PROCESSADO"]);
  assert.equal(m.grupo.chamadas.add.length, 0);
  assert.equal(m.grupo.chamadas.onWhatsApp.length, 1);
});

test("abort durante o IQ de adição: sem convite para o telefone que acabou de ser adicionado", async () => {
  const controlador = new AbortController();
  const adds = { [JID_A]: { status: "403", content: conteudoComAddRequest(JID_A, "CODIGO-FALSO", 1760000000) } };
  const m = montar({ adds, aoChamar: (e) => (e === "add" ? controlador.abort() : undefined) });
  const r = await adicionarEmSerie(m.adapter, GRUPO, [FONE_A, FONE_B], { segundosIntervalo: 5, convite: { texto: "Convite" }, dormir: m.dormir, sinal: controlador.signal });
  assert.deepEqual(r.map((x) => [x.status, x.convite_enviado]), [["CONVITE_NECESSARIO", false], ["NAO_PROCESSADO", false]]);
  assert.equal(m.grupo.chamadas.envios.length, 0);
});

test("sem socket conectado a operação não começa (ErroGrupo DESCONECTADA)", async () => {
  const m = montar({ desconectado: true });
  await assert.rejects(adicionarEmSerie(m.adapter, GRUPO, [FONE_A], { segundosIntervalo: 1, dormir: m.dormir }), (erro) => erro instanceof ErroGrupo && erro.codigo === "DESCONECTADA");
});

test("os participantes são consultados uma vez só, mesmo com vários telefones", async () => {
  const m = montar();
  let consultas = 0;
  m.adapter.obterParticipantesGrupo = async () => {
    consultas += 1;
    return [];
  };
  await adicionarEmSerie(m.adapter, GRUPO, [FONE_A, FONE_B, FONE_C], { segundosIntervalo: 0, dormir: m.dormir });
  assert.equal(consultas, 1);
});

test("nenhum log leva telefone, JID, LID ou código de convite (sucesso, convite e falhas)", async () => {
  const adds = {
    [JID_A]: { status: "403", content: conteudoComAddRequest(JID_A, "CODIGO-FALSO", 1760000000) },
    [JID_B]: new Error(`falha ${FONE_B}`),
  };
  const m = montar({ adds, numeros: { ...NUMEROS, [FONE_C]: new Error(`rede ${FONE_C}`) } });
  const linhas = await capturarConsole(() => adicionarEmSerie(m.adapter, GRUPO, [FONE_A, FONE_B, FONE_C], { segundosIntervalo: 0, convite: { texto: "Convite" }, dormir: m.dormir }));
  assert.doesNotMatch(linhas.join("\n"), /\d{10,}|@lid|@s\.whatsapp\.net|@g\.us|CODIGO-FALSO/);
});

// ---------- enviarConviteV4 / dormirPadrao ----------

test("enviarConviteV4 sem conexão rejeita com DESCONECTADA e não marca nada", async () => {
  const m = montar({ desconectado: true });
  await assert.rejects(
    enviarConviteV4(m.adapter, JID_A, { inviteCode: "X", inviteExpiration: 1, chatJid: GRUPO, texto: "Convite" }),
    (erro) => erro instanceof ErroGrupo && erro.codigo === "DESCONECTADA"
  );
  assert.equal(m.marcadas.length, 0);
});

test("enviarConviteV4 sem nome do grupo usa 'Grupo'; prazo do sendMessage esgotado rejeita", async () => {
  const m = montar();
  await enviarConviteV4(m.adapter, JID_A, { inviteCode: "X", inviteExpiration: 1, chatJid: GRUPO, subject: null, texto: "Convite" });
  assert.equal(/** @type {any} */ (m.grupo.chamadas.envios[0]).conteudo.groupInvite.name, "Grupo");
  m.socket.sendMessage = () => new Promise(() => {});
  await assert.rejects(enviarConviteV4(m.adapter, JID_A, { inviteCode: "X", inviteExpiration: 1, chatJid: GRUPO, texto: "Convite" }, { msPrazo: 15 }), { name: "TimeoutError" });
});

test("dormirPadrao: espera, volta na hora quando o sinal aborta ou já está abortado, e ignora 0", async () => {
  const inicio = Date.now();
  await dormirPadrao(0.02);
  assert.ok(Date.now() - inicio >= 15);

  const controlador = new AbortController();
  const longa = dormirPadrao(60, controlador.signal);
  setTimeout(() => controlador.abort(), 10);
  const t0 = Date.now();
  await longa;
  assert.ok(Date.now() - t0 < 1000, "o aborto interrompe o sono");

  await dormirPadrao(60, controlador.signal); // já abortado
  await dormirPadrao(0);
});

// ---------- criarGrupo (Fase 29, Task 29.1, contrato D2) ----------

const { criarGrupo } = require("../../src/whatsapp/grupoGestao");
const { criarCacheNomeGrupo } = require("../../src/whatsapp/nomeGrupo");
const ID_NOVO = "120363000000000777@g.us";
const NOME = "Suporte Loja Nova";

/** Adapter com o cache de grupo REAL (aprender/obterParticipantes) sobre o socket falso. */
function montarCriacao(/** @type {Parameters<typeof montar>[0]} */ config = {}) {
  const base = montar(config);
  const nomes = criarCacheNomeGrupo();
  const adapter = {
    ...base.adapter,
    obterParticipantesGrupo: (/** @type {string} */ jid) => nomes.obterParticipantes(base.socket, jid),
    obterNomeGrupo: (/** @type {string} */ jid) => nomes.obterNome(base.socket, jid),
    aprenderGrupo: (/** @type {any} */ grupos) => nomes.aprender(grupos),
  };
  return { ...base, adapter, nomes };
}

test("nenhum telefone com WhatsApp → ErroGrupo SEM_PARTICIPANTE_VALIDO com os status, sem groupCreate", async () => {
  const m = montarCriacao({ numeros: { [FONE_A]: new Error("rede") } });
  await assert.rejects(
    criarGrupo(m.adapter, NOME, [FONE_A, FONE_B], { segundosIntervalo: 1, dormir: m.dormir }),
    (erro) =>
      erro instanceof ErroGrupo &&
      erro.codigo === "SEM_PARTICIPANTE_VALIDO" &&
      JSON.stringify(erro.participantes) ===
        JSON.stringify([
          { telefone: FONE_A, status: "FALHA", convite_enviado: false },
          { telefone: FONE_B, status: "SEM_WHATSAPP", convite_enviado: false },
        ])
  );
  assert.equal(m.grupo.chamadas.criacoes.length, 0);
});

test("groupCreate uma única vez, com o nome e UM jid (o real do 1º com WhatsApp); os anteriores ficam SEM_WHATSAPP", async () => {
  const real = "551100000011@s.whatsapp.net";
  const m = montarCriacao({ numeros: { [FONE_B]: real }, participantes: [{ id: real }] });
  const r = await criarGrupo(m.adapter, NOME, [FONE_A, FONE_B], { segundosIntervalo: 1, dormir: m.dormir });
  assert.deepEqual(m.grupo.chamadas.criacoes, [{ subject: NOME, participantes: [real] }]);
  assert.equal(r.chat_jid, ID_NOVO);
  assert.equal(r.nome_grupo, NOME);
  assert.deepEqual(r.participantes, [
    { telefone: FONE_A, status: "SEM_WHATSAPP", convite_enviado: false },
    { telefone: FONE_B, status: "ADICIONADO", convite_enviado: false },
  ]);
  assert.equal(m.grupo.chamadas.add.length, 0, "o 1º vai no groupCreate, não no add");
});

test("erro ou prazo esgotado do groupCreate → CRIACAO_NAO_CONFIRMADA, sem segunda tentativa e sem add", async () => {
  for (const criacao of [new Error("falha"), "travar", { id: "nao-e-um-grupo" }]) {
    const m = montarCriacao({ criacao });
    await assert.rejects(
      criarGrupo(m.adapter, NOME, [FONE_A, FONE_B], { segundosIntervalo: 1, dormir: m.dormir, msPrazoCriacao: 20 }),
      (erro) => erro instanceof ErroGrupo && erro.codigo === "CRIACAO_NAO_CONFIRMADA"
    );
    assert.equal(m.grupo.chamadas.criacoes.length, 1);
    assert.equal(m.grupo.chamadas.add.length, 0);
  }
});

test("1º ausente na confirmação → CONVITE_NECESSARIO com convite_enviado false; os demais seguem o ritmo e o convite da Fase 28", async () => {
  const adds = { [JID_B]: { status: "403", content: conteudoComAddRequest(JID_B, "CODIGO-FALSO", 1760000000) } };
  const m = montarCriacao({ adds, participantes: [{ id: "100000000000004@lid" }] }); // o 1º (A) não está no grupo
  const r = await criarGrupo(m.adapter, NOME, [FONE_A, FONE_B, FONE_C], { segundosIntervalo: 4, convite: { texto: "Convite" }, dormir: m.dormir });
  assert.deepEqual(r.participantes, [
    { telefone: FONE_A, status: "CONVITE_NECESSARIO", convite_enviado: false },
    { telefone: FONE_B, status: "CONVITE_NECESSARIO", convite_enviado: true },
    { telefone: FONE_C, status: "ADICIONADO", convite_enviado: false },
  ]);
  assert.deepEqual(m.grupo.chamadas.add.map((c) => [c.jid, c.alvos]), [[ID_NOVO, [JID_B]], [ID_NOVO, [JID_C]]]);
  assert.equal(m.grupo.chamadas.envios.length, 1);
  assert.deepEqual(m.pausas, [4, 4], "uma pausa depois do groupCreate e uma depois do 1º add, nenhuma depois do último");
});

test("falha no groupMetadata depois da criação: 1º FALHA, restante NAO_PROCESSADO, e o resultado sai com o chat_jid", async () => {
  const m = montarCriacao({ falhaMetadata: true });
  const linhas = await capturarConsole(async () => {
    const r = await criarGrupo(m.adapter, NOME, [FONE_A, FONE_B], { segundosIntervalo: 1, dormir: m.dormir });
    assert.equal(r.chat_jid, ID_NOVO);
    assert.deepEqual(r.participantes.map((p) => p.status), ["FALHA", "NAO_PROCESSADO"]);
  });
  assert.doesNotMatch(linhas.join("\n"), /\d{10,}|@lid|@s\.whatsapp\.net|@g\.us/);
  assert.equal(m.grupo.chamadas.criacoes.length, 1);
});

test("abort depois do groupCreate (desligamento, desconectar, remover, back): o restante sai NAO_PROCESSADO e o resultado sai", async () => {
  const controlador = new AbortController();
  const m = montarCriacao({ participantes: [{ id: JID_A }], aoChamar: (/** @type {string} */ e) => (e === "groupCreate" ? controlador.abort() : undefined) });
  const r = await criarGrupo(m.adapter, NOME, [FONE_A, FONE_B, FONE_C], { segundosIntervalo: 1, dormir: m.dormir, sinal: controlador.signal });
  assert.equal(r.chat_jid, ID_NOVO);
  assert.deepEqual(r.participantes.map((p) => p.status), ["ADICIONADO", "NAO_PROCESSADO", "NAO_PROCESSADO"]);
  assert.equal(m.grupo.chamadas.add.length, 0);
});

test("429 no add dos demais para o laço: o restante NAO_PROCESSADO, ainda com o chat_jid", async () => {
  const limite = Object.assign(new Error("x"), { data: 429, output: { statusCode: 500 } });
  const m = montarCriacao({ adds: { [JID_B]: limite }, participantes: [{ id: JID_A }] });
  const r = await criarGrupo(m.adapter, NOME, [FONE_A, FONE_B, FONE_C], { segundosIntervalo: 1, dormir: m.dormir });
  assert.deepEqual(r.participantes.map((p) => p.status), ["ADICIONADO", "FALHA", "NAO_PROCESSADO"]);
});

test("abort ANTES do groupCreate (durante a consulta): nada é criado e a operação falha como desconectada", async () => {
  const controlador = new AbortController();
  const m = montarCriacao({ aoChamar: (/** @type {string} */ e) => (e === "onWhatsApp" ? controlador.abort() : undefined) });
  await assert.rejects(
    criarGrupo(m.adapter, NOME, [FONE_A], { segundosIntervalo: 1, dormir: m.dormir, sinal: controlador.signal }),
    (erro) => erro instanceof ErroGrupo && erro.codigo === "DESCONECTADA"
  );
  assert.equal(m.grupo.chamadas.criacoes.length, 0);
});

test("o nome é ensinado ao cache (obterNome não consulta de novo) e sem socket a criação não começa", async () => {
  const m = montarCriacao({ falhaMetadata: true });
  await criarGrupo(m.adapter, NOME, [FONE_A], { segundosIntervalo: 1, dormir: m.dormir });
  const consultas = m.grupo.chamadas.metadata;
  assert.equal(await m.nomes.obterNome(m.socket, ID_NOVO), NOME);
  assert.equal(m.grupo.chamadas.metadata, consultas);

  const sem = montarCriacao({ desconectado: true });
  await assert.rejects(criarGrupo(sem.adapter, NOME, [FONE_A], { segundosIntervalo: 1, dormir: sem.dormir }), (e) => e instanceof ErroGrupo && e.codigo === "DESCONECTADA");
});

test("nenhum log da criação leva telefone, JID, LID ou nome do grupo", async () => {
  const m = montarCriacao({ adds: { [JID_B]: new Error(`erro ${FONE_B} ${NOME}`) }, participantes: [{ id: JID_A }] });
  const linhas = await capturarConsole(() => criarGrupo(m.adapter, NOME, [FONE_A, FONE_B], { segundosIntervalo: 1, dormir: m.dormir }));
  assert.doesNotMatch(linhas.join("\n"), new RegExp(`\\d{10,}|@lid|@s\\.whatsapp\\.net|@g\\.us|${NOME}`));
});
