// @ts-check
// Adapter Baileys de UMA equipe: um socket, uma sessão em disco e caches próprios. Base do
// comandax_crm_wa_back (iniciar reentrante, pararSocket, reconexão com trava) com a guarda de
// socket atual do apice-financeiro-wa-wa-back (evento de socket antigo é ignorado).
//
// O Baileys fica fixo em 6.7.24 no package.json (nunca `^`: um range `^6.7.x` resolve para a
// 6.17.16, versão fora de sequência marcada como vulnerável no npm).
//
// Riscos que este arquivo evita (todos já vistos em produção no comandax/financeiro):
// - dois sockets vivos na mesma pasta de sessão ("Bad MAC", sessão Signal corrompida): `iniciar()`
//   é reentrante, fecha o socket anterior antes de abrir outro e cancela a reconexão pendente;
// - a mesma queda emitida duas vezes agendando duas reconexões: um único timer por adapter;
// - QR antigo que não some depois de conectar: o QR é limpo no `open` e no `close`;
// - `creds.update` tardio recriando a sessão apagada no logout: os listeners saem antes do `rm`.
//
// Entrada (Task 3.2): `messages.upsert` → normalizarMensagem (filtroEntrada) → descarta o eco dos
// envios do CRM (registroAparelho) → completa LID ↔ telefone (resolverLid) → registrarMensagem
// (`POST /interno/mensagem-recebida`). As mensagens passam por uma fila serial por equipe: a ordem
// de chegada é a ordem de registro, e uma falha no back só loga e segue para a próxima.
//
// Mídia (Task 4.2), logo no recebimento (a URL expira): obterMidiaValidada (download em stream com
// reuploadRequest, teto e prazo, validação por magic bytes, tudo em memória) → registrarMensagem
// com `midia_pendente` → só se a mídia foi aceita e a mensagem registrada, enviarMidia
// (`POST /interno/midia`, multipart). Falha no download ou na validação não perde a mensagem: ela
// é registrada com `midia_pendente: true` e o motivo.
//
// Transcrição (Task 5.2): um AUDIO ou VIDEO registrado com a mídia aceita vai para a fila de
// transcrição (filaTranscricao: concorrência 1 para o processo todo, uma nova tentativa, resultado
// em `POST /interno/transcricao`). A fila de entrada NÃO espera a transcrição, e nenhuma falha
// dela desfaz ou impede o registro da mensagem.
//
// A pasta `sessoes-baileys/` é credencial da sessão pareada: este código só cria (via Baileys),
// confere a existência do `creds.json` e apaga no logout. Nunca lista nem loga o conteúdo.
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const NodeCache = require("node-cache");
const pino = require("pino");
const QRCode = require("qrcode");
const { normalizarMensagem } = require("./filtroEntrada");
const { criarRegistroAparelho } = require("./registroAparelho");
const { criarResolvedorLid } = require("./resolverLid");
const midiaEntrada = require("./midiaEntrada");
const mensagemInternoClient = require("../services/mensagemInternoClient");
const midiaInternoClient = require("../services/midiaInternoClient");
const filaTranscricao = require("../audio/filaTranscricao");

/** Diretório base das sessões: `./sessoes-baileys/<cod_equipe>` na raiz do projeto. */
const DIRETORIO_SESSOES = path.join(__dirname, "..", "..", "sessoes-baileys");
/** Espera antes de reabrir o socket depois de uma queda que não foi logout. */
const MS_RECONEXAO = 5000;
/** A versão do WhatsApp Web é a mesma para todas as equipes: cache no módulo, não por adapter. */
const MS_CACHE_VERSAO = 6 * 60 * 60 * 1000;
/** `cod_equipe` é PK numérica: só dígitos, o que também impede caminho fora do diretório base. */
const PADRAO_COD_EQUIPE = /^[1-9]\d{0,9}$/;
/** Tipos de mensagem cuja mídia é transcrita (o vídeo, pela trilha de áudio). */
const TIPOS_TRANSCRITOS = new Set(["AUDIO", "VIDEO"]);

const loggerBaileys = pino({ level: "silent" });

/** Eventos que este adapter escuta no socket (todos saem no `fecharSocket`). */
const EVENTOS_SOCKET = /** @type {const} */ ([
  "creds.update",
  "connection.update",
  "messages.upsert",
  "chats.phoneNumberShare",
  "contacts.upsert",
  "contacts.update",
]);

