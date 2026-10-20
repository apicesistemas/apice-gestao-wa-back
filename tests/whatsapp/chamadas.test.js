// @ts-check
// Consolidador das chamadas recebidas (Task 34.2) e dos alertas tocando/parou (Task 34.6), com relógio
// e agendador injetados: nada espera tempo real.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { criarConsolidadorChamadas } = require("../../src/whatsapp/chamadas");

const LID = "100000000000001@lid";
const GRUPO = "120363000000000001@g.us";
const EU = { jid: "5511900000099:7@s.whatsapp.net", lid: "100000000000099:7@lid" };
const JANELA = 15000;
const TETO = 300000;

/**
 * @param {{ coletar?: boolean, alertar?: (a: any) => Promise<unknown> | unknown, publicar?: (r: any) => unknown, maxPendentes?: number }} [extra]
 */
function montar(extra = {}) {
  let agora = 1_760_000_000_000;
  /** @type {{ ate: number, fn: () => void, cancelado: boolean }[]} */
  const timers = [];
  /** @type {any[]} */
  const registros = [];
  /** @type {any[]} */
  const alertas = [];
  /** @type {unknown[]} */
  const falhas = [];
  /** @type {string[]} */
  const descartes = [];
  const consolidador = criarConsolidadorChamadas({
    eu: () => EU,
    publicar: extra.publicar ?? ((r) => void registros.push(r)),
    alertar: extra.alertar ?? (extra.coletar ? (a) => void alertas.push(a) : undefined),
    agora: () => agora,
    agendar: (fn, ms) => {
      const t = { ate: agora + ms, fn, cancelado: false };
      timers.push(t);
      return () => {
        t.cancelado = true;
      };
    },
    msTeto: TETO,
    msJanelaAccept: JANELA,
    maxPendentes: extra.maxPendentes ?? 500,
    aoFalhar: (situacao, erro) => void falhas.push([situacao, erro]),
    aoDescartar: (motivo) => void descartes.push(motivo),
  });
  /** @param {number} ms */
  async function avancar(ms) {
    agora += ms;
    for (;;) {
      const pronto = timers.filter((t) => !t.cancelado && t.ate <= agora).sort((a, b) => a.ate - b.ate)[0];
      if (!pronto) break;
      pronto.cancelado = true;
      pronto.fn();
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  return { consolidador, registros, alertas, falhas, descartes, avancar, timers };
}

/** @param {string} status @param {any} [extra] */
const ev = (status, extra = {}) => ({ id: "CALL1", status, from: LID, chatId: LID, date: new Date(1_760_000_000_000), offline: false, isVideo: true, ...extra });
/** accept/reject chegam com chatId = equipe e sem video/grupo (homologação da 34.0) */
const evFim = (/** @type {string} */ status) => ({ id: "CALL1", status, from: LID, chatId: EU.jid, date: new Date(1_760_000_020_000), offline: false });

test("recebida sem desfecho: offer → ringing → terminate dá UM PERDIDA só depois da janela", async () => {
  const { consolidador, registros, avancar } = montar();
  consolidador.tratarEvento([ev("offer")]);
  consolidador.tratarEvento([ev("ringing"), ev("ringing")]);
  consolidador.tratarEvento([ev("terminate")]);
  await avancar(JANELA - 1);
  assert.equal(registros.length, 0);
  await avancar(1);
  assert.equal(registros.length, 1);
  assert.deepEqual(
    { r: registros[0].resultado, v: registros[0].video, o: registros[0].origem, id: registros[0].chamada_wa_id, from: registros[0].from, g: registros[0].group_jid, ts: registros[0].timestamp_wa },
    { r: "PERDIDA", v: true, o: "CLIENTE", id: "CALL1", from: LID, g: null, ts: 1_760_000_000 },
  );
  assert.deepEqual(registros[0].sequencia, ["offer", "ringing", "ringing", "terminate", "PERDIDA"]);
  await avancar(TETO * 2);
  assert.equal(registros.length, 1, "o teto não publica de novo");
});

test("offer → reject: RECUSADA na hora, e o terminate seguinte não gera nada", async () => {
  const { consolidador, registros, avancar } = montar();
  consolidador.tratarEvento([ev("offer")]);
  consolidador.tratarEvento([evFim("reject")]);
  assert.equal(registros.length, 1);
  assert.equal(registros[0].resultado, "RECUSADA");
  assert.equal(registros[0].video, true, "o vídeo vem do offer");
  consolidador.tratarEvento([ev("terminate")]);
  await avancar(TETO * 2);
  assert.equal(registros.length, 1);
});

test("offer → terminate → accept dentro da janela: um ATENDIDA, nunca PERDIDA", async () => {
  const { consolidador, registros, avancar } = montar();
  consolidador.tratarEvento([ev("offer")]);
  consolidador.tratarEvento([ev("terminate")]);
  await avancar(JANELA - 1000);
  consolidador.tratarEvento([evFim("accept")]);
  assert.deepEqual(registros.map((r) => r.resultado), ["ATENDIDA"]);
  assert.equal(registros[0].video, true);
  await avancar(TETO * 2);
  assert.equal(registros.length, 1);
});

test("accept antes do terminate também é ATENDIDA, uma vez", async () => {
  const { consolidador, registros, avancar } = montar();
  consolidador.tratarEvento([ev("offer")]);
  consolidador.tratarEvento([evFim("accept")]);
  consolidador.tratarEvento([ev("terminate")]);
  await avancar(TETO * 2);
  assert.deepEqual(registros.map((r) => r.resultado), ["ATENDIDA"]);
});

test("accept depois da janela é ignorado (já publicada como PERDIDA)", async () => {
  const { consolidador, registros, avancar } = montar();
  consolidador.tratarEvento([ev("offer"), ev("terminate")]);
  await avancar(JANELA);
  consolidador.tratarEvento([evFim("accept")]);
  await avancar(1000);
  assert.deepEqual(registros.map((r) => r.resultado), ["PERDIDA"]);
});

test("timeout, se um dia chegar, é PERDIDA", async () => {
  const { consolidador, registros } = montar();
  consolidador.tratarEvento([ev("offer"), ev("timeout")]);
  assert.deepEqual(registros.map((r) => r.resultado), ["PERDIDA"]);
});

test("offer sem desfecho: ENCERRADA só no teto", async () => {
  const { consolidador, registros, avancar } = montar();
  consolidador.tratarEvento([ev("offer")]);
  await avancar(TETO - 1);
  assert.equal(registros.length, 0);
  await avancar(1);
  assert.deepEqual(registros.map((r) => r.resultado), ["ENCERRADA"]);
  assert.equal(consolidador.pendentes(), 0);
});

test("eventos repetidos (mesmo status, lote duplicado, offline + tempo real) publicam uma vez só", async () => {
  const { consolidador, registros, avancar } = montar();
  consolidador.tratarEvento([ev("offer"), ev("offer"), ev("terminate"), ev("terminate")]);
  consolidador.tratarEvento([ev("offer", { offline: true }), ev("terminate", { offline: true })]);
  await avancar(JANELA);
  consolidador.tratarEvento([ev("offer"), ev("terminate")]);
  await avancar(JANELA * 2);
  assert.equal(registros.length, 1);
});

test("a tabela dos ids publicados esquece depois do teto e respeita o tamanho máximo", async () => {
  const { consolidador, registros, avancar } = montar({ maxPendentes: 2 });
  for (const id of ["A1", "A2", "A3"]) consolidador.tratarEvento([ev("reject", { id })]);
  assert.equal(registros.length, 3);
  consolidador.tratarEvento([ev("reject", { id: "A3" })]);
  assert.equal(registros.length, 3, "A3 ainda lembrada");
  consolidador.tratarEvento([ev("reject", { id: "A1" })]);
  assert.equal(registros.length, 4, "A1 saiu da tabela limitada");
  await avancar(TETO + 1);
  consolidador.tratarEvento([ev("reject", { id: "A3" })]);
  assert.equal(registros.length, 5, "passado o teto, o id é esquecido");
});

test("abrir mais chamadas que o máximo encerra a mais antiga (ENCERRADA) e avisa o motivo, sem id", () => {
  const { consolidador, registros, descartes } = montar({ maxPendentes: 2 });
  for (const id of ["B1", "B2", "B3"]) consolidador.tratarEvento([ev("offer", { id })]);
  assert.deepEqual(registros.map((r) => [r.chamada_wa_id, r.resultado]), [["B1", "ENCERRADA"]]);
  assert.deepEqual(descartes, ["TABELA_CHEIA"]);
});

test("evento final sem offer (reinício): registra com video null e a identidade do from", async () => {
  const { consolidador, registros, avancar } = montar();
  consolidador.tratarEvento([evFim("terminate")]);
  await avancar(JANELA);
  consolidador.tratarEvento([{ ...evFim("reject"), id: "CALL2" }]);
  consolidador.tratarEvento([{ ...evFim("accept"), id: "CALL3" }]);
  assert.deepEqual(registros.map((r) => [r.chamada_wa_id, r.resultado, r.video, r.from]), [
    ["CALL1", "PERDIDA", null, LID],
    ["CALL2", "RECUSADA", null, LID],
    ["CALL3", "ATENDIDA", null, LID],
  ]);
});

test("sem fonte de chamada feita: from igual ao número da equipe não publica nada (nunca origem APARELHO)", async () => {
  const { consolidador, registros, alertas, avancar } = montar({ coletar: true });
  for (const from of [EU.jid, EU.lid, "5511900000099@s.whatsapp.net", "100000000000099@lid"]) {
    consolidador.tratarEvento([ev("offer", { from, chatId: LID }), ev("terminate", { from }), ev("reject", { from }), ev("accept", { from })]);
  }
  await avancar(TETO * 2);
  assert.deepEqual([registros.length, alertas.length, consolidador.pendentes()], [0, 0, 0]);
});

test("status, broadcast, newsletter, ids inválidos e eventos malformados não geram nada", async () => {
  const { consolidador, registros, avancar } = montar();
  consolidador.tratarEvento([
    ev("offer", { from: "status@broadcast" }),
    ev("offer", { from: "120363@newsletter" }),
    ev("offer", { from: undefined }),
    ev("offer", { id: "id com espaço" }),
    ev("offer", { id: undefined }),
    ev("xyz"),
    ev("ringing", { id: "SEMOFFER" }),
    null,
    5,
  ]);
  consolidador.tratarEvento(null);
  await avancar(TETO * 2);
  assert.equal(registros.length, 0);
});

test("grupo com groupJid → group_jid e from = participante; grupo sem groupJid → sem group_jid", async () => {
  const { consolidador, registros } = montar();
  consolidador.tratarEvento([ev("offer", { id: "G1", isGroup: true, groupJid: GRUPO, chatId: GRUPO }), ev("reject", { id: "G1" })]);
  consolidador.tratarEvento([ev("offer", { id: "G2", isGroup: true, groupJid: undefined, chatId: GRUPO }), ev("reject", { id: "G2" })]);
  consolidador.tratarEvento([ev("offer", { id: "G3", isGroup: true, groupJid: "5511@s.whatsapp.net" }), ev("reject", { id: "G3" })]);
  assert.deepEqual(registros.map((r) => [r.group_jid, r.from]), [[GRUPO, LID], [null, LID], [null, LID]]);
});

test("offline é repassado ao publicador (o adapter aplica a janela de recuperação)", () => {
  const { consolidador, registros } = montar();
  consolidador.tratarEvento([ev("offer", { offline: true }), ev("reject", { offline: true })]);
  assert.equal(registros[0].offline, true);
});

test("falha do publicar (síncrona ou assíncrona) vai a aoFalhar e nunca derruba nem repete", async () => {
  let n = 0;
  const { consolidador, falhas, avancar } = montar({
    publicar: () => {
      n += 1;
      if (n === 1) throw new Error("síncrona");
      return Promise.reject(new Error("assíncrona"));
    },
  });
  consolidador.tratarEvento([ev("reject", { id: "F1" }), ev("reject", { id: "F2" })]);
  await avancar(0);
  assert.equal(n, 2);
  assert.equal(falhas.length, 2);
  consolidador.tratarEvento([ev("reject", { id: "F1" })]);
  assert.equal(n, 2, "sem nova tentativa");
});

test("limpar descarta tudo: nada pendente é publicado depois", async () => {
  const { consolidador, registros, avancar } = montar();
  consolidador.tratarEvento([ev("offer"), ev("terminate"), ev("offer", { id: "X2" })]);
  consolidador.limpar();
  await avancar(TETO * 2);
  assert.equal(registros.length, 0);
  assert.equal(consolidador.pendentes(), 0);
});

test("agendador padrão: usa setTimeout não bloqueante e cancela no limpar", async () => {
  /** @type {any[]} */
  const registros = [];
  const consolidador = criarConsolidadorChamadas({ eu: () => EU, publicar: (r) => void registros.push(r), msTeto: 30, msJanelaAccept: 20 });
  consolidador.tratarEvento([ev("offer", { id: "R1" }), ev("offer", { id: "R2" }), ev("terminate", { id: "R2" })]);
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.deepEqual(registros.map((r) => [r.chamada_wa_id, r.resultado]).sort(), [["R1", "ENCERRADA"], ["R2", "PERDIDA"]]);
  consolidador.tratarEvento([ev("offer", { id: "R3" })]);
  consolidador.limpar();
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(registros.length, 2);
});

// ---- Task 34.6: alerta tocando / parou ----

/** Alertar manual: cada chamada fica pendente até o teste liberar (ou falhar). */
function alertarManual() {
  /** @type {any[]} */
  const chamadas = [];
  /** @type {{ ok: () => void, falha: () => void }[]} */
  const portas = [];
  return {
    chamadas,
    portas,
    alertar: (/** @type {any} */ a) => {
      chamadas.push(a);
      return new Promise((resolve, reject) => portas.push({ ok: () => resolve(undefined), falha: () => reject(new Error("falhou")) }));
    },
  };
}
const situacoes = (/** @type {any[]} */ alertas) => alertas.map((a) => `${a.chamada_wa_id}:${a.situacao}`);
/** @param {string} status @param {string} id */
const evFimDe = (status, id) => ({ ...evFim(status), id });

test("alertar: offer em tempo real → um TOCANDO na hora (uma vez por id), com video, from e group_jid", () => {
  const { consolidador, alertas, registros } = montar({ coletar: true });
  consolidador.tratarEvento([ev("offer"), ev("offer"), ev("ringing")]);
  consolidador.tratarEvento([ev("offer", { id: "G1", isGroup: true, groupJid: GRUPO, isVideo: false })]);
  assert.deepEqual(alertas, [
    { chamada_wa_id: "CALL1", situacao: "TOCANDO", video: true, from: LID, group_jid: null },
    { chamada_wa_id: "G1", situacao: "TOCANDO", video: false, from: LID, group_jid: GRUPO },
  ]);
  assert.equal(registros.length, 0, "tocar não registra nada");
});

test("alertar: PAROU no terminate, na hora e sem esperar a janela do accept (o registro é que espera)", async () => {
  const { consolidador, alertas, registros, avancar } = montar({ coletar: true });
  consolidador.tratarEvento([ev("offer"), ev("terminate")]);
  await avancar(0);
  assert.deepEqual(situacoes(alertas), ["CALL1:TOCANDO", "CALL1:PAROU"]);
  assert.equal(registros.length, 0);
  await avancar(JANELA - 1);
  assert.equal(registros.length, 0);
  assert.equal(alertas.length, 2);
  consolidador.tratarEvento([evFim("accept")]);
  await avancar(0);
  assert.deepEqual(situacoes(alertas), ["CALL1:TOCANDO", "CALL1:PAROU"], "o accept tardio não gera outro PAROU");
  assert.deepEqual(registros.map((r) => r.resultado), ["ATENDIDA"]);
});

test("alertar: PAROU no reject, no accept antes do terminate, no timeout e no teto, uma vez por id", async () => {
  const { consolidador, alertas, avancar } = montar({ coletar: true });
  consolidador.tratarEvento([ev("offer", { id: "R" }), ev("reject", { id: "R" }), ev("terminate", { id: "R" }), ev("reject", { id: "R" })]);
  consolidador.tratarEvento([ev("offer", { id: "A" }), evFimDe("accept", "A"), ev("terminate", { id: "A" })]);
  consolidador.tratarEvento([ev("offer", { id: "T" }), ev("timeout", { id: "T" }), ev("terminate", { id: "T" })]);
  consolidador.tratarEvento([ev("offer", { id: "E" })]);
  await avancar(TETO);
  await avancar(JANELA * 2);
  assert.deepEqual(situacoes(alertas).sort(), ["A:PAROU", "A:TOCANDO", "E:PAROU", "E:TOCANDO", "R:PAROU", "R:TOCANDO", "T:PAROU", "T:TOCANDO"]);
});

test("alertar: o PAROU espera o TOCANDO pendente terminar (resposta ou falha), nunca sai antes", async () => {
  const manual = alertarManual();
  const { consolidador, avancar } = montar({ alertar: manual.alertar });
  consolidador.tratarEvento([ev("offer", { id: "L1" }), ev("reject", { id: "L1" })]);
  consolidador.tratarEvento([ev("offer", { id: "L2" }), ev("reject", { id: "L2" })]);
  await avancar(0);
  assert.deepEqual(situacoes(manual.chamadas), ["L1:TOCANDO", "L2:TOCANDO"]);
  manual.portas[0].ok();
  await avancar(0);
  assert.deepEqual(situacoes(manual.chamadas), ["L1:TOCANDO", "L2:TOCANDO", "L1:PAROU"]);
  manual.portas[1].falha(); // falha do TOCANDO: o PAROU sai mesmo assim
  await avancar(0);
  assert.deepEqual(situacoes(manual.chamadas), ["L1:TOCANDO", "L2:TOCANDO", "L1:PAROU", "L2:PAROU"]);
});

test("alertar: falha do TOCANDO vai a aoFalhar e não impede o registro", async () => {
  const manual = alertarManual();
  const { consolidador, registros, falhas, avancar } = montar({ alertar: manual.alertar });
  consolidador.tratarEvento([ev("offer"), ev("reject")]);
  manual.portas[0].falha();
  await avancar(0);
  assert.deepEqual(registros.map((r) => r.resultado), ["RECUSADA"]);
  assert.deepEqual(falhas.map((f) => /** @type {any[]} */ (f)[0]), ["alertar"]);
});

test("alertar: limpar() com o TOCANDO pendente descarta o PAROU, e nada é publicado depois (corte por geração)", async () => {
  const manual = alertarManual();
  const { consolidador, registros, avancar } = montar({ alertar: manual.alertar });
  consolidador.tratarEvento([ev("offer"), ev("reject")]);
  consolidador.limpar();
  manual.portas[0].ok();
  await avancar(TETO * 2);
  assert.deepEqual(situacoes(manual.chamadas), ["CALL1:TOCANDO"], "o PAROU pendente foi descartado");
  assert.equal(registros.length, 1, "o registro RECUSADA já tinha saído antes do limpar; nada novo depois");
  consolidador.tratarEvento([ev("offer", { id: "N1" })]);
  assert.deepEqual(situacoes(manual.chamadas), ["CALL1:TOCANDO", "N1:TOCANDO"], "uma chamada nova depois do limpar funciona");
});

test("alertar: limpar() logo depois do terminate cancela a janela e o PAROU: nada vaza", async () => {
  const { consolidador, alertas, registros, avancar } = montar({ coletar: true });
  consolidador.tratarEvento([ev("offer"), ev("terminate")]);
  consolidador.limpar();
  await avancar(TETO * 2);
  assert.equal(registros.length, 0);
  assert.deepEqual(situacoes(alertas), ["CALL1:TOCANDO"], "o PAROU ainda na fila do TOCANDO foi descartado pelo limpar");
});

test("alertar: offline não alerta (nem TOCANDO nem PAROU), e o registro segue", async () => {
  const { consolidador, alertas, registros, avancar } = montar({ coletar: true });
  consolidador.tratarEvento([ev("offer", { offline: true }), ev("terminate", { offline: true })]);
  await avancar(JANELA);
  assert.equal(alertas.length, 0);
  assert.deepEqual(registros.map((r) => r.resultado), ["PERDIDA"]);
});

test("alertar: evento final sem offer não alerta (não houve toque observado)", () => {
  const { consolidador, alertas, registros } = montar({ coletar: true });
  consolidador.tratarEvento([evFim("reject")]);
  assert.equal(alertas.length, 0);
  assert.equal(registros.length, 1);
});

test("alertar: falha síncrona do alertar é contida e vai a aoFalhar", () => {
  const { consolidador, falhas } = montar({
    alertar: () => {
      throw new Error("síncrona");
    },
  });
  consolidador.tratarEvento([ev("offer")]);
  assert.equal(falhas.length, 1);
});
