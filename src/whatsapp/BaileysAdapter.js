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
// Recibos, presença e nome do grupo (Task 6.2): `messages.update` / `message-receipt.update` →
// recibos (ENVIADA/ENTREGUE/LIDA, maior status, `POST /interno/mensagem-status`) na MESMA fila
// serial da entrada (o recibo de uma mensagem nunca passa na frente do registro dela);
// `presence.update` → presenca ("digitando" do cliente, só na mudança, `POST /interno/presenca`),
// com `presenceSubscribe` na primeira mensagem de cada chat; mensagem de grupo leva o `nome_chat`
// (subject do `groupMetadata`, com cache e prazo curto; falha → sem `nome_chat`).
//
// Saída (Task 7.2): o pipeline de saída (envio.js/reacao.js) usa `socketConectado()` e chama
// `marcarEnviadaPeloCrm(id)` ANTES do `sendMessage`: o id entra no cache de eco (o eco não vira
// "aparelho") e os recibos dele ficam retidos por alguns segundos (o back só grava a mensagem enviada
// depois da resposta do envio).
//
// Recuperação e desligamento (Task 14.3): os lotes `append` (fila offline entregue na reconexão)
// passam pelo MESMO pipeline do `notify`, com a deduplicação local e a janela de tempo do
// recuperacao.js (o histórico do pareamento não é baixado: `shouldSyncHistoryMessage: () => false`).
// O `getMessage` atende o pedido de reenvio com o cache em memória das mensagens enviadas
// (cacheEnviadas.js; sem a mensagem, `undefined`). As gravações de credenciais (`saveCreds`) são em
// série e rastreadas: o `pararSocket` do desligamento fecha o socket (nenhum `creds.update` novo),
// espera a gravação em andamento terminar e nunca faz logout (a sessão reconecta sem QR).
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
const { normalizarMensagem, normalizarJid, lidDe, telefoneDe } = require("./filtroEntrada");
const { criarRegistroAparelho } = require("./registroAparelho");
const { criarResolvedorLid } = require("./resolverLid");
const midiaEntrada = require("./midiaEntrada");
const mensagemInternoClient = require("../services/mensagemInternoClient");
const midiaInternoClient = require("../services/midiaInternoClient");
const filaTranscricao = require("../audio/filaTranscricao");
const { criarRecibos, extrairDeAtualizacoes, extrairDeRecibos } = require("./recibos");
const { criarPresenca } = require("./presenca");
const { criarCacheNomeGrupo, ErroConsultaGrupo } = require("./nomeGrupo");
const { detalharMencoes } = require("./mencoesEntrada");
const mensagemStatusInternoClient = require("../services/mensagemStatusInternoClient");
const presencaInternoClient = require("../services/presencaInternoClient");
const { criarRecuperacao } = require("./recuperacao");
const { criarCacheEnviadas } = require("./cacheEnviadas");

/** Diretório base das sessões: `./sessoes-baileys/<cod_equipe>` na raiz do projeto. */
const DIRETORIO_SESSOES = path.join(__dirname, "..", "..", "sessoes-baileys");
/** Espera antes de reabrir o socket depois de uma queda que não foi logout. */
const MS_RECONEXAO = 5000;
/**
 * Prazos técnicos do desligamento voluntário. Somados ao prazo do reporte (instanciaManager), o pior
 * caso (7 s) cabe folgado no teto de 10 s do encerramento gracioso, que espera a requisição em
 * andamento: passado o prazo do `sock.logout()` a sessão local é apagada mesmo assim (NAO_CONFIRMADA).
 */
const MS_PRAZO_LOGOUT = 3000;
/** Quanto o desconectar espera a gravação de credenciais em andamento antes de apagar a pasta. */
const MS_PRAZO_CREDENCIAIS = 1500;
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
  "messages.update",
  "message-receipt.update",
  "presence.update",
  "groups.update",
  "group-participants.update",
]);

/** @typedef {"DESCONECTADO" | "QR_PENDENTE" | "CONECTADO" | "ERRO"} StatusConexao */
/** @typedef {"CONFIRMADA" | "NAO_CONFIRMADA" | "SEM_PAREAMENTO"} RemocaoAparelho */
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

