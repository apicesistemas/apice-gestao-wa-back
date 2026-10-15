// @ts-check
// Pasta temporária dedicada ao upload de mídia do Baileys (exceção 14b, aceita pelo responsável do
// projeto em 2026-10-14).
//
// O Baileys 6.7.24 (`encryptedStream` em lib/Utils/messages-media.js, chamado por
// `prepareWAMessageMedia` em lib/Utils/messages.js) cifra a mídia enviada num arquivo
// `<tipo><id>-enc` em `os.tmpdir()` e o sobe por `createReadStream`. Ele apaga o arquivo no fim do
// upload, com sucesso ou com falha, mas o arquivo fica em disco se o processo cair no meio do upload
// ou se o `unlink` falhar (o erro só vai para o log dele). A chave da mídia só existe em memória,
// então o que sobra não pode ser decifrado, mas mesmo assim não deve ficar.
//
// Há ainda uma corrida no Baileys: o `encryptedStream` não espera o `createWriteStream` abrir. Se o
// upload falha antes disso (arquivo pequeno e falha imediata), o `unlink` dele dá ENOENT ("failed to
// remove tmp file") e o arquivo é criado logo depois, órfão.
//
// Por isso o `os.tmpdir()` do processo aponta para uma pasta só nossa (`.cache/tmp-midia`), limpa no
// boot (o que sobrou de uma queda), no desligamento e logo depois que o último upload em andamento
// termina (`criarRastreadorUploads`: sem upload em andamento, nada na pasta está em uso). O Baileys
// lê o `os.tmpdir()` a cada arquivo, então basta trocar TMPDIR/TMP/TEMP antes do primeiro envio.
// Nada do nosso pipeline grava aqui.
const fs = require("node:fs");
const path = require("node:path");

const NOME_PASTA_TMP_MIDIA = "tmp-midia";
const PASTA_TMP_MIDIA_PADRAO = path.join(__dirname, "..", "..", ".cache", NOME_PASTA_TMP_MIDIA);
/** Atraso técnico da varredura depois do último upload (cobre a abertura tardia do arquivo). */
const ATRASO_VARREDURA_PADRAO_MS = 1000;
/** Variáveis que o `os.tmpdir()` lê: TMPDIR no Linux, TEMP/TMP no Windows. */
const VARS_TMP = ["TMPDIR", "TMP", "TEMP"];

/** Pasta configurada neste processo (null até `configurarPastaTemporaria`). */
let pastaConfigurada = /** @type {string | null} */ (null);

/**
 * Confere que a pasta é a dedicada (nome `tmp-midia`): nunca limpa o temporário do sistema.
 * @param {string} pasta
 * @returns {string} caminho absoluto
 */
function exigirPastaDedicada(pasta) {
  const absoluta = path.resolve(pasta);
  if (path.basename(absoluta) !== NOME_PASTA_TMP_MIDIA) {
    throw new Error(`Só a pasta temporária dedicada (${NOME_PASTA_TMP_MIDIA}) pode ser limpa.`);
  }
  return absoluta;
}

/**
 * Apaga o conteúdo da pasta dedicada (a pasta fica). Uma entrada que não sai só vai ao log.
 * @param {string} pasta
 * @returns {number} quantas entradas foram apagadas
 */
function limparPastaTemporaria(pasta) {
  const absoluta = exigirPastaDedicada(pasta);
  /** @type {string[]} */
  let nomes;
  try {
    nomes = fs.readdirSync(absoluta);
  } catch {
    return 0; // pasta ainda não existe
  }
  let removidos = 0;
  for (const nome of nomes) {
    try {
      fs.rmSync(path.join(absoluta, nome), { recursive: true, force: true });
      removidos += 1;
    } catch (erro) {
      const codigo = /** @type {NodeJS.ErrnoException} */ (erro)?.code ?? "erro";
      console.error(`[TMP-MIDIA] Falha ao apagar um temporário de mídia: ${codigo}`);
    }
  }
  return removidos;
}

/**
 * Cria a pasta dedicada, apaga o que sobrou de uma execução anterior e aponta o temporário do
 * processo (TMPDIR/TMP/TEMP) para ela. Chamada no boot, antes de qualquer envio.
 * @param {{ pasta?: string, env?: Record<string, string | undefined> }} [opcoes]
 * @returns {{ pasta: string, removidos: number }}
 */
function configurarPastaTemporaria({ pasta = PASTA_TMP_MIDIA_PADRAO, env = process.env } = {}) {
  const absoluta = exigirPastaDedicada(pasta);
  fs.mkdirSync(absoluta, { recursive: true, mode: 0o700 });
  const removidos = limparPastaTemporaria(absoluta);
  for (const nome of VARS_TMP) env[nome] = absoluta;
  pastaConfigurada = absoluta;
  return { pasta: absoluta, removidos };
}

/**
 * Limpa a pasta configurada neste processo (desligamento e varredura). Sem configuração, não faz nada.
 * @returns {number} quantas entradas foram apagadas
 */
function limparPastaConfigurada() {
  return pastaConfigurada ? limparPastaTemporaria(pastaConfigurada) : 0;
}

/**
 * Rastreador dos uploads de mídia em andamento no processo. Quando o último termina (sucesso, falha
 * ou depois do prazo do envio), agenda uma varredura da pasta dedicada; um upload novo antes do
 * atraso cancela a varredura. Sem upload em andamento, nada na pasta está em uso.
 * @param {{ limpar?: () => unknown, atrasoMs?: number }} [opcoes]
 */
function criarRastreadorUploads({ limpar = limparPastaConfigurada, atrasoMs = ATRASO_VARREDURA_PADRAO_MS } = {}) {
  let emAndamento = 0;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let varredura = null;

  function varrer() {
    varredura = null;
    if (emAndamento > 0) return;
    try {
      limpar();
    } catch (erro) {
      console.error("[TMP-MIDIA] Falha na varredura dos temporários de mídia:", erro instanceof Error ? erro.name : "erro");
    }
  }

  /**
   * Marca um upload em andamento.
   * @returns {() => void} conclui o upload (idempotente)
   */
  function iniciar() {
    emAndamento += 1;
    if (varredura) {
      clearTimeout(varredura);
      varredura = null;
    }
    let concluido = false;
    return () => {
      if (concluido) return;
      concluido = true;
      emAndamento -= 1;
      if (emAndamento > 0) return;
      varredura = setTimeout(varrer, atrasoMs);
      varredura.unref?.();
    };
  }

  return { iniciar, emAndamento: () => emAndamento };
}

/** Rastreador do processo (todos os envios de mídia passam por ele). */
const rastreadorUploads = criarRastreadorUploads();

module.exports = {
  configurarPastaTemporaria,
  criarRastreadorUploads,
  rastreadorUploads,
  limparPastaTemporaria,
  limparPastaConfigurada,
  NOME_PASTA_TMP_MIDIA,
  PASTA_TMP_MIDIA_PADRAO,
};