/** @typedef {"DESCONECTADO" | "QR_PENDENTE" | "CONECTADO" | "ERRO"} StatusConexao */
/** @typedef {{ status_conexao: StatusConexao, ultimo_erro_conexao: string | null }} EstadoConexao */
/** @typedef {typeof import("@whiskeysockets/baileys")} ModuloBaileys */
/** @typedef {ReturnType<ModuloBaileys["makeWASocket"]>} SocketBaileys */

/**
 * Carrega o Baileys só quando uma conexão é aberta: importar este módulo (boot, testes de HTTP)
 * não paga os segundos de carga do pacote. Os testes trocam o pacote via `require.cache`.
 * @returns {ModuloBaileys}
 */
function carregarBaileys() {
  return require("@whiskeysockets/baileys");
}

/** @type {{ versao: [number, number, number], em: number } | null} */
let cacheVersaoWaWeb = null;

/**
 * Versão atual do WhatsApp Web, com cache; se a busca falhar, o Baileys usa a versão embutida.
 * @param {ModuloBaileys} baileys
 * @returns {Promise<[number, number, number] | undefined>}
 */
async function obterVersaoWaWeb(baileys) {
  if (cacheVersaoWaWeb && Date.now() - cacheVersaoWaWeb.em < MS_CACHE_VERSAO) return cacheVersaoWaWeb.versao;
  try {
    const { version } = await baileys.fetchLatestWaWebVersion({});
    cacheVersaoWaWeb = { versao: version, em: Date.now() };
    return version;
  } catch (erro) {
    console.log("[BAILEYS] Falha ao buscar a versão do WhatsApp Web, usando a do pacote:", nomeDoErro(erro));
    return undefined;
  }
}

/**
 * Só o nome/código do erro: a mensagem de erro do Baileys pode trazer JID ou telefone.
 * @param {unknown} erro
 * @returns {string}
 */
function nomeDoErro(erro) {
  if (erro && typeof erro === "object") {
    const { code, name } = /** @type {{ code?: unknown, name?: unknown }} */ (erro);
    if (typeof code === "string") return code;
    if (typeof name === "string") return name;
  }
  return "erro desconhecido";
}

/**
 * Resumo de uma falha de registro para o log: nome/código, tipo e status HTTP, sem a mensagem do
 * erro (que pode trazer conteúdo) nem telefone.
 * @param {unknown} erro
 * @returns {string}
 */
function resumoFalha(erro) {
  const { tipo, status } = /** @type {{ tipo?: unknown, status?: unknown }} */ (erro && typeof erro === "object" ? erro : {});
  const partes = [nomeDoErro(erro)];
  if (typeof tipo === "string") partes.push(tipo);
  if (typeof status === "number") partes.push(`HTTP ${status}`);
  return partes.join(" ");
}

/**
 * Valida e normaliza o `cod_equipe` (número ou texto) para a chave usada no Map e na pasta.
 * @param {string | number} codEquipe
 * @returns {string}
 * @throws {TypeError} quando não é um inteiro positivo
 */
function normalizarCodEquipe(codEquipe) {
  const texto = String(codEquipe ?? "");
  if (!PADRAO_COD_EQUIPE.test(texto)) throw new TypeError("cod_equipe inválido.");
  return texto;
}

/**
 * @param {string | number} codEquipe
 * @param {string} [diretorioSessoes]
 * @returns {string}
 */
function diretorioSessao(codEquipe, diretorioSessoes = DIRETORIO_SESSOES) {
  return path.join(diretorioSessoes, normalizarCodEquipe(codEquipe));
}

/**
 * A equipe já pareou alguma vez? Só confere se o `creds.json` existe, sem ler o conteúdo.
 * @param {string | number} codEquipe
 * @param {string} [diretorioSessoes]
 * @returns {boolean}
 */
function existeSessaoEmDisco(codEquipe, diretorioSessoes = DIRETORIO_SESSOES) {
  return fs.existsSync(path.join(diretorioSessao(codEquipe, diretorioSessoes), "creds.json"));
}

