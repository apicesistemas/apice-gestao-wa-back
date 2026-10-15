// @ts-check
// Recuperação das mensagens entregues pelo Baileys na reconexão (Task 14.3).
//
// Como o Baileys 6.7.24 entrega o que chegou enquanto a equipe estava fora do ar: na reconexão, o
// WhatsApp descarrega a fila offline e cada mensagem vem pelo `messages.upsert` com `type: "append"`
// (nó com o atributo `offline`, messages-recv.js). O BaileysAdapter manda esses lotes pelo MESMO
// pipeline do `notify` (normalizar → eco/aparelho → LID → mídia → registrar → transcrição); este
// módulo só decide o que entra:
//
// 1. Deduplicação local por (cod_equipe, mensagem_wa_id), em memória com TTL e teto. O back já é
//    idempotente por esse par; a dedup local evita refazer o download da mídia e a transcrição
//    quando a mesma mensagem é entregue de novo (notify antes da queda + append na reconexão, ou
//    repetida no mesmo lote). Só é marcada DEPOIS que o back registrou: se o registro falhou, a
//    reentrega tenta de novo (nenhuma mensagem se perde pela dedup).
//
// 2. Janela de tempo do `append`: o corte é a última atividade conhecida da instância (menos uma
//    folga técnica para relógio e para o espaçamento das gravações). Sem atividade conhecida
//    (primeiro pareamento, arquivo perdido) vale `RECUPERACAO_JANELA_MS` desde agora. O corte é fixado
//    na abertura da sessão (`iniciarSessao`), antes de a sessão nova registrar atividade, senão a
//    própria fila offline seria descartada. O `notify` (tempo real) nunca é cortado.
//
// 3. Histórico (`messaging-history.set`): NÃO é usado. Com `syncFullHistory: false` e
//    `shouldSyncHistoryMessage: () => false`, o Baileys nem baixa o histórico (o pareamento não
//    inunda o back com conversas antigas); o que chegou durante a queda vem pela fila offline acima.
//
// A última atividade é gravada por equipe em `.cache/atividade-wa.json` (fora de `sessoes-baileys/`):
// só `cod_equipe → instante em segundos`, nenhum dado de mensagem. A gravação é espaçada
// (INTERVALO_GRAVACAO_ATIVIDADE_S) e forçada na queda e no desligamento.
const fs = require("node:fs");
const path = require("node:path");

/** Prazo e teto do cache de mensagens já processadas (técnicos, não são regra de negócio). */
const TTL_PROCESSADAS_MS = 6 * 60 * 60 * 1000;
const MAX_PROCESSADAS = 5000;
/** Folga do corte: diferença de relógio com o servidor do WhatsApp + espaçamento das gravações. */
const FOLGA_RECUPERACAO_S = 10 * 60;
/** Intervalo mínimo entre gravações da atividade de uma equipe em arquivo (a memória é sempre atual). */
const INTERVALO_GRAVACAO_ATIVIDADE_S = 60;
/** Padrão de RECUPERACAO_JANELA_MS: 72 h cobrem um fim de semana com o processo fora do ar. */
const JANELA_RECUPERACAO_PADRAO_MS = 72 * 60 * 60 * 1000;

const CAMINHO_ATIVIDADE = path.join(__dirname, "..", "..", ".cache", "atividade-wa.json");

/**
 * Janela do `append` quando a instância não tem atividade conhecida (`RECUPERACAO_JANELA_MS`).
 * @param {Record<string, string | undefined>} [env]
 * @returns {number}
 */
function obterJanelaRecuperacaoMs(env = process.env) {
  const valor = Number(env.RECUPERACAO_JANELA_MS);
  return Number.isSafeInteger(valor) && valor > 0 ? valor : JANELA_RECUPERACAO_PADRAO_MS;
}

/**
 * Última atividade conhecida de cada equipe (segundos), em memória e, com `caminho`, em arquivo.
 * @param {{ caminho?: string | null }} [opcoes] `null` = só memória (padrão do adapter isolado)
 */
function criarArmazemAtividade({ caminho = null } = {}) {
  /** @type {Map<string, number> | null} */
  let atividades = null;
  /** @type {Map<string, number>} último valor gravado em arquivo, por equipe */
  const gravadas = new Map();

  /** @returns {Map<string, number>} */
  function carregar() {
    if (atividades) return atividades;
    atividades = new Map();
    if (!caminho) return atividades;
    try {
      const dados = JSON.parse(fs.readFileSync(caminho, "utf8"));
      if (dados && typeof dados === "object" && !Array.isArray(dados)) {
        for (const [cod, valor] of Object.entries(dados)) {
          if (Number.isSafeInteger(valor) && valor > 0) {
            atividades.set(cod, valor);
            gravadas.set(cod, valor);
          }
        }
      }
    } catch (erro) {
      if (/** @type {NodeJS.ErrnoException} */ (erro).code !== "ENOENT") {
        console.error("[RECUPERACAO] Arquivo de atividade das equipes ilegível, ignorado.");
      }
    }
    return atividades;
  }

  function gravar() {
    if (!caminho) return;
    const mapa = carregar();
    try {
      fs.mkdirSync(path.dirname(caminho), { recursive: true });
      const temporario = `${caminho}.tmp`;
      fs.writeFileSync(temporario, JSON.stringify(Object.fromEntries(mapa)));
      fs.renameSync(temporario, caminho);
      for (const [cod, valor] of mapa) gravadas.set(cod, valor);
    } catch (erro) {
      console.error("[RECUPERACAO] Falha ao gravar a atividade das equipes:", /** @type {NodeJS.ErrnoException} */ (erro)?.code ?? "erro");
    }
  }

  /**
   * @param {string} cod
   * @returns {number | null}
   */
  function ler(cod) {
    return carregar().get(cod) ?? null;
  }

  /**
   * Registra a atividade (nunca regride). Grava em arquivo se passou o intervalo ou se `forcar`.
   * @param {string} cod
   * @param {number} segundos
   * @param {{ forcar?: boolean }} [opcoes]
   */
  function registrar(cod, segundos, { forcar = false } = {}) {
    if (!Number.isSafeInteger(segundos) || segundos <= 0) return;
    const mapa = carregar();
    const atual = mapa.get(cod) ?? 0;
    if (segundos > atual) mapa.set(cod, segundos);
    const gravada = gravadas.get(cod) ?? 0;
    const valor = mapa.get(cod) ?? 0;
    if (valor === gravada) return;
    if (forcar || valor - gravada >= INTERVALO_GRAVACAO_ATIVIDADE_S) gravar();
  }

  /** @param {string} cod */
  function remover(cod) {
    const mapa = carregar();
    if (!mapa.has(cod)) return;
    mapa.delete(cod);
    gravadas.delete(cod);
    gravar();
  }

  return { ler, registrar, remover };
}

