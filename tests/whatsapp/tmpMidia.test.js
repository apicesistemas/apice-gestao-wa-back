// @ts-check
// Exceção 14b (aceita pelo responsável do projeto em 2026-10-14): no envio de mídia, o Baileys
// 6.7.24 grava um temporário cifrado durante o upload. Estes testes garantem que ele cai numa pasta
// dedicada (limpa no boot e no desligamento), que é cifrado, que não há cópia do original e que
// some tanto no sucesso quanto na falha do upload. A parte de integração usa o Baileys REAL
// (`prepareWAMessageMedia`), com um upload falso no lugar da rede.
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  configurarPastaTemporaria,
  limparPastaTemporaria,
  limparPastaConfigurada,
  criarRastreadorUploads,
  NOME_PASTA_TMP_MIDIA,
} = require("../../src/whatsapp/tmpMidia");
const { montarConteudo } = require("../../src/whatsapp/envio");
const arquivos = require("../helpers/arquivosMidia");

const VARS_TMP = ["TMPDIR", "TMP", "TEMP"];
const envOriginal = Object.fromEntries(VARS_TMP.map((nome) => [nome, process.env[nome]]));
const raizTeste = fs.mkdtempSync(path.join(os.tmpdir(), "wa-back-tmp-midia-"));
after(() => {
  for (const nome of VARS_TMP) {
    if (envOriginal[nome] === undefined) delete process.env[nome];
    else process.env[nome] = envOriginal[nome];
  }
  fs.rmSync(raizTeste, { recursive: true, force: true });
});

/** @param {string} sufixo */
const pastaDedicada = (sufixo) => path.join(raizTeste, sufixo, NOME_PASTA_TMP_MIDIA);

/**
 * O conteúdo que o nosso envio entrega ao Baileys (o mesmo `montarConteudo` do `sendMessage`).
 * @param {any} conteudo
 * @returns {any}
 */
const conteudoBaileys = (conteudo) => montarConteudo(conteudo);

/** Baileys real (ESM), carregado uma vez. */
const baileysReal = import("@whiskeysockets/baileys");

test("sem configurar, limparPastaConfigurada não mexe em nada e devolve 0", () => {
  assert.equal(limparPastaConfigurada(), 0);
});

test("configurarPastaTemporaria cria a pasta dedicada e aponta TMPDIR/TMP/TEMP (e o os.tmpdir) para ela", () => {
  const pasta = pastaDedicada("config");
  /** @type {Record<string, string | undefined>} */
  const env = {};
  const { pasta: configurada, removidos } = configurarPastaTemporaria({ pasta, env });
  assert.equal(configurada, path.resolve(pasta));
  assert.equal(removidos, 0);
  assert.ok(fs.statSync(pasta).isDirectory());
  assert.deepEqual(env, { TMPDIR: path.resolve(pasta), TMP: path.resolve(pasta), TEMP: path.resolve(pasta) });

  // No process.env real, o os.tmpdir() (que o Baileys lê a cada arquivo) passa a ser a pasta dedicada.
  configurarPastaTemporaria({ pasta });
  assert.equal(path.resolve(os.tmpdir()), path.resolve(pasta));
});

test("no boot, o que sobrou de uma execução anterior (queda no meio do upload) é apagado", () => {
  const pasta = pastaDedicada("boot");
  fs.mkdirSync(pasta, { recursive: true });
  fs.writeFileSync(path.join(pasta, "image3EB0ABC-enc"), Buffer.alloc(16, 1));
  fs.writeFileSync(path.join(pasta, "document3EB0DEF-enc"), Buffer.alloc(16, 2));
  const { removidos } = configurarPastaTemporaria({ pasta, env: {} });
  assert.equal(removidos, 2);
  assert.deepEqual(fs.readdirSync(pasta), []);
});