/** @typedef {import("./filtroEntrada").MensagemRecebida} MensagemRecebida */
/** @typedef {import("../services/mensagemInternoClient").ContextoInstancia} ContextoInstancia */
/** @typedef {import("../services/mensagemInternoClient").EstadoMidia} EstadoMidia */
/** @typedef {import("../services/midiaInternoClient").MetadadosEnvioMidia} MetadadosEnvioMidia */
/** @typedef {import("./midiaEntrada").LimitesMidia} LimitesMidia */
/** @typedef {import("../audio/filaTranscricao").TarefaTranscricao} TarefaTranscricao */

/**
 * @typedef {{
 *   codEquipe: string | number,
 *   hashEmpresa: string,
 *   diretorioSessoes?: string,
 *   msReconexao?: number,
 *   onStatusChange?: (estado: EstadoConexao) => void,
 *   onSessaoRemovida?: () => void,
 *   registrarMensagem?: (mensagem: MensagemRecebida, contexto: ContextoInstancia, estadoMidia: EstadoMidia) => Promise<unknown>,
 *   enviarMidia?: (mensagem_wa_id: string, buffer: Buffer, metadados: MetadadosEnvioMidia) => Promise<unknown>,
 *   obterLimitesMidia?: () => LimitesMidia,
 *   enfileirarTranscricao?: (tarefa: TarefaTranscricao) => Promise<unknown>,
 * }} OpcoesAdapter
 */

/**
 * @typedef {{
 *   codEquipe: string,
 *   hashEmpresa: string,
 *   iniciar: () => Promise<EstadoConexao>,
 *   pararSocket: () => Promise<void>,
 *   obterStatusConexao: () => EstadoConexao,
 *   obterQr: () => string | null,
 *   obterQrPng: () => Promise<Buffer | null>,
 *   marcarEnviadaPeloCrm: (mensagemWaId: string) => void,
 * }} BaileysAdapter
 */

/**
 * Cria o adapter de uma equipe. Nada é aberto até `iniciar()`.
 * @param {OpcoesAdapter} opcoes
 * @returns {BaileysAdapter}
 */