/** @typedef {ReturnType<typeof criarArmazemAtividade>} ArmazemAtividade */

/**
 * Recuperação de UMA equipe (um por adapter, sobrevive às reconexões do socket).
 * @param {{
 *   codEquipe: string,
 *   armazem?: ArmazemAtividade,
 *   janelaMs?: number,
 *   ttlMs?: number,
 *   maxProcessadas?: number,
 *   agora?: () => number,
 * }} opcoes
 */
function criarRecuperacao({
  codEquipe,
  armazem = criarArmazemAtividade({ caminho: null }),
  janelaMs = obterJanelaRecuperacaoMs(),
  ttlMs = TTL_PROCESSADAS_MS,
  maxProcessadas = MAX_PROCESSADAS,
  agora = Date.now,
}) {
  const cod = String(codEquipe);
  /** mensagem_wa_id → instante em que foi registrada; ordem de inserção = ordem de tempo. */
  /** @type {Map<string, number>} */
  const processadas = new Map();
  /** @type {number | null} corte (segundos) da sessão atual, fixado em `iniciarSessao` */
  let corteSessao = null;

  const agoraS = () => Math.floor(agora() / 1000);

  function expirar() {
    const limite = agora() - ttlMs;
    for (const [id, em] of processadas) {
      if (em >= limite) break;
      processadas.delete(id);
    }
  }

  /** @returns {number} corte em segundos a partir do que se sabe agora */
  function calcularCorte() {
    const ultima = armazem.ler(cod);
    if (ultima !== null) return ultima - FOLGA_RECUPERACAO_S;
    return agoraS() - Math.floor(janelaMs / 1000);
  }

  /**
   * A mensagem já foi registrada por esta equipe (dentro do TTL)?
   * @param {string} mensagemWaId
   */
  function jaProcessada(mensagemWaId) {
    expirar();
    return processadas.has(mensagemWaId);
  }

  /**
   * Marca como registrada (chamar só depois de o back aceitar o registro).
   * @param {string} mensagemWaId
   */
  function marcarProcessada(mensagemWaId) {
    if (typeof mensagemWaId !== "string" || mensagemWaId === "") return;
    processadas.delete(mensagemWaId);
    processadas.set(mensagemWaId, agora());
    expirar();
    while (processadas.size > maxProcessadas) {
      const maisAntiga = processadas.keys().next().value;
      if (maisAntiga === undefined) break;
      processadas.delete(maisAntiga);
    }
  }

  /**
   * Abertura de uma sessão (connection open): fixa o corte pela atividade ANTERIOR e só então
   * registra a atividade da sessão nova.
   */
  function iniciarSessao() {
    corteSessao = calcularCorte();
    armazem.registrar(cod, agoraS(), { forcar: true });
  }

  /**
   * A mensagem entra pela janela? `notify` sempre; `append` só a partir do corte da sessão.
   * @param {number | null | undefined} timestampWa segundos (messageTimestamp)
   * @param {unknown} tipoLote `notify` | `append`
   */
  function dentroDaJanela(timestampWa, tipoLote) {
    if (tipoLote !== "append") return true;
    if (typeof timestampWa !== "number" || !Number.isFinite(timestampWa) || timestampWa <= 0) return true;
    return timestampWa >= (corteSessao ?? calcularCorte());
  }

  /**
   * A instância está ativa agora (mensagem registrada, queda, desligamento).
   * @param {{ forcar?: boolean }} [opcoes]
   */
  function registrarAtividade({ forcar = false } = {}) {
    armazem.registrar(cod, agoraS(), { forcar });
  }

  /** Logout: esquece as processadas e a atividade (o próximo pareamento começa do zero). */
  function limpar() {
    processadas.clear();
    corteSessao = null;
    armazem.remover(cod);
  }

  return { jaProcessada, marcarProcessada, iniciarSessao, dentroDaJanela, registrarAtividade, limpar };
}

module.exports = {
  criarRecuperacao,
  criarArmazemAtividade,
  obterJanelaRecuperacaoMs,
  CAMINHO_ATIVIDADE,
  TTL_PROCESSADAS_MS,
  MAX_PROCESSADAS,
  FOLGA_RECUPERACAO_S,
  INTERVALO_GRAVACAO_ATIVIDADE_S,
  JANELA_RECUPERACAO_PADRAO_MS,
};
