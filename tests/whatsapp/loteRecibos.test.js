// @ts-check
// Lote dos recibos por destinatário (Fase 38, C1): tamanho e espera do lote, deduplicação com TTL, nova
// tentativa, suspensão no 404, esvaziar no desligamento e log sem dado pessoal. O back é falso.
const { test, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { criarLoteRecibos, obterMsLoteRecibos, chaveDoDestinatario, MS_LOTE_PADRAO } = require("../../src/whatsapp/loteRecibos");

const CONTEXTO = { hash_empresa: "hash-a", cod_equipe: "21" };
const LID = "100000000000002@lid";
const TELEFONE = "5511900000002";

/** @param {number} ms */
const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Captura o console: nenhum LID, telefone, JID nem id de mensagem pode aparecer nele. */
function capturarConsole() {
  /** @type {string[]} */
  const linhas = [];
  const originais = { log: console.log, error: console.error };
  console.log = (...args) => void linhas.push(args.map(String).join(" "));
  console.error = (...args) => void linhas.push(args.map(String).join(" "));
  return {
    linhas,
    restaurar() {
      console.log = originais.log;
      console.error = originais.error;
    },
  };
}

/** @param {number} i */
const recibo = (i, extra = {}) => ({
  mensagem_wa_id: `3EB0LOTE${String(i).padStart(4, "0")}`,
  destinatario: /** @type {{ lid: string | null, telefone: string | null } | null} */ ({ lid: LID, telefone: TELEFONE }),
  entregue_em: /** @type {number | null} */ (1760400000 + i),
  lida_em: /** @type {number | null} */ (null),
  ...extra,
});

/**
 * @param {{ responder?: (n: number, itens: any[]) => unknown, opcoes?: Record<string, any>, enfileirar?: (t: () => unknown) => unknown }} [config]
 */
function lotePara({ responder = async () => ({ msg: "ok", gravados: 1, ignorados: 0 }), opcoes = {}, enfileirar } = {}) {
  /** @type {{ itens: any[], contexto: any, opcoes: any }[]} */
  const chamadas = [];
  const lote = criarLoteRecibos({
    contexto: CONTEXTO,
    msLote: 25,
    msEntreTentativas: 1,
    registrarRecibos: async (itens, contexto, o) => {
      chamadas.push({ itens, contexto, opcoes: o });
      return responder(chamadas.length, itens);
    },
    ...(enfileirar ? { enfileirar } : {}),
    ...opcoes,
  });
  return { lote, chamadas };
}

const erroHttp = (/** @type {number} */ status) => Object.assign(new Error("http"), { name: "ErroRotaInterna", tipo: "http", status });
const erroRede = () => Object.assign(new Error("rede"), { name: "ErroRotaInterna", tipo: "rede", status: null });
const erroTimeout = () => Object.assign(new Error("tempo"), { name: "ErroRotaInterna", tipo: "timeout", status: null });

afterEach(() => {
  delete process.env.RECIBO_LOTE_MS;
});

test("o lote espera RECIBO_LOTE_MS e sai de uma vez, com o contexto da equipe", async () => {
  const { lote, chamadas } = lotePara();
  lote.adicionar(recibo(1));
  lote.adicionar(recibo(2));
  await esperar(5);
  assert.equal(chamadas.length, 0, "dentro da janela nada sai");
  await esperar(70);
  assert.equal(chamadas.length, 1);
  assert.deepEqual(chamadas[0].itens.map((i) => i.mensagem_wa_id), [recibo(1).mensagem_wa_id, recibo(2).mensagem_wa_id]);
  assert.deepEqual(chamadas[0].contexto, CONTEXTO);
});

test("300 recibos em menos de 2 s saem em POSTs de 200 e 100, e um recibo repetido não volta", async () => {
  const { lote, chamadas } = lotePara({ opcoes: { msLote: 2000 } });
  const inicio = Date.now();
  for (let i = 1; i <= 300; i += 1) lote.adicionar(recibo(i));
  await esperar(30); // o 200º item despacha na hora, sem esperar a janela de 2 s
  assert.equal(chamadas.length >= 1, true);
  assert.equal(chamadas[0].itens.length, 200);
  // Os 100 restantes saem junto no mesmo despacho (já estavam pendentes quando o lote foi tirado).
  assert.deepEqual(chamadas.map((c) => c.itens.length), [200, 100]);
  assert.ok(Date.now() - inicio < 1000);

  // Repetidos: nada novo.
  for (let i = 1; i <= 300; i += 1) assert.equal(lote.adicionar(recibo(i)), false);
  assert.equal(lote.quantidadePendentes(), 0);
  await lote.esvaziar();
  assert.equal(chamadas.length, 2);
});

test("200 itens exatos despacham na hora; 201 pendentes saem em 200 + 1; a janela vale para o que sobra", async () => {
  const { lote, chamadas } = lotePara({ opcoes: { msLote: 40 } });
  for (let i = 1; i <= 200; i += 1) lote.adicionar(recibo(i));
  await esperar(10);
  assert.deepEqual(chamadas.map((c) => c.itens.length), [200]);
  lote.adicionar(recibo(201));
  await esperar(10);
  assert.equal(chamadas.length, 1, "o item solto espera a janela");
  await esperar(60);
  assert.deepEqual(chamadas.map((c) => c.itens.length), [200, 1]);
});

test("a ordem de chegada se mantém entre as chamadas (em série)", async () => {
  /** @type {string[]} */
  const ordem = [];
  const { lote } = lotePara({
    opcoes: { msLote: 1 },
    responder: async (n, itens) => {
      ordem.push(`ini-${n}`);
      await esperar(n === 1 ? 20 : 1);
      ordem.push(`fim-${n}`);
      return itens.length;
    },
  });
  for (let i = 1; i <= 250; i += 1) lote.adicionar(recibo(i));
  await lote.esvaziar();
  assert.deepEqual(ordem, ["ini-1", "fim-1", "ini-2", "fim-2"]);
});

test("a deduplicação deixa passar só o horário novo, junta o menor horário no mesmo lote e esquece depois do TTL de 24 h", async () => {
  let agoraMs = Date.UTC(2026, 9, 20, 12, 0, 0);
  const { lote, chamadas } = lotePara({ opcoes: { agora: () => agoraMs, msLote: 5 } });
  assert.equal(lote.adicionar(recibo(1, { entregue_em: 200 })), true);
  assert.equal(lote.adicionar(recibo(1, { entregue_em: 100 })), false, "mesma entrega: nada novo");
  assert.equal(lote.adicionar(recibo(1, { entregue_em: null, lida_em: 300 })), true, "a leitura é novidade");
  assert.equal(lote.adicionar(recibo(1, { entregue_em: null, lida_em: 250 })), false, "a leitura já está no lote");
  await esperar(40);
  // Um só item no lote, com a entrega e a leitura.
  assert.deepEqual(chamadas[0].itens, [{ ...recibo(1), entregue_em: 200, lida_em: 300 }]);

  // Depois de enviado, repetir não volta; mas uma leitura nova sobre uma entrega já enviada volta.
  assert.equal(lote.adicionar(recibo(1, { entregue_em: 200, lida_em: 300 })), false);
  assert.equal(lote.adicionar(recibo(2, { entregue_em: 50 })), true);
  await esperar(40);
  assert.equal(lote.adicionar(recibo(2, { entregue_em: null, lida_em: 60 })), true);
  await esperar(40);
  assert.deepEqual(chamadas.map((c) => c.itens.length), [1, 1, 1]);
  assert.equal(chamadas[2].itens[0].entregue_em, null);
  assert.equal(chamadas[2].itens[0].lida_em, 60);

  // Passadas 24 h o mesmo recibo pode voltar (o back é idempotente).
  agoraMs += 24 * 60 * 60 * 1000 + 61_000;
  assert.equal(lote.adicionar(recibo(1, { entregue_em: 200 })), true);
  await lote.esvaziar();
  assert.equal(chamadas.length, 4);
});

test("a deduplicação distingue a mensagem e o destinatário (LID, telefone e conversa individual)", async () => {
  const { lote, chamadas } = lotePara();
  assert.equal(lote.adicionar(recibo(1)), true);
  assert.equal(lote.adicionar(recibo(1, { destinatario: { lid: null, telefone: TELEFONE } })), true, "T: é outra chave que L:");
  assert.equal(lote.adicionar(recibo(1, { destinatario: { lid: "100000000000003@lid", telefone: null } })), true);
  assert.equal(lote.adicionar(recibo(1, { destinatario: null })), true);
  assert.equal(lote.adicionar(recibo(2)), true);
  await lote.esvaziar();
  assert.equal(chamadas[0].itens.length, 5);
  assert.equal(chaveDoDestinatario(null), "CONVERSA");
  assert.equal(chaveDoDestinatario({ lid: LID, telefone: TELEFONE }), `L:${LID}`);
  assert.equal(chaveDoDestinatario({ lid: null, telefone: TELEFONE }), `T:${TELEFONE}`);
  assert.equal(chaveDoDestinatario({ lid: null, telefone: null }), null);
});

test("item inválido (id, sem horário, sem destinatário identificável) não entra", () => {
  const { lote } = lotePara();
  assert.equal(lote.adicionar(/** @type {any} */ (null)), false);
  assert.equal(lote.adicionar(recibo(1, { mensagem_wa_id: "" })), false);
  assert.equal(lote.adicionar(recibo(1, { entregue_em: null, lida_em: null })), false);
  assert.equal(lote.adicionar(recibo(1, { destinatario: { lid: null, telefone: null } })), false);
  assert.equal(lote.quantidadePendentes(), 0);
  lote.limpar();
});

test("o despacho passa pela fila serial (enfileirar) e a tarefa não espera o POST", async () => {
  /** @type {(() => unknown)[]} */
  const tarefas = [];
  /** @type {() => void} */
  let liberarPost = () => {};
  const { lote, chamadas } = lotePara({
    enfileirar: (tarefa) => void tarefas.push(tarefa),
    responder: () => new Promise((resolve) => (liberarPost = () => resolve(null))),
  });
  lote.adicionar(recibo(1));
  await esperar(50);
  assert.equal(tarefas.length, 1, "o despacho foi pedido à fila");
  assert.equal(chamadas.length, 0, "e só sai quando a fila executa a tarefa (depois dos registros anteriores)");
  const volta = tarefas[0]();
  assert.equal(volta, undefined, "a tarefa não devolve o POST: a fila não espera o back");
  await esperar(5);
  assert.equal(chamadas.length, 1);
  liberarPost();
  await lote.esvaziar();
});

test("uma falha ao pedir o despacho vai ao log e não trava os próximos", async () => {
  const captura = capturarConsole();
  let falhar = true;
  try {
    const { lote, chamadas } = lotePara({
      enfileirar: (tarefa) => {
        if (falhar) throw new Error("fila quebrou com 5511900000002");
        return tarefa();
      },
    });
    lote.adicionar(recibo(1));
    await esperar(60);
    assert.equal(chamadas.length, 0);
    falhar = false;
    lote.adicionar(recibo(2));
    await esperar(60);
    assert.equal(chamadas.length, 1, "o item pendente sai no próximo despacho");
    assert.equal(chamadas[0].itens.length, 2);
  } finally {
    captura.restaurar();
  }
  assert.equal(captura.linhas.length, 1);
  assert.match(captura.linhas[0], /equipe 21/i);
  assert.doesNotMatch(captura.linhas[0], /5511900000002/);
});

test("404 (back antigo) descarta o lote, suspende a rota com UM log e volta a tentar depois do intervalo", async () => {
  const captura = capturarConsole();
  let agoraMs = 1_000_000;
  try {
    const { lote, chamadas } = lotePara({
      opcoes: { agora: () => agoraMs, msSuspensao: 10 * 60 * 1000 },
      responder: async (n) => {
        if (n === 1) throw erroHttp(404);
        return { msg: "ok" };
      },
    });
    lote.adicionar(recibo(1));
    lote.adicionar(recibo(2));
    await esperar(60);
    assert.equal(chamadas.length, 1, "404 não tem nova tentativa");

    // Suspenso: os próximos lotes nem chamam o back, e não há mais log.
    lote.adicionar(recibo(3));
    await esperar(60);
    lote.adicionar(recibo(4));
    await esperar(60);
    assert.equal(chamadas.length, 1);
    assert.equal(captura.linhas.length, 1, "um único log");
    assert.match(captura.linhas[0], /equipe 21/i);
    assert.match(captura.linhas[0], /lote de 2/);

    // Passado o intervalo, tenta de novo; o recibo descartado pode voltar (foi esquecido).
    agoraMs += 10 * 60 * 1000;
    assert.equal(lote.adicionar(recibo(1)), true);
    await esperar(60);
    assert.equal(chamadas.length, 2);
  } finally {
    captura.restaurar();
  }
});

test("503, rede e timeout têm UMA nova tentativa; duas falhas descartam o lote só com log", async () => {
  for (const falha of [() => erroHttp(503), erroRede, erroTimeout, () => erroHttp(500)]) {
    const { lote, chamadas } = lotePara({
      responder: async (n) => {
        if (n === 1) throw falha();
        return { msg: "ok" };
      },
    });
    lote.adicionar(recibo(1));
    await esperar(80);
    assert.equal(chamadas.length, 2, "uma retentativa que dá certo");
    lote.limpar();
  }

  const captura = capturarConsole();
  try {
    const { lote, chamadas } = lotePara({
      responder: async (n) => {
        if (n === 1) throw erroHttp(503);
        return { msg: "ok" };
      },
    });
    lote.adicionar(recibo(1));
    await esperar(80);
    assert.equal(chamadas.length, 2, "503 → uma retentativa que dá certo");
    assert.equal(captura.linhas.length, 0);
    assert.deepEqual(chamadas[1].itens, chamadas[0].itens, "a retentativa leva o mesmo lote");

    const falhando = lotePara({ responder: async () => Promise.reject(erroTimeout()) });
    falhando.lote.adicionar(recibo(1));
    falhando.lote.adicionar(recibo(2));
    await esperar(80);
    assert.equal(falhando.chamadas.length, 2, "uma nova tentativa, depois descarta");
    assert.equal(captura.linhas.length, 1);
    assert.match(captura.linhas[0], /equipe 21: 2 recibos por destinatário descartados/i);
    // Descartado só com log: o recibo repetido pode voltar numa próxima chance.
    assert.equal(falhando.lote.adicionar(recibo(1)), true);
    falhando.lote.limpar();
  } finally {
    captura.restaurar();
  }
});

test("erro que não é de rede nem 5xx (400, 401, requisição inválida) descarta na hora, sem nova tentativa", async () => {
  const captura = capturarConsole();
  try {
    for (const erro of [erroHttp(400), erroHttp(401), Object.assign(new Error("x"), { name: "ErroRotaInterna", tipo: "configuracao" }), new Error("qualquer")]) {
      const { lote, chamadas } = lotePara({ responder: async () => Promise.reject(erro) });
      lote.adicionar(recibo(1));
      await esperar(60);
      assert.equal(chamadas.length, 1);
    }
  } finally {
    captura.restaurar();
  }
  assert.equal(captura.linhas.length, 4);
});

test("a falha do back não rejeita nada: adicionar, esvaziar e limpar seguem normais", async () => {
  const captura = capturarConsole();
  try {
    const { lote } = lotePara({ responder: async () => Promise.reject(erroHttp(500)) });
    lote.adicionar(recibo(1));
    await assert.doesNotReject(lote.esvaziar());
    await assert.doesNotReject(async () => lote.limpar());
  } finally {
    captura.restaurar();
  }
});

test("esvaziar no desligamento despacha o que sobrou, espera o POST e não faz nova tentativa", async () => {
  const captura = capturarConsole();
  try {
    const { lote, chamadas } = lotePara({
      opcoes: { msLote: 60_000 },
      responder: async (n) => {
        await esperar(10);
        if (n === 1) throw erroHttp(503);
        return null;
      },
    });
    lote.adicionar(recibo(1));
    lote.adicionar(recibo(2));
    assert.equal(chamadas.length, 0);
    await lote.esvaziar();
    assert.equal(chamadas.length, 1, "saiu antes de a janela de 60 s vencer");
    assert.equal(lote.quantidadePendentes(), 0);
    assert.equal(chamadas[0].opcoes.timeoutMs > 0, true, "no desligamento a chamada leva um prazo próprio");
    await esperar(20);
    assert.equal(chamadas.length, 1, "503 no desligamento não retenta");
    assert.equal(captura.linhas.length, 1);
  } finally {
    captura.restaurar();
  }
});

test("esvaziar com o back pendurado termina dentro do prazo técnico, com um log", async () => {
  const captura = capturarConsole();
  const inicio = Date.now();
  try {
    const { lote } = lotePara({ opcoes: { msTetoEsvaziar: 60 }, responder: () => new Promise(() => {}) });
    lote.adicionar(recibo(1));
    await lote.esvaziar();
  } finally {
    captura.restaurar();
  }
  const gasto = Date.now() - inicio;
  assert.ok(gasto >= 50 && gasto < 500, `levou ${gasto} ms`);
  assert.equal(captura.linhas.length, 1);
  assert.match(captura.linhas[0], /equipe 21/i);
});

test("esvaziar sem nada pendente resolve na hora", async () => {
  const { lote, chamadas } = lotePara();
  await lote.esvaziar();
  assert.equal(chamadas.length, 0);
});

test("limpar (sessão apagada) descarta pendentes e o que ainda não saiu, e esquece a deduplicação e a suspensão", async () => {
  const { lote, chamadas } = lotePara({
    opcoes: { msLote: 1 },
    responder: async () => {
      await esperar(30);
      return null;
    },
  });
  for (let i = 1; i <= 250; i += 1) lote.adicionar(recibo(i)); // 200 + 50: o 2º POST ainda não começou
  await esperar(10);
  assert.equal(chamadas.length, 1);
  lote.limpar();
  lote.adicionar(recibo(999));
  lote.limpar();
  await esperar(80);
  assert.equal(chamadas.length, 1, "o segundo pedaço e o pendente não saem depois do limpar");
  assert.equal(lote.quantidadePendentes(), 0);
  assert.equal(lote.adicionar(recibo(1)), true, "a deduplicação foi esquecida");
  lote.limpar();
});

test("o limpar zera também a suspensão por 404", async () => {
  const captura = capturarConsole();
  try {
    const { lote, chamadas } = lotePara({ responder: async (n) => (n === 1 ? Promise.reject(erroHttp(404)) : null) });
    lote.adicionar(recibo(1));
    await esperar(50);
    lote.limpar();
    lote.adicionar(recibo(2));
    await esperar(50);
    assert.equal(chamadas.length, 2);
  } finally {
    captura.restaurar();
  }
});

test("o log só tem cod_equipe e contagens: nada de LID, telefone, JID nem id de mensagem", async () => {
  const captura = capturarConsole();
  try {
    for (const erro of [erroHttp(404), erroHttp(400), erroRede()]) {
      const { lote } = lotePara({ responder: async () => Promise.reject(Object.assign(erro, { message: `falhou para ${TELEFONE} ${LID} ${TELEFONE}@s.whatsapp.net` })) });
      lote.adicionar(recibo(1));
      await esperar(80);
    }
  } finally {
    captura.restaurar();
  }
  assert.ok(captura.linhas.length >= 3);
  for (const linha of captura.linhas) {
    assert.match(linha, /equipe 21/i);
    assert.doesNotMatch(linha, new RegExp(`${TELEFONE}|100000000000002|s\\.whatsapp\\.net|@lid|3EB0LOTE`));
  }
});

test("a varredura remove da deduplicação o que passou do TTL e para na primeira entrada ainda válida", async () => {
  let agoraMs = Date.UTC(2026, 9, 20, 12, 0, 0);
  const { lote } = lotePara({ opcoes: { agora: () => agoraMs, msTtlDedup: 100_000, msLote: 1 } });
  assert.equal(lote.adicionar(recibo(1)), true);
  await lote.esvaziar(); // 2xx: o 1 entra na deduplicação
  agoraMs += 80_000;
  assert.equal(lote.adicionar(recibo(2)), true);
  await lote.esvaziar(); // o 2 é confirmado 80 s depois do 1
  agoraMs += 70_000; // o 1 tem 150 s (expirou); o 2 tem 70 s (vale); passou o intervalo entre varreduras
  assert.equal(lote.adicionar(recibo(3)), true);
  assert.equal(lote.adicionar(recibo(1)), true, "o 1 expirou e foi varrido");
  assert.equal(lote.adicionar(recibo(2)), false, "o 2 ainda vale: a varredura parou nele");
  await lote.esvaziar();
});

test("a deduplicação só vale depois do 2xx: o que está a caminho já conta, o que falhou pode voltar", async () => {
  /** @type {() => void} */
  let liberar = () => {};
  const { lote, chamadas } = lotePara({
    opcoes: { msLote: 1 },
    responder: (n) => (n === 1 ? new Promise((resolve) => (liberar = () => resolve(null))) : Promise.reject(erroHttp(400))),
  });
  const captura = capturarConsole();
  try {
    assert.equal(lote.adicionar(recibo(1)), true);
    await esperar(30);
    assert.equal(chamadas.length, 1);
    assert.equal(lote.adicionar(recibo(1)), false, "a caminho: não sai duas vezes");
    liberar();
    await esperar(10);
    assert.equal(lote.adicionar(recibo(1)), false, "confirmado (2xx): não volta");

    assert.equal(lote.adicionar(recibo(2)), true);
    await esperar(30); // o 2º POST dá 400 e é descartado
    assert.equal(lote.adicionar(recibo(2)), true, "o que falhou não entrou na deduplicação");
  } finally {
    captura.restaurar();
  }
  lote.limpar();
});

test("item inválido no meio de válidos não derruba o lote: só os válidos entram", async () => {
  const { lote, chamadas } = lotePara();
  assert.equal(lote.adicionar(recibo(1)), true);
  assert.equal(lote.adicionar(recibo(2, { destinatario: { lid: "5511900000002@s.whatsapp.net", telefone: null } })), false);
  assert.equal(lote.adicionar(recibo(3, { entregue_em: 0 })), false);
  assert.equal(lote.adicionar(recibo(4)), true);
  await lote.esvaziar();
  assert.deepEqual(chamadas[0].itens.map((i) => i.mensagem_wa_id), [recibo(1).mensagem_wa_id, recibo(4).mensagem_wa_id]);
});

test("limpar cancela a espera da nova tentativa: o lote não é reenviado e nada fica pendurado", async () => {
  const captura = capturarConsole();
  try {
    const { lote, chamadas } = lotePara({ opcoes: { msEntreTentativas: 60_000 }, responder: () => Promise.reject(erroHttp(503)) });
    lote.adicionar(recibo(1));
    await esperar(60);
    assert.equal(chamadas.length, 1, "primeira tentativa feita, a segunda espera 60 s");
    lote.limpar();
    await esperar(30);
    assert.equal(chamadas.length, 1, "a espera acordou e desistiu, sem reenviar");
    await lote.esvaziar();
  } finally {
    captura.restaurar();
  }
});

test("guarda do desligamento: o esvaziar do lote mais a espera das credenciais cabem folgados no teto do encerramento", () => {
  const { MS_TETO_ESVAZIAR } = require("../../src/whatsapp/loteRecibos");
  const { MS_TETO_ENCERRAMENTO } = require("../../src/index");
  const { MS_PRAZO_CREDENCIAIS } = require("../../src/whatsapp/BaileysAdapter");
  assert.ok(
    MS_TETO_ESVAZIAR + MS_PRAZO_CREDENCIAIS <= MS_TETO_ENCERRAMENTO * 0.75,
    `esvaziar (${MS_TETO_ESVAZIAR}) + credenciais (${MS_PRAZO_CREDENCIAIS}) precisam caber em 75% do teto (${MS_TETO_ENCERRAMENTO})`
  );
});

test("RECIBO_LOTE_MS: padrão técnico 2000; vale inteiro ≥ 0; inválido cai no padrão", () => {
  delete process.env.RECIBO_LOTE_MS;
  assert.equal(obterMsLoteRecibos(), MS_LOTE_PADRAO);
  assert.equal(MS_LOTE_PADRAO, 2000);
  process.env.RECIBO_LOTE_MS = "500";
  assert.equal(obterMsLoteRecibos(), 500);
  process.env.RECIBO_LOTE_MS = "0";
  assert.equal(obterMsLoteRecibos(), 0);
  for (const invalido of ["", "  ", "-1", "abc", "1.5"]) {
    process.env.RECIBO_LOTE_MS = invalido;
    assert.equal(obterMsLoteRecibos(), 2000, `"${invalido}"`);
  }
});

test("sem msLote explícito o lote usa RECIBO_LOTE_MS a cada lote", async () => {
  process.env.RECIBO_LOTE_MS = "15";
  /** @type {any[]} */
  const chamadas = [];
  const lote = criarLoteRecibos({ contexto: CONTEXTO, registrarRecibos: async (itens) => void chamadas.push(itens) });
  lote.adicionar(recibo(1));
  await esperar(80);
  assert.equal(chamadas.length, 1);
});
