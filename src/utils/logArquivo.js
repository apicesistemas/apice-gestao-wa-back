// @ts-check
// Espelho em arquivo (LOGS/log_AAAAMMDD.txt) de tudo que passa por console.log/console.error,
// base do comandax_crm_wa_back. Telefone nunca aparece inteiro (LGPD, SPEC §Segurança): toda
// sequência de 10 a 15 dígitos (telefone, JID, LID) é mascarada antes de ir ao console e ao
// arquivo. A retenção de 10 dias é o controle de guarda dessa informação.
const fs = require("node:fs");
const path = require("node:path");
const util = require("node:util");

const DIRETORIO_LOGS = path.join(__dirname, "..", "..", "LOGS");
const RETENCAO_DIAS = 10;
const UM_DIA_MS = 24 * 60 * 60 * 1000;
const PADRAO_ARQUIVO = /^log_(\d{4})(\d{2})(\d{2})\.txt$/;
// 10 a 15 dígitos seguidos, sem dígito colado antes ou depois: telefone com ou sem DDI e LID.
const PADRAO_TELEFONE = /(?<!\d)\d{10,15}(?!\d)/g;

/** @param {number} n */
const pad = (n) => String(n).padStart(2, "0");

/**
 * 5544998131290 → 55449****1290 (mesma regra do apice-financeiro-wa-wa-back).
 * @param {unknown} telefone
 * @returns {string}
 */
function mascararTelefone(telefone) {
  const t = typeof telefone === "string" ? telefone : "";
  if (t.length < 10) return "****";
  return `${t.slice(0, 5)}****${t.slice(-4)}`;
}

/**
 * Mascara todos os telefones/JIDs/LIDs encontrados num texto livre.
 * @param {string} texto
 * @returns {string}
 */
function mascararTelefonesNoTexto(texto) {
  return texto.replace(PADRAO_TELEFONE, (numero) => mascararTelefone(numero));
}

/** @param {Date} data */
function formatarDataHora(data) {
  return (
    `${data.getFullYear()}-${pad(data.getMonth() + 1)}-${pad(data.getDate())} ` +
    `${pad(data.getHours())}:${pad(data.getMinutes())}:${pad(data.getSeconds())}`
  );
}

/**
 * @param {Date} data
 * @returns {string} ex.: `log_20261014.txt`
 */
function nomeArquivoDoDia(data) {
  return `log_${data.getFullYear()}${pad(data.getMonth() + 1)}${pad(data.getDate())}.txt`;
}

/**
 * @param {string} diretorio
 * @param {string} linha já mascarada
 */
function gravarNoArquivo(diretorio, linha) {
  try {
    fs.mkdirSync(diretorio, { recursive: true });
    const agora = new Date();
    fs.appendFileSync(path.join(diretorio, nomeArquivoDoDia(agora)), `[${formatarDataHora(agora)}] ${linha}\n`);
  } catch {
    // falha de log em arquivo nunca derruba a aplicação nem some com o console
  }
}

/**
 * Passa a mascarar e espelhar em arquivo o console.log/console.error vigentes.
 * @param {{ diretorio?: string }} [opcoes]
 * @returns {() => void} desativa, restaurando o console anterior
 */
function ativarLogEmArquivo({ diretorio = DIRETORIO_LOGS } = {}) {
  // Capturados na ativação (não no carregamento do módulo) para valer o console vigente agora.
  const logOriginal = console.log;
  const errorOriginal = console.error;

  /** @param {(...args: any[]) => void} original */
  const embrulhar = (original) =>
    /** @param {any[]} args */
    (...args) => {
      const linha = mascararTelefonesNoTexto(util.format(...args));
      original.call(console, linha);
      gravarNoArquivo(diretorio, linha);
    };

  console.log = embrulhar(logOriginal);
  console.error = embrulhar(errorOriginal);

  return () => {
    console.log = logOriginal;
    console.error = errorOriginal;
  };
}

/**
 * Apaga os arquivos de log com mais de 10 dias (comparação por dia do calendário).
 * @param {{ diretorio?: string, agora?: Date }} [opcoes]
 * @returns {string[]} nomes dos arquivos removidos
 */
function limparLogsAntigos({ diretorio = DIRETORIO_LOGS, agora = new Date() } = {}) {
  /** @type {string[]} */
  const removidos = [];
  if (!fs.existsSync(diretorio)) return removidos;

  const inicioDoDia = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate()).getTime();
  const limite = inicioDoDia - RETENCAO_DIAS * UM_DIA_MS;

  for (const arquivo of fs.readdirSync(diretorio)) {
    const match = arquivo.match(PADRAO_ARQUIVO);
    if (!match) continue;
    const [, ano, mes, dia] = match;
    const dataArquivo = new Date(Number(ano), Number(mes) - 1, Number(dia)).getTime();
    if (dataArquivo < limite) {
      try {
        fs.unlinkSync(path.join(diretorio, arquivo));
        removidos.push(arquivo);
      } catch {
        // arquivo preso/apagado por outro processo: tenta de novo na próxima limpeza
      }
    }
  }
  return removidos;
}

module.exports = {
  ativarLogEmArquivo,
  limparLogsAntigos,
  mascararTelefone,
  mascararTelefonesNoTexto,
  nomeArquivoDoDia,
  RETENCAO_DIAS,
};
