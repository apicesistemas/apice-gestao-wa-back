// @ts-check
// Menções detalhadas (função pura): par LID ↔ telefone pelo resolvedor e pelos participantes do grupo,
// `propria` para o número da equipe, e sem par o campo fica null. Todos os números são fictícios.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { detalharMencoes } = require("../../src/whatsapp/mencoesEntrada");
const { criarResolvedorLid } = require("../../src/whatsapp/resolverLid");
const { EU, TELEFONE_EQUIPE } = require("../helpers/mensagensWa");

const LID = "10000000000001@lid";
const FONE = "5511900000003";

test("LID com par no resolvedor ganha o telefone; a lista `mencoes` de origem não é alterada", () => {
  const resolvedorLid = criarResolvedorLid();
  resolvedorLid.aprenderPar(LID, FONE);
  const mencoes = [LID];
  assert.deepEqual(detalharMencoes(mencoes, { resolvedorLid, eu: EU }), [{ jid: LID, lid: LID, telefone: FONE, propria: false }]);
  assert.deepEqual(mencoes, [LID]);
});

test("sem resolvedor, o par vem dos participantes (por jid, lid ou telefone)", () => {
  const participantes = [{ jid: LID, lid: LID, telefone: FONE, admin: false }];
  assert.deepEqual(detalharMencoes([LID], { participantes }), [{ jid: LID, lid: LID, telefone: FONE, propria: false }]);
  // menção pelo telefone: o LID vem do participante
  assert.deepEqual(detalharMencoes([`${FONE}@s.whatsapp.net`], { participantes }), [
    { jid: `${FONE}@s.whatsapp.net`, lid: LID, telefone: FONE, propria: false },
  ]);
});

test("sem par conhecido: telefone null (ou lid null) e o item continua na lista", () => {
  const resolvedorLid = criarResolvedorLid();
  assert.deepEqual(detalharMencoes([LID, `${FONE}@s.whatsapp.net`], { resolvedorLid, participantes: [], eu: EU }), [
    { jid: LID, lid: LID, telefone: null, propria: false },
    { jid: `${FONE}@s.whatsapp.net`, lid: null, telefone: FONE, propria: false },
  ]);
});

test("propria: o número da equipe, por LID ou por telefone, com o sufixo de aparelho ignorado", () => {
  const detalhes = detalharMencoes(["100000000000099@lid", `${TELEFONE_EQUIPE}@s.whatsapp.net`, LID], { eu: EU });
  assert.deepEqual(detalhes.map((d) => d.propria), [true, true, false]);
  // LID da equipe mencionado e telefone conhecido pelo resolvedor
  const resolvedorLid = criarResolvedorLid();
  resolvedorLid.aprenderPar("100000000000099@lid", TELEFONE_EQUIPE);
  assert.equal(detalharMencoes(["100000000000099@lid"], { resolvedorLid, eu: { jid: undefined, lid: undefined } })[0].propria, false);
  assert.equal(detalharMencoes(["100000000000099@lid"], { resolvedorLid, eu: { jid: EU.jid } })[0].propria, true);
});

test("entrada inválida: lista vazia, jid inválido ou acima de 100 caracteres são descartados", () => {
  assert.deepEqual(detalharMencoes([]), []);
  assert.deepEqual(detalharMencoes(/** @type {any} */ (null)), []);
  assert.deepEqual(detalharMencoes(["abc", `${"1".repeat(100)}@lid`, /** @type {any} */ (7)]), []);
});
