// @ts-check
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  ativarLogEmArquivo,
  limparLogsAntigos,
  mascararTelefone,
  mascararTelefonesNoTexto,
  nomeArquivoDoDia,
} = require("../../src/utils/logArquivo");

function criarDiretorioTemporario() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "wa-back-logs-"));
}

test("mascararTelefone mantém só o início e os 4 últimos dígitos", () => {
  assert.equal(mascararTelefone("5544998131290"), "55449****1290");
  assert.equal(mascararTelefone("123"), "****");
  assert.equal(mascararTelefone(undefined), "****");
});

test("mascararTelefonesNoTexto mascara telefones e JIDs dentro de uma linha de log", () => {
  const linha = "[ENTRADA] mensagem de 5544998131290@s.whatsapp.net para 4499813129 recebida";
  const mascarada = mascararTelefonesNoTexto(linha);
  assert.ok(!mascarada.includes("5544998131290"));
  assert.ok(!mascarada.includes("4499813129"));
  assert.match(mascarada, /55449\*\*\*\*1290@s\.whatsapp\.net/);
  assert.match(mascarada, /44998\*\*\*\*3129/);
  // números curtos (contadores, códigos) não são tocados
  assert.equal(mascararTelefonesNoTexto("cod_equipe 42 em 350 ms"), "cod_equipe 42 em 350 ms");
});

test("ativarLogEmArquivo grava em LOGS/ com o telefone mascarado e pode ser desativado", () => {
  const diretorio = criarDiretorioTemporario();
  /** @type {string[]} */
  const saidaConsole = [];
  const logOriginal = console.log;
  console.log = (...args) => {
    saidaConsole.push(args.join(" "));
  };
  try {
    const desativar = ativarLogEmArquivo({ diretorio });
    console.log("[TESTE] contato", "5544998131290", { cod_equipe: 7 });
    desativar();
    console.log("[TESTE] depois de desativar");
  } finally {
    console.log = logOriginal;
  }

  const arquivo = path.join(diretorio, nomeArquivoDoDia(new Date()));
  const conteudo = fs.readFileSync(arquivo, "utf8");
  assert.match(conteudo, /\[TESTE\] contato 55449\*\*\*\*1290/);
  assert.ok(!conteudo.includes("5544998131290"));
  assert.ok(!conteudo.includes("depois de desativar"));
  // o console também recebe a versão mascarada
  assert.ok(saidaConsole.some((linha) => linha.includes("55449****1290")));
  assert.ok(!saidaConsole.some((linha) => linha.includes("5544998131290")));
  fs.rmSync(diretorio, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

test("limparLogsAntigos remove só logs com mais de 10 dias", () => {
  const diretorio = criarDiretorioTemporario();
  const agora = new Date(2026, 9, 14, 12, 0, 0);
  /** @param {number} n */
  const dias = (n) => new Date(agora.getTime() - n * 24 * 60 * 60 * 1000);

  const antigo = nomeArquivoDoDia(dias(11));
  const limite = nomeArquivoDoDia(dias(10));
  const recente = nomeArquivoDoDia(dias(1));
  for (const nome of [antigo, limite, recente, "outro-arquivo.txt"]) {
    fs.writeFileSync(path.join(diretorio, nome), "x");
  }

  const removidos = limparLogsAntigos({ diretorio, agora });

  const restantes = fs.readdirSync(diretorio).sort();
  assert.deepEqual(removidos, [antigo]);
  assert.deepEqual(restantes, [limite, recente, "outro-arquivo.txt"].sort());
  fs.rmSync(diretorio, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

test("limparLogsAntigos não falha quando o diretório não existe", () => {
  const inexistente = path.join(os.tmpdir(), "wa-back-logs-inexistente-" + Date.now());
  assert.deepEqual(limparLogsAntigos({ diretorio: inexistente }), []);
});