test("limparPastaConfigurada apaga o conteúdo da pasta configurada (desligamento) e mantém a pasta", () => {
  const pasta = pastaDedicada("desligamento");
  configurarPastaTemporaria({ pasta, env: {} });
  fs.writeFileSync(path.join(pasta, "video3EB0123-enc"), Buffer.alloc(8));
  assert.equal(limparPastaConfigurada(), 1);
  assert.deepEqual(fs.readdirSync(pasta), []);
  assert.ok(fs.statSync(pasta).isDirectory());
});

test("limparPastaTemporaria recusa uma pasta que não é a dedicada (nunca limpa o temporário do sistema)", () => {
  const outra = path.join(raizTeste, "outra");
  fs.mkdirSync(outra, { recursive: true });
  fs.writeFileSync(path.join(outra, "nao-apagar"), "x");
  assert.throws(() => limparPastaTemporaria(outra), /pasta temporária dedicada/);
  assert.throws(() => configurarPastaTemporaria({ pasta: outra, env: {} }), /pasta temporária dedicada/);
  assert.ok(fs.existsSync(path.join(outra, "nao-apagar")));
});

test("limparPastaTemporaria numa pasta que não existe devolve 0", () => {
  assert.equal(limparPastaTemporaria(pastaDedicada("inexistente")), 0);
});

/**
 * Pasta dedicada configurada no process.env real, para o Baileys gravar nela.
 * @param {string} sufixo
 */
function configurarParaBaileys(sufixo) {
  const pasta = pastaDedicada(sufixo);
  configurarPastaTemporaria({ pasta });
  return pasta;
}

test("Baileys real: o upload de imagem grava só o temporário cifrado (-enc) na pasta dedicada e o apaga ao fim", async () => {
  const { prepareWAMessageMedia } = await baileysReal;
  const pasta = configurarParaBaileys("baileys-sucesso");
  const marcador = Buffer.from("CONTEUDO-EM-CLARO-DA-IMAGEM-".repeat(8), "latin1");
  const jpeg = Buffer.concat([arquivos.jpeg(), marcador]);
  /** @type {{ nomes: string[], conteudo: Buffer | null, timeoutMs: number | undefined }} */
  const visto = { nomes: [], conteudo: null, timeoutMs: undefined };

  await prepareWAMessageMedia(conteudoBaileys({ midia: { buffer: jpeg, mimetype: "image/jpeg" } }), {
    mediaUploadTimeoutMs: 1234,
    upload: async (caminho, { timeoutMs }) => {
      // O Baileys não espera o flush do arquivo: espera o conteúdo cifrado inteiro (polling, sem sleep fixo).
      for (let i = 0; i < 1000 && !(fs.existsSync(caminho) && fs.statSync(caminho).size >= jpeg.length); i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
      visto.nomes = fs.readdirSync(pasta);
      visto.conteudo = fs.readFileSync(caminho);
      visto.timeoutMs = timeoutMs;
      assert.equal(path.dirname(path.resolve(caminho)), path.resolve(pasta));
      return { mediaUrl: "https://mmg.whatsapp.net/x", directPath: "/x" };
    },
  });

  assert.equal(visto.nomes.length, 1, "um único temporário, sem cópia do original");
  assert.match(visto.nomes[0], /^image.+-enc$/);
  assert.ok(visto.conteudo && visto.conteudo.length >= jpeg.length, "o temporário tem o conteúdo cifrado inteiro");
  assert.equal(visto.conteudo?.includes(marcador.subarray(0, 28)), false, "o temporário não tem o conteúdo em claro");
  assert.equal(visto.timeoutMs, 1234, "o prazo do upload chega ao upload");
  assert.deepEqual(fs.readdirSync(pasta), [], "o temporário foi apagado depois do upload");
});

test("Baileys real: se o upload falha, o envio rejeita e o temporário cifrado também é apagado", async () => {
  const { prepareWAMessageMedia } = await baileysReal;
  const pasta = configurarParaBaileys("baileys-falha");
  let viuArquivo = false;
  await assert.rejects(
    prepareWAMessageMedia(conteudoBaileys({ midia: { buffer: arquivos.pdf(), mimetype: "application/pdf", nome: "a.pdf" } }), {
      upload: async () => {
        for (let i = 0; i < 1000 && fs.readdirSync(pasta).length !== 1; i += 1) await new Promise((resolve) => setTimeout(resolve, 5)); // espera o arquivo ser criado
        viuArquivo = fs.readdirSync(pasta).length === 1;
        throw new Error("Media upload failed on all hosts");
      },
    }),
    /Media upload failed/
  );
  assert.equal(viuArquivo, true);
  assert.deepEqual(fs.readdirSync(pasta), []);
});

test("Baileys real: nota de voz (com seconds) e vídeo (jpegThumbnail null) não geram cópia do original", async () => {
  const { prepareWAMessageMedia } = await baileysReal;
  const pasta = configurarParaBaileys("baileys-sem-original");
  for (const midia of [
    { buffer: arquivos.oggOpus(3), mimetype: "audio/ogg", ptt: true },
    { buffer: arquivos.mp4(), mimetype: "video/mp4" },
  ]) {
    /** @type {string[]} */
    let nomes = [];
    await prepareWAMessageMedia(conteudoBaileys({ midia }), {
      upload: async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        nomes = fs.readdirSync(pasta);
        return { mediaUrl: "https://mmg.whatsapp.net/x", directPath: "/x" };
      },
    });
    assert.equal(nomes.length, 1);
    assert.match(nomes[0], /-enc$/);
    assert.deepEqual(fs.readdirSync(pasta), []);
  }
});

