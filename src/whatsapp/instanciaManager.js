// @ts-check
// Instâncias Baileys em memória, uma por equipe (o comandax tem uma por empresa). Cada equipe tem
// o próprio adapter, socket, sessão e caches; o status de cada uma vai ao back com o hash_empresa
// da própria equipe.
//
// Registro de equipes pareadas (`.cache/equipes-wa.json`, fora de `sessoes-baileys/`): guarda
// `cod_equipe → { hash_empresa }` de quem já conectou. No boot, `reconectarTodas()` reabre só essas
// equipes, e só se o `creds.json` ainda existir. Sem isso, o processo não saberia o hash_empresa
// para reportar o status nem quais equipes reabrir, e não lista a pasta das sessões.
const fs = require("node:fs");
const path = require("node:path");
const BaileysAdapter = require("./BaileysAdapter");
const conexaoInternoClient = require("../services/conexaoInternoClient");

const CAMINHO_REGISTRO = path.join(__dirname, "..", "..", ".cache", "equipes-wa.json");

/** Status em que a instância já está de pé ou esperando a leitura do QR: não reabrir o socket. */
const STATUS_SAUDAVEL = new Set(["CONECTADO", "QR_PENDENTE"]);

/** @typedef {import("./BaileysAdapter").BaileysAdapter} BaileysAdapter */
/** @typedef {import("./BaileysAdapter").OpcoesAdapter} OpcoesAdapter */
/** @typedef {import("../services/conexaoInternoClient").StatusParaReportar} StatusParaReportar */
/** @typedef {Record<string, { hash_empresa: string }>} RegistroEquipes */

class ErroConexaoEquipe extends Error {
  /**
   * @param {string} mensagem
   * @param {"EQUIPE_OUTRA_EMPRESA"} codigo
   */
  constructor(mensagem, codigo) {
    super(mensagem);
    this.name = "ErroConexaoEquipe";
    this.codigo = codigo;
  }
}

/**
 * @param {unknown} erro
 * @returns {string}
 */
function descreverErro(erro) {
  return erro instanceof Error ? erro.message : String(erro);
}

/**
 * @param {{
 *   diretorioSessoes?: string,
 *   caminhoRegistro?: string,
 *   msReconexao?: number,
 *   reportarStatus?: (codEquipe: string, status: StatusParaReportar) => Promise<unknown>,
 *   criarAdapter?: (opcoes: OpcoesAdapter) => BaileysAdapter,
 * }} [opcoes]
 */
