// @ts-check
// Heartbeat das conexões WhatsApp por equipe (base: sdr/instanciaHealthService do
// comandax_crm_wa_back). O adapter reporta sozinho cada mudança de status, mas só enquanto a
// instância existe neste processo: se ela sumiu (reinício sem reconexão, falha ao abrir), nada mais
// reporta e o `status_conexao` no back ficaria travado no último valor bom. A cada 60 s, para cada
// equipe do registro de pareadas (`.cache/equipes-wa.json`):
// - instância em memória → reporta o status atual dela (o adapter cuida da própria reconexão);
// - sem instância → reporta DESCONECTADO e só reconecta se houver sessão salva (`creds.json`). Sem
//   sessão não abre socket (abrir geraria QR à toa): a equipe precisa clicar em Conectar.
// Cada equipe tem o próprio try/catch, e uma rodada nunca começa antes de a anterior terminar.
const instanciaManagerPadrao = require("./instanciaManager");
const conexaoInternoClient = require("../services/conexaoInternoClient");

const MS_INTERVALO_HEARTBEAT = 60 * 1000;

const ERRO_RECONECTANDO = "Instância do WhatsApp inativa neste processo; reconectando automaticamente.";
const ERRO_SEM_SESSAO = "Nenhuma sessão do WhatsApp pareada neste servidor. Clique em Conectar e leia o QR Code.";

/** @typedef {import("../services/conexaoInternoClient").StatusParaReportar} StatusParaReportar */
/** @typedef {import("./BaileysAdapter").BaileysAdapter} BaileysAdapter */
/**
 * @typedef {{
 *   listarRegistradas: () => { cod_equipe: string, hash_empresa: string }[],
 *   obter: (codEquipe: string | number) => BaileysAdapter | null,
 *   temSessaoSalva: (codEquipe: string | number) => boolean,
 *   conectar: (codEquipe: string | number, hashEmpresa: string) => Promise<unknown>,
 * }} ManagerHeartbeat
 */

/**
 * @param {unknown} erro
 * @returns {string}
 */
function descreverErro(erro) {
  return erro instanceof Error ? erro.message : String(erro);
}

/**
 * @param {{
 *   manager?: ManagerHeartbeat,
 *   reportarStatus?: (codEquipe: string, status: StatusParaReportar) => Promise<unknown>,
 *   msIntervalo?: number,
 * }} [opcoes]
 */
function criarInstanciaHealth({
  manager = instanciaManagerPadrao,
  reportarStatus = conexaoInternoClient.reportarStatus,
  msIntervalo = MS_INTERVALO_HEARTBEAT,
} = {}) {
  /** @type {ReturnType<typeof setInterval> | null} */
  let timer = null;
  let rodando = false;
  let parado = false;

  /**
   * @param {string} cod
   * @param {string} hashEmpresa
   */
  async function verificarEquipe(cod, hashEmpresa) {
    const instancia = manager.obter(cod);
    if (instancia) {
      await reportarStatus(cod, { hash_empresa: instancia.hashEmpresa, ...instancia.obterStatusConexao() }).catch((erro) =>
        console.error(`[HEARTBEAT] Falha ao reportar o status da equipe ${cod}:`, descreverErro(erro))
      );
      return;
    }

    const temSessao = manager.temSessaoSalva(cod);
    await reportarStatus(cod, {
      hash_empresa: hashEmpresa,
      status_conexao: "DESCONECTADO",
      ultimo_erro_conexao: temSessao ? ERRO_RECONECTANDO : ERRO_SEM_SESSAO,
    }).catch((erro) => console.error(`[HEARTBEAT] Falha ao reportar a equipe ${cod} desconectada:`, descreverErro(erro)));

    if (!temSessao || parado) return;
    await manager
      .conectar(cod, hashEmpresa)
      .catch((erro) => console.error(`[HEARTBEAT] Falha ao reconectar a equipe ${cod}:`, descreverErro(erro)));
  }

  /**
   * Uma rodada do heartbeat. Nunca rejeita.
   * @returns {Promise<void>}
   */
  async function verificarTodas() {
    /** @type {{ cod_equipe: string, hash_empresa: string }[]} */
    let equipes = [];
    try {
      equipes = manager.listarRegistradas();
    } catch (erro) {
      console.error("[HEARTBEAT] Falha ao listar as equipes pareadas:", descreverErro(erro));
    }
    for (const { cod_equipe, hash_empresa } of equipes) {
      if (parado) return;
      try {
        await verificarEquipe(cod_equipe, hash_empresa);
      } catch (erro) {
        console.error(`[HEARTBEAT] Falha ao verificar a equipe ${cod_equipe}:`, descreverErro(erro));
      }
    }
  }

  async function tique() {
    if (rodando) return; // a rodada anterior ainda não terminou (back lento): pula esta
    rodando = true;
    try {
      await verificarTodas();
    } finally {
      rodando = false;
    }
  }

  return {
    verificarTodas,
    /** Agenda o heartbeat (idempotente). A primeira rodada é depois do primeiro intervalo. */
    iniciar() {
      parado = false;
      if (timer) return;
      timer = setInterval(() => void tique(), msIntervalo);
      timer.unref?.();
    },
    /** Cancela o heartbeat (desligamento gracioso): nenhuma reconexão nova começa depois disto. */
    parar() {
      parado = true;
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}

module.exports = { criarInstanciaHealth, MS_INTERVALO_HEARTBEAT };