/**
 * Apaga só a pasta da sessão de uma equipe (sem listar nem ler o conteúdo). Para o desconectar de uma
 * equipe sem instância neste processo. Rejeita se o `rm` falhar.
 * @param {string | number} codEquipe
 * @param {string} [diretorioSessoes]
 * @returns {Promise<void>}
 */
async function apagarSessaoEmDisco(codEquipe, diretorioSessoes = DIRETORIO_SESSOES) {
  await fsp.rm(diretorioSessao(codEquipe, diretorioSessoes), { recursive: true, force: true });
}

/** @typedef {import("./filtroEntrada").MensagemRecebida} MensagemRecebida */
/** @typedef {import("../services/mensagemInternoClient").ContextoInstancia} ContextoInstancia */
/** @typedef {import("../services/mensagemInternoClient").EstadoMidia} EstadoMidia */
/** @typedef {import("../services/midiaInternoClient").MetadadosEnvioMidia} MetadadosEnvioMidia */
/** @typedef {import("./midiaEntrada").LimitesMidia} LimitesMidia */
/** @typedef {import("../audio/filaTranscricao").TarefaTranscricao} TarefaTranscricao */
/** @typedef {import("../services/mensagemInternoClient").MensagemParaRegistro} MensagemParaRegistro */
/** @typedef {import("../services/mensagemStatusInternoClient").StatusMensagem} StatusMensagem */
/** @typedef {import("../services/presencaInternoClient").DadosPresenca} DadosPresenca */

/**
 * @typedef {{
 *   codEquipe: string | number,
 *   hashEmpresa: string,
 *   diretorioSessoes?: string,
 *   msReconexao?: number,
 *   msPrazoLogout?: number,
 *   msPrazoCredenciais?: number,
 *   onStatusChange?: (estado: EstadoConexao) => void,
 *   onSessaoRemovida?: () => void,
 *   registrarMensagem?: (mensagem: MensagemParaRegistro, contexto: ContextoInstancia, estadoMidia: EstadoMidia) => Promise<unknown>,
 *   enviarMidia?: (mensagem_wa_id: string, buffer: Buffer, metadados: MetadadosEnvioMidia) => Promise<unknown>,
 *   obterLimitesMidia?: () => LimitesMidia,
 *   enfileirarTranscricao?: (tarefa: TarefaTranscricao) => Promise<unknown>,
 *   registrarStatusMensagem?: (mensagem_wa_id: string, status: StatusMensagem, contexto: ContextoInstancia) => Promise<unknown>,
 *   registrarPresenca?: (dados: DadosPresenca, contexto: ContextoInstancia) => Promise<unknown>,
 *   armazemAtividade?: import("./recuperacao").ArmazemAtividade,
 *   janelaRecuperacaoMs?: number,
 * }} OpcoesAdapter
 */