function criarAdapter({
  codEquipe,
  hashEmpresa,
  diretorioSessoes = DIRETORIO_SESSOES,
  msReconexao = MS_RECONEXAO,
  onStatusChange,
  onSessaoRemovida,
  registrarMensagem = mensagemInternoClient.registrarMensagem,
  enviarMidia = midiaInternoClient.enviarMidia,
  obterLimitesMidia = midiaEntrada.obterLimitesMidia,
  enfileirarTranscricao = filaTranscricao.enfileirarTranscricao,
}) {
  const cod = normalizarCodEquipe(codEquipe);
  const pastaSessao = diretorioSessao(cod, diretorioSessoes);

  /** @type {SocketBaileys | null} */
  let socket = null;
  /** @type {Promise<EstadoConexao> | null} */
  let iniciando = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let timerReconexao = null;
  /** @type {EstadoConexao} */
  let estado = { status_conexao: "DESCONECTADO", ultimo_erro_conexao: null };
  /** @type {string | null} */
  let qrAtual = null;

  // Caches da equipe, criados uma vez por adapter (não a cada reconexão: zerariam justo na queda,
  // quando o WhatsApp mais pede reenvio) e nunca compartilhados entre equipes.
  const msgRetryCounterCache = new NodeCache({ stdTTL: 60 * 60, checkperiod: 600, useClones: false });
  const userDevicesCache = new NodeCache({ stdTTL: 300, useClones: false });
  // Entrada: eco dos envios do CRM e pares LID ↔ telefone, por equipe e só em memória.
  const registroAparelho = criarRegistroAparelho();
  const resolvedorLid = criarResolvedorLid();
  /** Fila serial da entrada: cada lote espera o anterior terminar (a ordem nunca se perde). */
  /** @type {Promise<void>} */
  let filaEntrada = Promise.resolve();

  /** @param {EstadoConexao} novo */
  function atualizarStatus(novo) {
    estado = { ...novo };
    try {
      onStatusChange?.({ ...estado });
    } catch (erro) {
      console.error(`[BAILEYS] Falha no tratador de status da equipe ${cod}:`, nomeDoErro(erro));
    }
  }

  function cancelarReconexao() {
    if (timerReconexao) clearTimeout(timerReconexao);
    timerReconexao = null;
  }

  /**
   * Fecha um socket sem disparar reconexão: tira os listeners deste adapter antes do `end()`
   * (senão o `close` do próprio `end()` agendaria uma reconexão fantasma).
   * @param {SocketBaileys | null} alvo
   */
  function fecharSocket(alvo) {
    if (!alvo) return;
    for (const evento of EVENTOS_SOCKET) {
      try {
        alvo.ev.removeAllListeners(evento);
      } catch (erro) {
        console.error(`[BAILEYS] Falha ao remover listener do socket da equipe ${cod}:`, nomeDoErro(erro));
      }
    }
    try {
      alvo.end(undefined);
    } catch (erro) {
      console.error(`[BAILEYS] Falha ao encerrar o socket da equipe ${cod}:`, nomeDoErro(erro));
    }
  }

  function agendarReconexao() {
    if (timerReconexao) return; // a mesma queda emitida duas vezes agenda uma reconexão só
    timerReconexao = setTimeout(() => {
      timerReconexao = null;
      iniciar().catch((erro) => {
        console.error(`[BAILEYS] Falha ao reconectar a equipe ${cod}:`, nomeDoErro(erro));
        atualizarStatus({ status_conexao: "ERRO", ultimo_erro_conexao: "Falha ao reconectar." });
        agendarReconexao();
      });
    }, msReconexao);
    timerReconexao.unref?.();
  }

  /**
   * @param {SocketBaileys} s socket que emitiu o evento
   * @param {Partial<import("@whiskeysockets/baileys").ConnectionState>} update
   */
  async function tratarConexao(s, update) {
    if (s !== socket) return; // evento atrasado de um socket que já foi substituído ou fechado
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      qrAtual = qr;
      atualizarStatus({ status_conexao: "QR_PENDENTE", ultimo_erro_conexao: null });
    }

    if (connection === "open") {
      qrAtual = null;
      atualizarStatus({ status_conexao: "CONECTADO", ultimo_erro_conexao: null });
    }

    if (connection === "close") {
      const { DisconnectReason } = carregarBaileys();
      const erro = /** @type {{ output?: { statusCode?: number } } | undefined} */ (lastDisconnect?.error);
      const codigo = erro?.output?.statusCode;
      const aguardavaQr = estado.status_conexao === "QR_PENDENTE";
      socket = null;
      qrAtual = null;
      // O socket caiu: tira os listeners (uma segunda emissão da mesma queda não faz nada, e um
      // `creds.update` tardio não recria a sessão apagada no logout).
      fecharSocket(s);

      if (codigo === DisconnectReason.loggedOut) {
        // Credencial revogada pelo aparelho: apaga a sessão para a próxima conexão gerar QR novo.
        msgRetryCounterCache.flushAll();
        userDevicesCache.flushAll();
        registroAparelho.limpar();
        resolvedorLid.limpar();
        try {
          await fsp.rm(pastaSessao, { recursive: true, force: true });
        } catch (erroRm) {
          console.error(`[BAILEYS] Falha ao apagar a sessão da equipe ${cod}:`, nomeDoErro(erroRm));
        }
        try {
          onSessaoRemovida?.();
        } catch (erroCb) {
          console.error(`[BAILEYS] Falha no tratador de sessão removida da equipe ${cod}:`, nomeDoErro(erroCb));
        }
        atualizarStatus({ status_conexao: "DESCONECTADO", ultimo_erro_conexao: "Sessão encerrada pelo aparelho." });
        return;
      }

      if (aguardavaQr && codigo === DisconnectReason.timedOut) {
        // Ninguém leu o QR: não reabre sozinho (cada reabertura gera QR novo à toa).
        atualizarStatus({ status_conexao: "DESCONECTADO", ultimo_erro_conexao: "QR Code expirou sem leitura." });
        return;
      }

      atualizarStatus({
        status_conexao: "ERRO",
        ultimo_erro_conexao: `Conexão encerrada (código ${codigo ?? "desconhecido"}).`,
      });
      agendarReconexao();
    }
  }

  /**
   * Normaliza, filtra e registra uma mensagem recebida. Uma falha no back só loga.
   * @param {SocketBaileys} s socket que recebeu (identidade da equipe e `onWhatsApp`)
   * @param {any} waMessage
   */
  async function processarMensagem(s, waMessage) {
    resolvedorLid.aprenderDaMensagem(waMessage);
    const normalizada = normalizarMensagem(waMessage, { eu: { jid: s.user?.id, lid: s.user?.lid } });
    if (!normalizada || !registroAparelho.deveRegistrar(normalizada)) return;

    let remetente = resolvedorLid.completarIdentidade(normalizada.remetente);
    let contato = normalizada.contato && resolvedorLid.completarIdentidade(normalizada.contato);
    // Contato privado só com telefone: o LID vem do `onWhatsApp` (uma consulta por telefone, com cache e prazo).
    if (contato?.telefone && !contato.lid && typeof s.onWhatsApp === "function") {
      const lid = await resolvedorLid.consultarLidDoTelefone(contato.telefone, (jid) => s.onWhatsApp(jid));
      if (lid) {
        contato = { ...contato, lid };
        if (normalizada.origem === "CLIENTE") remetente = { ...remetente, lid };
      }
    }

    const id = normalizada.mensagem_wa_id;
    // Download no recebimento (a URL da mídia expira). Nunca rejeita: falha vira pendência.
    /** @type {EstadoMidia} */
    let estadoMidia = mensagemInternoClient.SEM_PENDENCIA;
    /** @type {import("./midiaEntrada").ResultadoMidia | null} */
    let midia = null;
    if (normalizada.midia) {
      try {
        midia = await midiaEntrada.obterMidiaValidada(s, waMessage, normalizada.midia, obterLimitesMidia());
      } catch {
        midia = { ok: false, motivo: "DOWNLOAD_FALHOU" }; // defesa: nada aqui pode perder a mensagem
      }
      if (!midia.ok) {
        estadoMidia = { midia_pendente: true, midia_motivo_pendencia: midia.motivo };
        console.log(`[ENTRADA] Mídia da mensagem ${id} da equipe ${cod} pendente: ${midia.motivo}`);
      }
    }

    try {
      await registrarMensagem({ ...normalizada, remetente, contato }, { hash_empresa: hashEmpresa, cod_equipe: cod }, estadoMidia);
    } catch (erro) {
      // Sem a mensagem no back não há a que associar a mídia: o binário é descartado.
      console.error(`[ENTRADA] Falha ao registrar a mensagem ${id} da equipe ${cod}:`, resumoFalha(erro));
      return;
    }

    if (!midia?.ok) return;
    try {
      await enviarMidia(id, midia.buffer, {
        hash_empresa: hashEmpresa,
        cod_equipe: cod,
        mimetype: midia.mimetype,
        tamanho_bytes: midia.tamanho_bytes,
        nome_arquivo: midia.nome_arquivo,
        duracao_segundos: midia.duracao_segundos,
      });
    } catch (erro) {
      console.error(`[ENTRADA] Falha ao enviar a mídia da mensagem ${id} da equipe ${cod}:`, resumoFalha(erro));
    }

    // Sem `await`: a transcrição roda na fila própria e não segura a entrada da equipe.
    if (TIPOS_TRANSCRITOS.has(normalizada.tipo)) {
      try {
        enfileirarTranscricao({
          mensagem_wa_id: id,
          buffer: midia.buffer,
          mimetype: midia.mimetype,
          duracao_segundos: midia.duracao_segundos,
          contexto: { hash_empresa: hashEmpresa, cod_equipe: cod },
        }).catch((erro) => console.error(`[ENTRADA] Falha na transcrição da mensagem ${id} da equipe ${cod}:`, nomeDoErro(erro)));
      } catch (erro) {
        console.error(`[ENTRADA] Falha ao enfileirar a transcrição da mensagem ${id} da equipe ${cod}:`, nomeDoErro(erro));
      }
    }
  }

  /**
   * Põe um lote do `messages.upsert` na fila serial. `notify` (tempo real) e `append` (recuperadas
   * na reconexão e eco dos envios) são processados. A fila nunca fica rejeitada.
   * @param {SocketBaileys} s
   * @param {unknown} messages
   * @param {unknown} type
   * @returns {Promise<void>}
   */
  function enfileirarEntrada(s, messages, type) {
    if ((type !== "notify" && type !== "append") || !Array.isArray(messages) || messages.length === 0) return filaEntrada;
    const lote = [...messages];
    filaEntrada = filaEntrada.then(async () => {
      for (const waMessage of lote) {
        try {
          await processarMensagem(s, waMessage);
        } catch (erro) {
          console.error(`[ENTRADA] Falha ao processar uma mensagem recebida da equipe ${cod}:`, nomeDoErro(erro));
        }
      }
    });
    return filaEntrada;
  }

  /** @returns {Promise<EstadoConexao>} */
  async function abrirSocket() {
    // Nunca dois sockets na mesma pasta de sessão: fecha o anterior e cancela a reconexão pendente.
    cancelarReconexao();
    const anterior = socket;
    socket = null;
    qrAtual = null;
    fecharSocket(anterior);

    const baileys = carregarBaileys();
    const { state, saveCreds } = await baileys.useMultiFileAuthState(pastaSessao);
    const version = await obterVersaoWaWeb(baileys);

    const s = baileys.makeWASocket({
      auth: { creds: state.creds, keys: baileys.makeCacheableSignalKeyStore(state.keys, loggerBaileys) },
      version,
      browser: ["Ápice Gestão", "Chrome", os.release()],
      logger: loggerBaileys,
      printQRInTerminal: false,
      connectTimeoutMs: 30_000,
      keepAliveIntervalMs: 30_000,
      syncFullHistory: false,
      markOnlineOnConnect: false,
      msgRetryCounterCache,
      userDevicesCache,
      retryRequestDelayMs: 350,
      maxMsgRetryCount: 4,
      shouldIgnoreJid: (jid) => Boolean(baileys.isJidBroadcast(jid) || baileys.isJidNewsletter(jid)),
    });
    socket = s;

    s.ev.on("creds.update", () => {
      // Uma gravação que falha (ex.: pasta apagada) não pode virar rejeição sem tratamento.
      saveCreds().catch((erro) => console.error(`[BAILEYS] Falha ao gravar credenciais da equipe ${cod}:`, nomeDoErro(erro)));
    });
    s.ev.on("connection.update", (update) =>
      tratarConexao(s, update).catch((erro) =>
        console.error(`[BAILEYS] Falha ao tratar connection.update da equipe ${cod}:`, nomeDoErro(erro))
      )
    );
    // Mensagem já decifrada pelo Baileys não é reenviada: entra na fila mesmo durante a troca de socket.
    s.ev.on("messages.upsert", (evento) => enfileirarEntrada(s, evento?.messages, evento?.type));
    s.ev.on("chats.phoneNumberShare", (par) => resolvedorLid.aprenderContatos([par]));
    s.ev.on("contacts.upsert", (contatos) => resolvedorLid.aprenderContatos(contatos));
    s.ev.on("contacts.update", (contatos) => resolvedorLid.aprenderContatos(contatos));

    return { ...estado };
  }

  /**
   * Abre (ou reabre) o socket da equipe. Reentrante: chamadas simultâneas compartilham a mesma
   * abertura, então um clique em "Conectar" durante uma reconexão nunca abre dois sockets.
   * @returns {Promise<EstadoConexao>}
   */
  function iniciar() {
    if (!iniciando) {
      iniciando = abrirSocket().finally(() => {
        iniciando = null;
      });
    }
    return iniciando;
  }

  /**
   * Encerra o socket sem apagar a sessão (desligamento gracioso): cancela a reconexão, espera uma
   * abertura em andamento terminar (senão sobraria um socket aberto) e reporta DESCONECTADO.
   * @returns {Promise<void>}
   */
  async function pararSocket() {
    cancelarReconexao();
    if (iniciando) await iniciando.catch(() => {});
    cancelarReconexao();
    const alvo = socket;
    socket = null;
    qrAtual = null;
    fecharSocket(alvo);
    atualizarStatus({ status_conexao: "DESCONECTADO", ultimo_erro_conexao: null });
  }

  return {
    codEquipe: cod,
    hashEmpresa,
    iniciar,
    pararSocket,
    obterStatusConexao: () => ({ ...estado }),
    obterQr: () => qrAtual,
    async obterQrPng() {
      const qr = qrAtual;
      if (!qr) return null;
      return QRCode.toBuffer(qr, { type: "png" });
    },
    // Para o pipeline de saída: marcar o id ANTES do `sendMessage`, senão o eco vira "aparelho".
    marcarEnviadaPeloCrm: (mensagemWaId) => registroAparelho.marcarEnviada(mensagemWaId),
  };
}

module.exports = {
  criarAdapter,
  existeSessaoEmDisco,
  diretorioSessao,
  normalizarCodEquipe,
  DIRETORIO_SESSOES,
  MS_RECONEXAO,
};
