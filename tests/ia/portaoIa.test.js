// @ts-check
// Portão de concorrência da IA de texto (Fase 31, Task 31.1): vagas, espera descontada do prazo,
// vez liberada no finally e leitura do ambiente.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { criarPortaoIa, concorrenciaDoAmbiente, portaoPadrao, CONCORRENCIA_PADRAO } = require("../../src/ia/portaoIa");

/** @param {number} ms */
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

test("concorrenciaDoAmbiente: padrão 1, aceita inteiro ≥ 1 e ignora lixo", () => {
  assert.equal(CONCORRENCIA_PADRAO, 1);
  assert.equal(concorrenciaDoAmbiente({}), 1);
  assert.equal(concorrenciaDoAmbiente({ MINIMAX_IA_CONCORRENCIA: " 3 " }), 3);
  for (const ruim of ["0", "-1", "1.5", "abc", ""]) assert.equal(concorrenciaDoAmbiente({ MINIMAX_IA_CONCORRENCIA: ruim }), 1);
});

test("portaoPadrao devolve sempre o mesmo portão do processo", () => {
  assert.equal(portaoPadrao(), portaoPadrao());
});

test("concorrência 1: a 2ª espera a 1ª terminar e a espera é descontada do prazo", async () => {
  const portao = criarPortaoIa(1);
  /** @type {string[]} */
  const ordem = [];
  /** @type {(() => void)} */
  let soltar = () => {};
  const primeira = portao.executar(1000, async () => {
    ordem.push("1-inicio");
    await new Promise((r) => (soltar = () => r(undefined)));
    ordem.push("1-fim");
    return "a";
  });
  await esperar(5);
  /** @type {number | null} */
  let restante = null;
  const segunda = portao.executar(1000, async (r) => {
    ordem.push("2-inicio");
    restante = r;
    return "b";
  });
  await esperar(60);
  assert.deepEqual(ordem, ["1-inicio"], "a 2ª ainda espera");
  soltar();
  assert.deepEqual(await primeira, { prazoEsgotado: false, valor: "a" });
  assert.deepEqual(await segunda, { prazoEsgotado: false, valor: "b" });
  assert.deepEqual(ordem, ["1-inicio", "1-fim", "2-inicio"]);
  assert.ok(restante !== null && restante < 1000 - 50, `o restante desconta a espera (${restante})`);
});

test("quem espera a vaga além do prazo desiste sem executar e sai da fila", async () => {
  const portao = criarPortaoIa(1);
  /** @type {(() => void)} */
  let soltar = () => {};
  const primeira = portao.executar(5000, () => new Promise((r) => (soltar = () => r("a"))));
  await esperar(5);
  let rodou = false;
  const segunda = await portao.executar(30, async () => {
    rodou = true;
  });
  assert.deepEqual(segunda, { prazoEsgotado: true });
  assert.equal(rodou, false);
  // A desistente não ficou na fila: uma 3ª recebe a vaga assim que a 1ª sai.
  const terceira = portao.executar(1000, async () => "c");
  soltar();
  await primeira;
  assert.deepEqual(await terceira, { prazoEsgotado: false, valor: "c" });
});

test("vaga livre mas prazo já consumido pelo relógio não executa a tarefa", async () => {
  let rodou = false;
  const livre = await criarPortaoIa(1).executar(100, async () => {
    rodou = true;
  });
  assert.equal(livre.prazoEsgotado, false);
  assert.equal(rodou, true);

  let agora = 0;
  const portao = criarPortaoIa(1, () => (agora += 200));
  rodou = false;
  const r = await portao.executar(100, async () => {
    rodou = true;
  });
  assert.deepEqual(r, { prazoEsgotado: true });
  assert.equal(rodou, false);
});

test("erro numa tarefa libera a vaga e não trava a próxima", async () => {
  const portao = criarPortaoIa(1);
  const falhou = portao.executar(1000, async () => {
    throw new Error("falha");
  });
  const proxima = portao.executar(1000, async () => "ok");
  await assert.rejects(falhou, /falha/);
  assert.deepEqual(await proxima, { prazoEsgotado: false, valor: "ok" });
});

test("concorrência 2: duas rodam juntas, a 3ª espera", async () => {
  const portao = criarPortaoIa(2);
  let ativas = 0;
  let pico = 0;
  const tarefa = async () => {
    ativas += 1;
    pico = Math.max(pico, ativas);
    await esperar(20);
    ativas -= 1;
  };
  await Promise.all([1, 2, 3].map(() => portao.executar(2000, tarefa)));
  assert.equal(pico, 2);
  assert.equal(portao.concorrencia, 2);
});
