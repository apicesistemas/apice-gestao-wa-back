// @ts-check
// Recuperação das mensagens entregues na reconexão (Task 14.3): deduplicação local por
// (cod_equipe, mensagem_wa_id) com TTL, janela de tempo do `append` desde a última atividade
// conhecida da instância e a persistência dessa atividade entre reinícios (`.cache/`, só o instante).
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  criarRecuperacao,
  criarArmazemAtividade,
  obterJanelaRecuperacaoMs,
  JANELA_RECUPERACAO_PADRAO_MS,
  FOLGA_RECUPERACAO_S,
  INTERVALO_GRAVACAO_ATIVIDADE_S,
} = require("../../src/whatsapp/recuperacao");

const pasta = fs.mkdtempSync(path.join(os.tmpdir(), "wa-back-recuperacao-"));
after(() => fs.rmSync(pasta, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));

/** Relógio falso em ms. */
function relogio(inicioMs = 1_800_000_000_000) {
  let ms = inicioMs;
  return {
    agora: () => ms,
    /** @param {number} delta */
    avancar: (delta) => {
      ms += delta;
    },
    segundos: () => Math.floor(ms / 1000),
  };
}

test("uma mensagem marcada como processada é reconhecida até o TTL e esquecida depois", () => {
  const r = relogio();
  const rec = criarRecuperacao({ codEquipe: "21", agora: r.agora, ttlMs: 1000 });
  assert.equal(rec.jaProcessada("ID1"), false);
  rec.marcarProcessada("ID1");
  assert.equal(rec.jaProcessada("ID1"), true);
  r.avancar(1001);
  assert.equal(rec.jaProcessada("ID1"), false);
});

test("o cache de processadas tem teto: a mais antiga sai primeiro", () => {
  const rec = criarRecuperacao({ codEquipe: "21", maxProcessadas: 2 });
  rec.marcarProcessada("A");
  rec.marcarProcessada("B");
  rec.marcarProcessada("C");
  assert.equal(rec.jaProcessada("A"), false);
  assert.equal(rec.jaProcessada("B"), true);
  assert.equal(rec.jaProcessada("C"), true);
});

test("a deduplicação é por equipe: o mesmo id em outra equipe não é afetado", () => {
  const armazem = criarArmazemAtividade({ caminho: null });
  const a = criarRecuperacao({ codEquipe: "21", armazem });
  const b = criarRecuperacao({ codEquipe: "22", armazem });
  a.marcarProcessada("MESMO");
  assert.equal(a.jaProcessada("MESMO"), true);
  assert.equal(b.jaProcessada("MESMO"), false);
});

test("notify (tempo real) sempre passa pela janela; append sem timestamp também", () => {
  const r = relogio();
  const rec = criarRecuperacao({ codEquipe: "21", agora: r.agora, janelaMs: 60_000 });
  rec.iniciarSessao();
  assert.equal(rec.dentroDaJanela(r.segundos() - 10 * 24 * 3600, "notify"), true);
  assert.equal(rec.dentroDaJanela(null, "append"), true);
});

test("sem atividade conhecida (primeiro pareamento), o append só entra dentro da janela do ambiente", () => {
  const r = relogio();
  const rec = criarRecuperacao({ codEquipe: "21", agora: r.agora, janelaMs: 3600_000 });
  rec.iniciarSessao();
  assert.equal(rec.dentroDaJanela(r.segundos() - 1800, "append"), true);
  assert.equal(rec.dentroDaJanela(r.segundos() - 2 * 3600, "append"), false);
});

test("com atividade conhecida, o append entra desde a última atividade (com folga), mesmo além da janela", () => {
  const r = relogio();
  const armazem = criarArmazemAtividade({ caminho: null });
  const anterior = criarRecuperacao({ codEquipe: "21", agora: r.agora, armazem, janelaMs: 3600_000 });
  anterior.registrarAtividade({ forcar: true });
  const ultimaAtividade = r.segundos();

  // Ficou 5 dias fora: tudo o que chegou depois da última atividade é recuperado.
  r.avancar(5 * 24 * 3600_000);
  const rec = criarRecuperacao({ codEquipe: "21", agora: r.agora, armazem, janelaMs: 3600_000 });
  rec.iniciarSessao();
  assert.equal(rec.dentroDaJanela(ultimaAtividade + 60, "append"), true);
  assert.equal(rec.dentroDaJanela(ultimaAtividade - FOLGA_RECUPERACAO_S + 1, "append"), true);
  assert.equal(rec.dentroDaJanela(ultimaAtividade - FOLGA_RECUPERACAO_S - 3600, "append"), false);
});

