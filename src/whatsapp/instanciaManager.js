// @ts-check
// Instâncias Baileys em memória, uma por equipe (o comandax tem uma por empresa). Cada equipe tem
// o próprio adapter, socket, sessão e caches; o status de cada uma vai ao back com o hash_empresa
// da própria equipe.
//
// Registro de equipes pareadas (`.cache/equipes-wa.json`, fora de `sessoes-baileys/`): guarda
// `cod_equipe → { hash_empresa }` de quem já conectou. No boot, `reconectarTodas()` reabre só essas
// equipes, e só se o `creds.json` ainda existir. Sem isso, o processo não saberia o hash_empresa
// para reportar o status nem quais equipes reabrir, e não lista a pasta das sessões.
//
// Atividade das equipes (`.cache/atividade-wa.json`, ao lado do registro): o último instante em que
// cada instância esteve ativa, para a recuperação das mensagens entregues na reconexão (Task 14.3).
const fs = require("node:fs");
const path = require("node:path");
const BaileysAdapter = require("./BaileysAdapter");
const conexaoInternoClient = require("../services/conexaoInternoClient");
const { criarArmazemAtividade } = require("./recuperacao");

const CAMINHO_REGISTRO = path.join(__dirname, "..", "..", ".cache", "equipes-wa.json");

/** Prazo técnico do reporte aguardado do desconectar (soma com o logout e as credenciais: cabe no teto do encerramento). */
const MS_PRAZO_REPORTE = 2500;

/** Status em que a instância já está de pé ou esperando a leitura do QR: não reabrir o socket. */
const STATUS_SAUDAVEL = new Set(["CONECTADO", "QR_PENDENTE"]);

/** @typedef {import("./BaileysAdapter").BaileysAdapter} BaileysAdapter */
/** @typedef {import("./BaileysAdapter").OpcoesAdapter} OpcoesAdapter */
/** @typedef {import("../services/conexaoInternoClient").StatusParaReportar} StatusParaReportar */
/** @typedef {Record<string, { hash_empresa: string }>} RegistroEquipes */
/** @typedef {{ cod_equipe: number, status: string, desde?: string }} StatusEquipe */

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
 *   caminhoAtividade?: string,
 *   msReconexao?: number,
 *   msPrazoLogout?: number,
 *   msPrazoCredenciais?: number,
 *   msPrazoReporte?: number,
 *   reportarStatus?: (codEquipe: string, status: StatusParaReportar) => Promise<unknown>,
 *   criarAdapter?: (opcoes: OpcoesAdapter) => BaileysAdapter,
 * }} [opcoes]
 */