/**
 * @typedef {{
 *   codEquipe: string,
 *   hashEmpresa: string,
 *   iniciar: () => Promise<EstadoConexao>,
 *   pararSocket: () => Promise<void>,
 *   desconectar: () => Promise<{ remocao_aparelho: RemocaoAparelho }>,
 *   temSocket: () => boolean,
 *   obterStatusConexao: () => EstadoConexao,
 *   obterQr: () => string | null,
 *   obterQrPng: () => Promise<Buffer | null>,
 *   marcarEnviadaPeloCrm: (mensagemWaId: string) => void,
 *   guardarEnviada: (mensagemWaId: string, message: any, chatJid: string) => void,
 *   socketConectado: () => SocketBaileys | null,
 *   obterParticipantesGrupo: (chatJid: string) => Promise<import("./nomeGrupo").ParticipanteGrupo[]>,
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
  msPrazoLogout = MS_PRAZO_LOGOUT,
  msPrazoCredenciais = MS_PRAZO_CREDENCIAIS,
  onStatusChange,
  onSessaoRemovida,
  registrarMensagem = mensagemInternoClient.registrarMensagem,
  enviarMidia = midiaInternoClient.enviarMidia,
  obterLimitesMidia = midiaEntrada.obterLimitesMidia,
  enfileirarTranscricao = filaTranscricao.enfileirarTranscricao,
  registrarStatusMensagem = mensagemStatusInternoClient.registrarStatusMensagem,
  registrarPresenca = presencaInternoClient.registrarPresenca,
  armazemAtividade,
  janelaRecuperacaoMs,
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
  // Recibos, presença e nome dos grupos: também por equipe e só em memória.
  /** @type {ContextoInstancia} */
  const contexto = { hash_empresa: hashEmpresa, cod_equipe: cod };
  // Recibos retidos de um envio do CRM voltam pela fila serial (nunca em paralelo com outros recibos).
  const recibos = criarRecibos({ contexto, registrarStatusMensagem, liberar: (itens) => enfileirarRecibos(itens) });
  const presenca = criarPresenca({ contexto, registrarPresenca });
  const nomesGrupo = criarCacheNomeGrupo();
  // Recuperação (dedup + janela do `append`) e cache de reenvio: por equipe, só em memória (a
  // atividade vai ao armazém, que no processo grava só o instante em `.cache/`).
  const recuperacao = criarRecuperacao({ codEquipe: cod, armazem: armazemAtividade, janelaMs: janelaRecuperacaoMs });
  const cacheEnviadas = criarCacheEnviadas();
  /** Gravações de credenciais em série; o desligamento espera a última terminar. */
  /** @type {Promise<void>} */
  let filaCredenciais = Promise.resolve();
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

  /** @param {SocketBaileys} alvo */
  function removerListeners(alvo) {
    for (const evento of EVENTOS_SOCKET) {
      try {
        alvo.ev.removeAllListeners(evento);
      } catch (erro) {
        console.error(`[BAILEYS] Falha ao remover listener do socket da equipe ${cod}:`, nomeDoErro(erro));
      }
    }
  }

  /**
   * Limpeza comum da sessão local (logout pelo aparelho e desconexão voluntária): zera os caches da
   * equipe, ESPERA a gravação de credenciais em andamento (senão ela recriaria a pasta) e só então
   * apaga a pasta da sessão. Nunca rejeita.
   * @returns {Promise<void>}
   */
  async function apagarSessaoLocal() {
    msgRetryCounterCache.flushAll();
    userDevicesCache.flushAll();
    registroAparelho.limpar();
    resolvedorLid.limpar();
    recibos.limpar();
    presenca.limpar();
    nomesGrupo.limpar();
    cacheEnviadas.limpar();
    recuperacao.limpar();
    // Um saveCreds pendurado não pode travar a equipe para sempre: passado o prazo, apaga mesmo assim.
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timerCreds;
    await Promise.race([
      filaCredenciais,
      new Promise((resolve) => {
        timerCreds = setTimeout(resolve, msPrazoCredenciais);
      }),
    ]);
    clearTimeout(timerCreds);
    try {
      await fsp.rm(pastaSessao, { recursive: true, force: true });
    } catch (erroRm) {
      console.error(`[BAILEYS] Falha ao apagar a sessão da equipe ${cod}:`, nomeDoErro(erroRm));
    }
  }

  /**
   * Fecha um socket sem disparar reconexão: tira os listeners deste adapter antes do `end()`
   * (senão o `close` do próprio `end()` agendaria uma reconexão fantasma).
   * @param {SocketBaileys | null} alvo
   */
  function fecharSocket(alvo) {
    if (!alvo) return;
    removerListeners(alvo);
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
      recuperacao.iniciarSessao(); // corte do `append` pela atividade anterior, antes da nova
      presenca.limparInscricoes(); // sessão nova no WhatsApp: as inscrições de presença não valem mais
      atualizarStatus({ status_conexao: "CONECTADO", ultimo_erro_conexao: null });
    }

    if (connection === "close") {
      const { DisconnectReason } = carregarBaileys();
      const erro = /** @type {{ output?: { statusCode?: number } } | undefined} */ (lastDisconnect?.error);
      const codigo = erro?.output?.statusCode;
      const aguardavaQr = estado.status_conexao === "QR_PENDENTE";
      if (estado.status_conexao === "CONECTADO") recuperacao.registrarAtividade({ forcar: true }); // instante da queda
      socket = null;
      qrAtual = null;
      // O socket caiu: tira os listeners (uma segunda emissão da mesma queda não faz nada, e um
      // `creds.update` tardio não recria a sessão apagada no logout).
      fecharSocket(s);

      if (codigo === DisconnectReason.loggedOut) {
        // Credencial revogada pelo aparelho: apaga a sessão para a próxima conexão gerar QR novo.
        await apagarSessaoLocal();
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
   * @param {unknown} tipoLote `notify` (tempo real) ou `append` (fila offline da reconexão, eco)
   */
  async function processarMensagem(s, waMessage, tipoLote) {
    resolvedorLid.aprenderDaMensagem(waMessage);
    const normalizada = normalizarMensagem(waMessage, { eu: { jid: s.user?.id, lid: s.user?.lid } });
    if (!normalizada || !registroAparelho.deveRegistrar(normalizada)) return;
    // Já registrada (reentrega na reconexão ou repetida no lote): nada de baixar a mídia de novo.
    if (recuperacao.jaProcessada(normalizada.mensagem_wa_id)) return;
    if (!recuperacao.dentroDaJanela(normalizada.timestamp_wa, tipoLote)) {
      console.log(`[RECUPERACAO] Mensagem ${normalizada.mensagem_wa_id} da equipe ${cod} fora da janela de recuperação, ignorada.`);
      return;
    }
    // Sem `await`: a inscrição de presença e o nome do grupo correm junto com o resto (LID, mídia).
    void presenca.inscrever(s, normalizada.chat_jid);
    const nomeChat = normalizada.tipo_chat === "GRUPO" ? nomesGrupo.obterNome(s, normalizada.chat_jid) : Promise.resolve(null);
    // Menção em grupo: os participantes saem da mesma consulta do nome (cache e consulta únicos). Nunca rejeita.
    const temMencoes = Array.isArray(normalizada.mencoes) && normalizada.mencoes.length > 0;
    /** @type {Promise<import("./nomeGrupo").ParticipanteGrupo[]>} */
    const participantesGrupo =
      temMencoes && normalizada.tipo_chat === "GRUPO"
        ? nomesGrupo.obterParticipantes(s, normalizada.chat_jid).catch(() => [])
        : Promise.resolve([]);

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

    /** @type {MensagemParaRegistro} */
    const paraRegistro = { ...normalizada, remetente, contato };
    const nome_chat = await nomeChat; // nunca rejeita, e o prazo é curto
    if (nome_chat) paraRegistro.nome_chat = nome_chat;
    if (temMencoes) {
      paraRegistro.mencoes_detalhe = detalharMencoes(normalizada.mencoes ?? [], {
        resolvedorLid,
        participantes: await participantesGrupo,
        eu: { jid: s.user?.id, lid: s.user?.lid },
      });
    }

    try {
      await registrarMensagem(paraRegistro, { hash_empresa: hashEmpresa, cod_equipe: cod }, estadoMidia);
    } catch (erro) {
      // Sem a mensagem no back não há a que associar a mídia: o binário é descartado.
      console.error(`[ENTRADA] Falha ao registrar a mensagem ${id} da equipe ${cod}:`, resumoFalha(erro));
      return; // sem marcar: uma reentrega tenta de novo
    }
    recuperacao.marcarProcessada(id);
    recuperacao.registrarAtividade();

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
    // GIF (mp4 sem trilha de áudio) não é transcrito: geraria uma transcrição FALHOU sem necessidade.
    if (TIPOS_TRANSCRITOS.has(normalizada.tipo) && normalizada.midia?.gif !== true) {
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
          await processarMensagem(s, waMessage, type);
        } catch (erro) {
          console.error(`[ENTRADA] Falha ao processar uma mensagem recebida da equipe ${cod}:`, nomeDoErro(erro));
        }
      }
    });
    return filaEntrada;
  }

  /**
   * Põe os status de um recibo na fila serial da entrada, atrás do registro das mensagens já
   * recebidas. Itens sem id ou sem status mapeável não chegam aqui. A fila nunca fica rejeitada.
   * @param {import("./recibos").StatusRecebido[]} itens
   * @returns {Promise<void>}
   */
  function enfileirarRecibos(itens) {
    if (itens.length === 0) return filaEntrada;
    filaEntrada = filaEntrada.then(() =>
      recibos.processar(itens).catch((erro) => console.error(`[RECIBOS] Falha ao processar recibos da equipe ${cod}:`, nomeDoErro(erro)))
    );
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
      // Explícito: o histórico do pareamento nunca é baixado (não inunda o back com conversa antiga).
      shouldSyncHistoryMessage: () => false,
      markOnlineOnConnect: false,
      // Pedido de reenvio ("Aguardando mensagem"): só o que está no cache; sem ele, `undefined`.
      getMessage: (key) => cacheEnviadas.obter(key),
      msgRetryCounterCache,
      userDevicesCache,
      retryRequestDelayMs: 350,
      maxMsgRetryCount: 4,
      shouldIgnoreJid: (jid) => Boolean(baileys.isJidBroadcast(jid) || baileys.isJidNewsletter(jid)),
    });
    socket = s;

    s.ev.on("creds.update", () => {
      // Em série e rastreada (o desligamento espera). Uma gravação que falha (ex.: pasta apagada)
      // não pode virar rejeição sem tratamento nem travar as próximas.
      filaCredenciais = filaCredenciais
        .then(() => saveCreds())
        .catch((erro) => console.error(`[BAILEYS] Falha ao gravar credenciais da equipe ${cod}:`, nomeDoErro(erro)));
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
    s.ev.on("messages.update", (atualizacoes) => enfileirarRecibos(extrairDeAtualizacoes(atualizacoes)));
    s.ev.on("message-receipt.update", (lista) => enfileirarRecibos(extrairDeRecibos(lista, { jid: s.user?.id, lid: s.user?.lid })));
    s.ev.on("presence.update", (evento) => presenca.tratarAtualizacao(evento, { jid: s.user?.id, lid: s.user?.lid }));
    s.ev.on("groups.update", (grupos) => nomesGrupo.aprender(grupos));
    s.ev.on("group-participants.update", (evento) => nomesGrupo.esquecer(evento?.id));

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
   * abertura em andamento terminar (senão sobraria um socket aberto), fecha o socket SEM logout (os
   * listeners saem antes, então nenhum `creds.update` novo começa), grava a última atividade, espera
   * a gravação de credenciais em andamento e, depois, a fila de entrada (o Baileys já confirmou ao
   * WhatsApp as mensagens que entregou: sem registrar no back, elas não voltariam) e reporta
   * DESCONECTADO. O teto do encerramento fica com o index.js.
   * @returns {Promise<void>}
   */
  async function pararSocket() {
    cancelarReconexao();
    if (iniciando) await iniciando.catch(() => {});
    cancelarReconexao();
    const alvo = socket;
    const estavaConectado = estado.status_conexao === "CONECTADO";
    socket = null;
    qrAtual = null;
    fecharSocket(alvo);
    if (estavaConectado) recuperacao.registrarAtividade({ forcar: true });
    await filaCredenciais;
    await filaEntrada; // nunca rejeita
    atualizarStatus({ status_conexao: "DESCONECTADO", ultimo_erro_conexao: null });
  }

  /**
   * Logout voluntário: remove o aparelho no WhatsApp, apaga a sessão local e deixa a
   * equipe DESCONECTADO, sem reconexão. Cancela o timer, espera a abertura em andamento, tira os
   * listeners ANTES do logout (o tratador de "encerrada pelo aparelho" não roda e nenhum `creds.update`
   * novo começa), espera a fila de credenciais e apaga a pasta. O status novo NÃO passa por
   * `onStatusChange`: quem chama reporta ao back e espera o reporte. Nunca rejeita.
   * @returns {Promise<{ remocao_aparelho: RemocaoAparelho }>}
   */
  async function desconectar() {
    cancelarReconexao();
    if (iniciando) await iniciando.catch(() => {});
    cancelarReconexao();
    const alvo = socket;
    const status = estado.status_conexao;
    /** @type {RemocaoAparelho} */
    let remocao = "NAO_CONFIRMADA";
    socket = null;
    qrAtual = null;
    // "Em desconexão": quem lê o estado durante o logout (heartbeat, /ping) já vê DESCONECTADO.
    estado = { status_conexao: "DESCONECTADO", ultimo_erro_conexao: null };
    if (alvo) {
      removerListeners(alvo);
      if (status === "QR_PENDENTE") {
        remocao = "SEM_PAREAMENTO";
      } else if (status === "CONECTADO" && alvo.user?.id) {
        /** @type {ReturnType<typeof setTimeout> | undefined} */
        let timerPrazo;
        const logout = Promise.resolve()
          .then(() => alvo.logout())
          .then(
            () => true,
            (erro) => {
              console.error(`[BAILEYS] Falha no logout da equipe ${cod}:`, nomeDoErro(erro));
              return false;
            }
          );
        const prazo = new Promise((resolve) => {
          timerPrazo = setTimeout(() => resolve(false), msPrazoLogout); // sem unref: sempre limpo logo abaixo
        });
        const confirmado = await Promise.race([logout, prazo]);
        clearTimeout(timerPrazo);
        if (confirmado) remocao = "CONFIRMADA";
        else console.error(`[BAILEYS] Logout da equipe ${cod} não confirmado.`);
      }
      fecharSocket(alvo); // reserva: o end() derruba o que o logout deixou aberto
    }
    await apagarSessaoLocal();
    estado = { status_conexao: "DESCONECTADO", ultimo_erro_conexao: null };
    return { remocao_aparelho: remocao };
  }

  /**
   * Destinos que podem pedir o reenvio de uma mensagem enviada: o chat e, na conversa privada, o
   * outro JID do mesmo contato (LID <-> telefone), quando o par é conhecido.
   * @param {string} chatJid
   * @returns {string[]}
   */
  function destinosDoChat(chatJid) {
    const jid = normalizarJid(chatJid);
    if (!jid) return [];
    const lid = lidDe(jid);
    if (lid) {
      const telefone = resolvedorLid.telefoneDoLid(lid);
      return telefone ? [jid, `${telefone}@s.whatsapp.net`] : [jid];
    }
    const telefone = telefoneDe(jid);
    const lidDoContato = telefone ? resolvedorLid.lidDoTelefone(telefone) : null;
    return lidDoContato ? [jid, lidDoContato] : [jid];
  }

  return {
    codEquipe: cod,
    hashEmpresa,
    iniciar,
    pararSocket,
    desconectar,
    temSocket: () => socket !== null,
    obterStatusConexao: () => ({ ...estado }),
    obterQr: () => qrAtual,
    async obterQrPng() {
      const qr = qrAtual;
      if (!qr) return null;
      return QRCode.toBuffer(qr, { type: "png" });
    },
    // Para o pipeline de saída: marcar o id ANTES do `sendMessage`, senão o eco vira "aparelho" e um
    // recibo que chegue antes de o back gravar a mensagem se perde.
    marcarEnviadaPeloCrm(mensagemWaId) {
      registroAparelho.marcarEnviada(mensagemWaId);
      recibos.adiarRecibos(mensagemWaId);
    },
    // Para o pipeline de saída, depois do `sendMessage`: o `message` enviado atende o `getMessage`.
    guardarEnviada(mensagemWaId, message, chatJid) {
      cacheEnviadas.guardar(mensagemWaId, message, destinosDoChat(chatJid));
    },
    // Só com a equipe CONECTADA: durante QR, queda ou reconexão não há para onde enviar.
    socketConectado: () => (socket && estado.status_conexao === "CONECTADO" ? socket : null),
    // Para `POST /equipe/:cod_equipe/grupo/participantes`: cache e consulta única do nomeGrupo.
    // Rejeita com ErroConsultaGrupo (nunca com JID/telefone na mensagem).
    async obterParticipantesGrupo(chatJid) {
      const conectado = socket && estado.status_conexao === "CONECTADO" ? socket : null;
      if (!conectado) throw new ErroConsultaGrupo("FALHA");
      return nomesGrupo.obterParticipantes(conectado, chatJid);
    },
  };
}

module.exports = {
  criarAdapter,
  existeSessaoEmDisco,
  apagarSessaoEmDisco,
  diretorioSessao,
  normalizarCodEquipe,
  DIRETORIO_SESSOES,
  MS_RECONEXAO,
  MS_PRAZO_LOGOUT,
  MS_PRAZO_CREDENCIAIS,
};