test("o corte da sessão é fixado na abertura: a atividade registrada depois não descarta o atraso da fila offline", () => {
  const r = relogio();
  const armazem = criarArmazemAtividade({ caminho: null });
  const rec = criarRecuperacao({ codEquipe: "21", agora: r.agora, armazem, janelaMs: 3600_000 });
  rec.registrarAtividade({ forcar: true });
  r.avancar(2 * 3600_000); // 2 h fora do ar
  rec.iniciarSessao();
  rec.registrarAtividade({ forcar: true }); // a sessão nova já registrou atividade
  assert.equal(rec.dentroDaJanela(r.segundos() - 3600, "append"), true, "mensagem de 1 h atrás (durante a queda)");
});

test("a última atividade é gravada em arquivo e sobrevive a um reinício (novo armazém lendo o mesmo arquivo)", () => {
  const caminho = path.join(pasta, "atividade-reinicio.json");
  const r = relogio();
  const armazem = criarArmazemAtividade({ caminho });
  armazem.registrar("21", r.segundos(), { forcar: true });

  const depoisDoReinicio = criarArmazemAtividade({ caminho });
  assert.equal(depoisDoReinicio.ler("21"), r.segundos());
  assert.equal(depoisDoReinicio.ler("22"), null);
  // Só o instante por equipe: nenhum dado de mensagem vai para o arquivo.
  assert.deepEqual(JSON.parse(fs.readFileSync(caminho, "utf8")), { 21: r.segundos() });
});

test("a gravação em arquivo é espaçada: registros seguidos só gravam depois do intervalo (ou forçados)", () => {
  const caminho = path.join(pasta, "atividade-intervalo.json");
  const armazem = criarArmazemAtividade({ caminho });
  armazem.registrar("21", 1000, { forcar: true });
  armazem.registrar("21", 1010);
  assert.equal(JSON.parse(fs.readFileSync(caminho, "utf8"))["21"], 1000, "dentro do intervalo não grava");
  assert.equal(armazem.ler("21"), 1010, "a memória sempre tem o valor atual");
  armazem.registrar("21", 1000 + INTERVALO_GRAVACAO_ATIVIDADE_S);
  assert.equal(JSON.parse(fs.readFileSync(caminho, "utf8"))["21"], 1000 + INTERVALO_GRAVACAO_ATIVIDADE_S);
  armazem.registrar("21", 1000 + INTERVALO_GRAVACAO_ATIVIDADE_S + 1, { forcar: true });
  assert.equal(JSON.parse(fs.readFileSync(caminho, "utf8"))["21"], 1000 + INTERVALO_GRAVACAO_ATIVIDADE_S + 1);
});

test("a atividade nunca regride, e o logout (limpar) esquece a atividade e as processadas da equipe", () => {
  const caminho = path.join(pasta, "atividade-limpar.json");
  const armazem = criarArmazemAtividade({ caminho });
  armazem.registrar("21", 2000, { forcar: true });
  armazem.registrar("21", 1500, { forcar: true });
  assert.equal(armazem.ler("21"), 2000);

  const rec = criarRecuperacao({ codEquipe: "21", armazem });
  rec.marcarProcessada("X");
  rec.limpar();
  assert.equal(rec.jaProcessada("X"), false);
  assert.equal(armazem.ler("21"), null);
  assert.deepEqual(JSON.parse(fs.readFileSync(caminho, "utf8")), {});
});

test("um arquivo de atividade ilegível é ignorado (vale a janela do ambiente), sem derrubar nada", () => {
  const caminho = path.join(pasta, "atividade-quebrada.json");
  fs.writeFileSync(caminho, "{ não é json");
  const armazem = criarArmazemAtividade({ caminho });
  assert.equal(armazem.ler("21"), null);
});

test("sem caminho, o armazém fica só em memória (nenhum arquivo)", () => {
  const armazem = criarArmazemAtividade({ caminho: null });
  armazem.registrar("21", 123, { forcar: true });
  assert.equal(armazem.ler("21"), 123);
});

test("obterJanelaRecuperacaoMs lê RECUPERACAO_JANELA_MS e cai no padrão quando vazio ou inválido", () => {
  assert.equal(obterJanelaRecuperacaoMs({}), JANELA_RECUPERACAO_PADRAO_MS);
  assert.equal(obterJanelaRecuperacaoMs({ RECUPERACAO_JANELA_MS: "" }), JANELA_RECUPERACAO_PADRAO_MS);
  assert.equal(obterJanelaRecuperacaoMs({ RECUPERACAO_JANELA_MS: "abc" }), JANELA_RECUPERACAO_PADRAO_MS);
  assert.equal(obterJanelaRecuperacaoMs({ RECUPERACAO_JANELA_MS: "-5" }), JANELA_RECUPERACAO_PADRAO_MS);
  assert.equal(obterJanelaRecuperacaoMs({ RECUPERACAO_JANELA_MS: "3600000" }), 3600_000);
});