test("Baileys real: upload que falha na hora pode deixar o -enc órfão (corrida do Baileys) e a varredura o apaga", async () => {
  // O `encryptedStream` não espera o `createWriteStream` abrir: se o upload falha antes disso, o
  // `unlink` do Baileys dá ENOENT ("failed to remove tmp file") e o arquivo é criado logo depois.
  const { prepareWAMessageMedia } = await baileysReal;
  const pasta = configurarParaBaileys("baileys-corrida");
  const rastreador = criarRastreadorUploads({ limpar: limparPastaConfigurada, atrasoMs: 50 });
  const concluir = rastreador.iniciar();
  await assert.rejects(
    prepareWAMessageMedia(conteudoBaileys({ midia: { buffer: arquivos.pdf(), mimetype: "application/pdf" } }), {
      upload: async () => {
        throw new Error("Media upload failed on all hosts");
      },
    })
  );
  concluir();
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.deepEqual(fs.readdirSync(pasta), [], "nenhum temporário sobra depois da varredura");
});

test("rastreador: a varredura roda uma vez, depois do atraso, quando o último upload termina", async () => {
  let limpezas = 0;
  const rastreador = criarRastreadorUploads({ limpar: () => void (limpezas += 1), atrasoMs: 15 });
  const a = rastreador.iniciar();
  const b = rastreador.iniciar();
  a();
  a(); // concluir duas vezes não conta duas vezes
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(limpezas, 0, "com upload em andamento não varre");
  assert.equal(rastreador.emAndamento(), 1);
  b();
  assert.equal(limpezas, 0, "só depois do atraso");
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(limpezas, 1);
  assert.equal(rastreador.emAndamento(), 0);
});

test("rastreador: um upload que começa durante o atraso cancela a varredura", async () => {
  let limpezas = 0;
  const rastreador = criarRastreadorUploads({ limpar: () => void (limpezas += 1), atrasoMs: 30 });
  rastreador.iniciar()();
  await new Promise((resolve) => setTimeout(resolve, 10));
  const outro = rastreador.iniciar();
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(limpezas, 0);
  outro();
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(limpezas, 1);
});

test("rastreador: uma falha na limpeza só vai ao log", async () => {
  const rastreador = criarRastreadorUploads({
    limpar: () => {
      throw new Error("EBUSY");
    },
    atrasoMs: 5,
  });
  rastreador.iniciar()();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(rastreador.emAndamento(), 0);
});