function criarInstanciaManager({
  diretorioSessoes = BaileysAdapter.DIRETORIO_SESSOES,
  caminhoRegistro = CAMINHO_REGISTRO,
  msReconexao,
  reportarStatus = conexaoInternoClient.reportarStatus,
  criarAdapter = BaileysAdapter.criarAdapter,
} = {}) {
  /** @type {Map<string, BaileysAdapter>} */
  const instancias = new Map();

  /** @returns {RegistroEquipes} */
  function lerRegistro() {
    try {
      const dados = JSON.parse(fs.readFileSync(caminhoRegistro, "utf8"));
      return dados && typeof dados === "object" && !Array.isArray(dados) ? dados : {};
    } catch (erro) {
      if (/** @type {NodeJS.ErrnoException} */ (erro).code !== "ENOENT") {
        console.error("[INSTANCIAS] Registro de equipes pareadas ilegível, ignorado:", descreverErro(erro));
      }
      return {};
    }
  }

  /** @param {RegistroEquipes} registro */
  function gravarRegistro(registro) {
    try {
      fs.mkdirSync(path.dirname(caminhoRegistro), { recursive: true });
      const temporario = `${caminhoRegistro}.tmp`;
      fs.writeFileSync(temporario, JSON.stringify(registro));
      fs.renameSync(temporario, caminhoRegistro);
    } catch (erro) {
      console.error("[INSTANCIAS] Falha ao gravar o registro de equipes pareadas:", descreverErro(erro));
    }
  }

  /**
   * @param {string} cod
   * @param {string} hashEmpresa
   */
  function registrarPareada(cod, hashEmpresa) {
    const registro = lerRegistro();
    if (registro[cod]?.hash_empresa === hashEmpresa) return;
    registro[cod] = { hash_empresa: hashEmpresa };
    gravarRegistro(registro);
  }

  /** @param {string} cod */
  function removerPareada(cod) {
    const registro = lerRegistro();
    if (!(cod in registro)) return;
    delete registro[cod];
    gravarRegistro(registro);
  }

  /**
   * Abre (ou devolve) a instância da equipe. Uma instância saudável é devolvida sem reabrir o
   * socket; uma em ERRO/DESCONECTADO reaproveita o mesmo adapter (o `iniciar()` é reentrante).
   * @param {string | number} codEquipe
   * @param {string} hashEmpresa tenant dono da equipe (vem do back no POST /conectar)
   * @returns {Promise<BaileysAdapter>}
   */
  async function conectar(codEquipe, hashEmpresa) {
    const cod = BaileysAdapter.normalizarCodEquipe(codEquipe);
    if (typeof hashEmpresa !== "string" || hashEmpresa.trim() === "") throw new TypeError("hash_empresa obrigatório.");

    const existente = instancias.get(cod);
    if (existente) {
      if (existente.hashEmpresa !== hashEmpresa) {
        throw new ErroConexaoEquipe("A equipe já está conectada por outra empresa.", "EQUIPE_OUTRA_EMPRESA");
      }
      if (!STATUS_SAUDAVEL.has(existente.obterStatusConexao().status_conexao)) await existente.iniciar();
      return existente;
    }

    const adapter = criarAdapter({
      codEquipe: cod,
      hashEmpresa,
      diretorioSessoes,
      msReconexao,
      onStatusChange: (estado) => {
        if (estado.status_conexao === "CONECTADO") registrarPareada(cod, hashEmpresa);
        Promise.resolve()
          .then(() => reportarStatus(cod, { hash_empresa: hashEmpresa, ...estado }))
          .catch((erro) => console.error(`[INSTANCIAS] Falha ao reportar o status da equipe ${cod}:`, descreverErro(erro)));
      },
      onSessaoRemovida: () => removerPareada(cod),
    });

    instancias.set(cod, adapter);
    try {
      await adapter.iniciar();
    } catch (erro) {
      // Sem isso, um adapter que falhou ao abrir ficaria no Map para sempre (zumbi).
      instancias.delete(cod);
      await adapter.pararSocket().catch(() => {});
      throw erro;
    }
    return adapter;
  }

  /**
   * @param {string | number} codEquipe
   * @returns {BaileysAdapter | null}
   */
  function obter(codEquipe) {
    try {
      return instancias.get(BaileysAdapter.normalizarCodEquipe(codEquipe)) || null;
    } catch {
      return null;
    }
  }

  /**
   * Boot: reabre as equipes pareadas que ainda têm sessão em disco (sem gerar QR à toa). Cada
   * equipe tem o próprio try/catch: uma sessão com problema não impede as demais.
   * @returns {Promise<string[]>} códigos das equipes reconectadas
   */
  async function reconectarTodas() {
    const registro = lerRegistro();
    /** @type {string[]} */
    const reconectadas = [];
    for (const [cod, dados] of Object.entries(registro)) {
      try {
        if (typeof dados?.hash_empresa !== "string" || !dados.hash_empresa) continue;
        if (!BaileysAdapter.existeSessaoEmDisco(cod, diretorioSessoes)) {
          removerPareada(cod);
          continue;
        }
        await conectar(cod, dados.hash_empresa);
        reconectadas.push(cod);
      } catch (erro) {
        console.error(`[INSTANCIAS] Falha ao reconectar a equipe ${cod} no boot:`, descreverErro(erro));
      }
    }
    return reconectadas;
  }

  /**
   * Equipes do registro de pareadas (para o heartbeat), só as entradas válidas.
   * @returns {{ cod_equipe: string, hash_empresa: string }[]}
   */
  function listarRegistradas() {
    return Object.entries(lerRegistro())
      .filter(([cod, dados]) => {
        try {
          BaileysAdapter.normalizarCodEquipe(cod);
        } catch {
          return false;
        }
        return typeof dados?.hash_empresa === "string" && dados.hash_empresa !== "";
      })
      .map(([cod_equipe, dados]) => ({ cod_equipe, hash_empresa: dados.hash_empresa }));
  }

  /**
   * A equipe tem sessão pareada em disco? (só confere o `creds.json`, sem ler)
   * @param {string | number} codEquipe
   * @returns {boolean}
   */
  function temSessaoSalva(codEquipe) {
    try {
      return BaileysAdapter.existeSessaoEmDisco(codEquipe, diretorioSessoes);
    } catch {
      return false;
    }
  }

  /**
   * Desligamento gracioso: encerra todos os sockets (a sessão fica em disco) e esvazia o Map.
   * @returns {Promise<void>}
   */
  async function encerrarTodas() {
    const lista = [...instancias.entries()];
    instancias.clear();
    await Promise.all(
      lista.map(([cod, instancia]) =>
        instancia.pararSocket().catch((erro) => console.error(`[INSTANCIAS] Falha ao encerrar a equipe ${cod}:`, descreverErro(erro)))
      )
    );
  }

  return { conectar, obter, reconectarTodas, encerrarTodas, listarRegistradas, temSessaoSalva };
}

/** Instância do processo (o PM2 roda `instances: 1`). Os testes criam a sua com `criarInstanciaManager`. */
const padrao = criarInstanciaManager();

module.exports = { ...padrao, criarInstanciaManager, ErroConexaoEquipe, STATUS_SAUDAVEL };