function criarInstanciaManager({
  diretorioSessoes = BaileysAdapter.DIRETORIO_SESSOES,
  caminhoRegistro = CAMINHO_REGISTRO,
  caminhoAtividade = path.join(path.dirname(caminhoRegistro), "atividade-wa.json"),
  msReconexao,
  msPrazoLogout,
  msPrazoCredenciais,
  msPrazoReporte = MS_PRAZO_REPORTE,
  reportarStatus = conexaoInternoClient.reportarStatus,
  criarAdapter = BaileysAdapter.criarAdapter,
} = {}) {
  /** @type {Map<string, BaileysAdapter>} */
  const instancias = new Map();
  /**
   * Desde quando cada equipe está no status atual (ISO), para o `GET /ping`. Só o status e o
   * instante: nada do número, do tenant nem do erro.
   * @type {Map<string, { status: string, desde: string }>}
   */
  const desdeStatus = new Map();
  /** Última atividade de cada equipe, compartilhada pelos adapters (lida do arquivo só no primeiro uso). */
  const armazemAtividade = criarArmazemAtividade({ caminho: caminhoAtividade });

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
   * Trava por equipe: conectar, desconectar e a reconexão do heartbeat da mesma equipe nunca se
   * intercalam. A fila de cada equipe nunca fica rejeitada.
   * @type {Map<string, Promise<unknown>>}
   */
  const travas = new Map();
  /** @type {Map<string, { hash: string, promessa: Promise<BaileysAdapter>, marcador: Promise<unknown> | undefined }>} */
  const conectarPendente = new Map();

  /**
   * @template T
   * @param {string} cod
   * @param {() => Promise<T>} tarefa
   * @returns {Promise<T>}
   */
  function comTrava(cod, tarefa) {
    const anterior = travas.get(cod) ?? Promise.resolve();
    const atual = anterior.then(tarefa, tarefa);
    const marcador = atual.then(
      () => {},
      () => {}
    );
    travas.set(cod, marcador);
    marcador.then(() => {
      if (travas.get(cod) === marcador) travas.delete(cod);
    });
    return atual;
  }

  /**
   * Abre (ou devolve) a instância da equipe. Uma instância saudável é devolvida sem reabrir o
   * socket; uma em ERRO/DESCONECTADO reaproveita o mesmo adapter (o `iniciar()` é reentrante).
   * @param {string | number} codEquipe
   * @param {string} hashEmpresa tenant dono da equipe (vem do back no POST /conectar)
   * @returns {Promise<BaileysAdapter>}
   */
  function conectar(codEquipe, hashEmpresa) {
    /** @type {string} */
    let cod;
    try {
      cod = BaileysAdapter.normalizarCodEquipe(codEquipe);
    } catch (erro) {
      return Promise.reject(erro);
    }
    if (typeof hashEmpresa !== "string" || hashEmpresa.trim() === "") return Promise.reject(new TypeError("hash_empresa obrigatório."));
    // Cliques simultâneos em "Conectar" (último item da fila é um conectar do mesmo hash, ainda
    // pendente) compartilham a mesma tarefa: um único socket. Depois de um desconectar na fila, não.
    const pendente = conectarPendente.get(cod);
    if (pendente && pendente.hash === hashEmpresa && pendente.marcador === travas.get(cod)) return pendente.promessa;
    const promessa = comTrava(cod, () => conectarSemTrava(cod, hashEmpresa));
    conectarPendente.set(cod, { hash: hashEmpresa, promessa, marcador: travas.get(cod) });
    return promessa;
  }

  /**
   * @param {string} cod
   * @param {string} hashEmpresa
   * @returns {Promise<BaileysAdapter>}
   */
  async function conectarSemTrava(cod, hashEmpresa) {
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
      msPrazoLogout,
      msPrazoCredenciais,
      armazemAtividade,
      onStatusChange: (estado) => {
        if (desdeStatus.get(cod)?.status !== estado.status_conexao) {
          desdeStatus.set(cod, { status: estado.status_conexao, desde: new Date().toISOString() });
        }
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
   * Reconexão do heartbeat: só abre o socket se, DENTRO da trava, a equipe ainda consta no registro
   * de pareadas com o mesmo hash_empresa e o `creds.json` existe. Quem leu o registro antes de um
   * desconectar chega aqui depois e não abre nada.
   * @param {string | number} codEquipe
   * @param {string} hashEmpresa
   * @returns {Promise<BaileysAdapter | null>} a instância, ou null quando não havia o que reconectar
   */
  function reconectarSePareada(codEquipe, hashEmpresa) {
    return reconectarDoRegistro(codEquipe, hashEmpresa, false);
  }

  /**
   * @param {string | number} codEquipe
   * @param {string} hashEmpresa
   * @param {boolean} limparSemSessao tira do registro a equipe que consta mas não tem `creds.json` (boot)
   * @returns {Promise<BaileysAdapter | null>}
   */
  function reconectarDoRegistro(codEquipe, hashEmpresa, limparSemSessao) {
    /** @type {string} */
    let cod;
    try {
      cod = BaileysAdapter.normalizarCodEquipe(codEquipe);
    } catch (erro) {
      return Promise.reject(erro);
    }
    return comTrava(cod, async () => {
      if (lerRegistro()[cod]?.hash_empresa !== hashEmpresa) return null;
      if (!BaileysAdapter.existeSessaoEmDisco(cod, diretorioSessoes)) {
        if (limparSemSessao) removerPareada(cod);
        return null;
      }
      return conectarSemTrava(cod, hashEmpresa);
    });
  }

  /**
   * A equipe tem um conectar/desconectar/reconexão em andamento? O heartbeat pula a equipe ocupada
   * (o estado lido no meio de um desconectar seria reportado depois do DESCONECTADO final).
   * @param {string | number} codEquipe
   * @returns {boolean}
   */
  function equipeOcupada(codEquipe) {
    try {
      return travas.has(BaileysAdapter.normalizarCodEquipe(codEquipe));
    } catch {
      return false;
    }
  }

  /**
   * Logout voluntário da equipe. Confere o tenant (instância ou registro; outro hash ->
   * ErroConexaoEquipe e nada é desconectado), faz o logout no WhatsApp quando há socket pareado,
   * apaga a sessão, tira a equipe do registro de pareadas e reporta DESCONECTADO ao back (aguardado
   * antes de liberar a trava; falha só vai ao log). Sem instância, sem registro e sem `creds.json`
   * nada é tocado (idempotente). A instância fica no Map em DESCONECTADO e pode reconectar com QR novo.
   * Um `creds.json` sem dono conhecido (sem instância e sem registro) é tratado como da equipe pedida:
   * a pasta é apagada e responde NAO_CONFIRMADA (não há como saber a empresa de uma sessão órfã).
   * Pior caso de tempo: prazo do logout + das credenciais + do reporte (cabe no teto do encerramento).
   * @param {string | number} codEquipe
   * @param {string} hashEmpresa
   * @returns {Promise<{ havia_sessao: boolean, remocao_aparelho: import("./BaileysAdapter").RemocaoAparelho }>}
   * @throws {ErroConexaoEquipe} equipe de outra empresa
   */
  function desconectar(codEquipe, hashEmpresa) {
    /** @type {string} */
    let cod;
    try {
      cod = BaileysAdapter.normalizarCodEquipe(codEquipe);
    } catch (erro) {
      return Promise.reject(erro);
    }
    if (typeof hashEmpresa !== "string" || hashEmpresa.trim() === "") return Promise.reject(new TypeError("hash_empresa obrigatório."));
    return comTrava(cod, async () => {
      const instancia = instancias.get(cod);
      const doRegistro = lerRegistro()[cod];
      const hashDono = instancia ? instancia.hashEmpresa : doRegistro?.hash_empresa;
      if (hashDono !== undefined && hashDono !== hashEmpresa) {
        throw new ErroConexaoEquipe("A equipe já está conectada por outra empresa.", "EQUIPE_OUTRA_EMPRESA");
      }
      const comCreds = BaileysAdapter.existeSessaoEmDisco(cod, diretorioSessoes);
      const haviaSessao = Boolean(
        doRegistro || comCreds || (instancia && (instancia.temSocket() || instancia.obterStatusConexao().status_conexao !== "DESCONECTADO"))
      );
      if (!haviaSessao) return { havia_sessao: false, remocao_aparelho: "SEM_PAREAMENTO" };

      /** @type {import("./BaileysAdapter").RemocaoAparelho} */
      let remocao = "NAO_CONFIRMADA";
      if (instancia) {
        ({ remocao_aparelho: remocao } = await instancia.desconectar());
      } else {
        try {
          await BaileysAdapter.apagarSessaoEmDisco(cod, diretorioSessoes);
        } catch (erro) {
          console.error(`[INSTANCIAS] Falha ao apagar a sessão da equipe ${cod}:`, descreverErro(erro));
        }
      }
      removerPareada(cod);
      desdeStatus.set(cod, { status: "DESCONECTADO", desde: new Date().toISOString() });
      // Depois do rm e do removerPareada. Aguardado, mas com prazo: um back lento não segura a trava.
      /** @type {ReturnType<typeof setTimeout> | undefined} */
      let timerReporte;
      try {
        await Promise.race([
          reportarStatus(cod, { hash_empresa: hashEmpresa, status_conexao: "DESCONECTADO", ultimo_erro_conexao: null }),
          new Promise((resolve) => {
            timerReporte = setTimeout(() => {
              console.error(`[INSTANCIAS] Reporte do status da equipe ${cod} não respondeu no prazo.`);
              resolve(undefined);
            }, msPrazoReporte);
          }),
        ]);
      } catch (erro) {
        console.error(`[INSTANCIAS] Falha ao reportar o status da equipe ${cod}:`, descreverErro(erro));
      }
      clearTimeout(timerReporte);
      return { havia_sessao: true, remocao_aparelho: remocao };
    });
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
        // Dentro da trava da equipe: um desconectar em andamento não é seguido de um conectar.
        const instancia = await reconectarDoRegistro(cod, dados.hash_empresa, true);
        if (instancia) reconectadas.push(cod);
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
   * Desligamento gracioso: encerra todos os sockets SEM logout (a sessão fica em disco e o registro
   * de pareadas fica intacto, para o boot seguinte reconectar sem QR), esperando as gravações de
   * credenciais em andamento de cada equipe, e esvazia o Map.
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

  /**
   * Status de cada equipe para o monitoramento (`GET /ping`): as instâncias deste processo e as
   * equipes pareadas sem instância (DESCONECTADO), em ordem de código. Leva só o código, o status e
   * desde quando: nunca JID, telefone, LID, nome do número, QR, erro nem hash_empresa.
   * @returns {StatusEquipe[]}
   */
  function listarStatus() {
    /** @type {Map<string, StatusEquipe>} */
    const porEquipe = new Map();
    for (const [cod, instancia] of instancias) {
      const status = instancia.obterStatusConexao().status_conexao;
      const marca = desdeStatus.get(cod);
      porEquipe.set(cod, { cod_equipe: Number(cod), status, ...(marca?.status === status ? { desde: marca.desde } : {}) });
    }
    for (const { cod_equipe: cod } of listarRegistradas()) {
      if (!porEquipe.has(cod)) porEquipe.set(cod, { cod_equipe: Number(cod), status: "DESCONECTADO" });
    }
    return [...porEquipe.values()].sort((a, b) => a.cod_equipe - b.cod_equipe);
  }

  return { conectar, desconectar, reconectarSePareada, equipeOcupada, obter, reconectarTodas, encerrarTodas, listarRegistradas, temSessaoSalva, listarStatus };
}

/** Instância do processo (o PM2 roda `instances: 1`). Os testes criam a sua com `criarInstanciaManager`. */
const padrao = criarInstanciaManager();

module.exports = { ...padrao, criarInstanciaManager, ErroConexaoEquipe, STATUS_SAUDAVEL, MS_PRAZO_REPORTE };
