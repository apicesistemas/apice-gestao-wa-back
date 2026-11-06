# Graph Report - apice-gestao-wa-back  (2026-11-06)

## Corpus Check
- 57 files · ~71,282 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 693 nodes · 1430 edges · 34 communities (32 shown, 2 thin omitted)
- Extraction: 87% EXTRACTED · 13% INFERRED · 0% AMBIGUOUS · INFERRED: 181 edges (avg confidence: 0.51)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `a163aed4`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- envio.js
- chamarRotaInterna
- index.js
- IaController.js
- instanciaManager.js
- trilhaVideo.js
- sugestaoTicketService.js
- BaileysAdapter.js
- EnvioController.js
- grupoGestao.js
- GrupoController.js
- diagnosticoPresenca.js
- criarAdapter
- criarLoteRecibos
- filtroEntrada.js
- criarRecuperacao
- normalizarJid
- ContatoController.js
- criarCacheNomeGrupo
- index.js
- run-tests.js
- FotoPerfilController.js
- criarConsolidadorChamadas
- HealthController.js
- envio.js
- ConexaoController.js
- criarRegistroAparelho
- criarCacheEnviadas
- obterSocketDaEquipe
- exclusao.js
- instanciaHealth.js
- reacao.js
- resolverLid.js
- edicao.js

## God Nodes (most connected - your core abstractions)
1. `normalizarJid()` - 28 edges
2. `telefoneDe()` - 28 edges
3. `lidDe()` - 23 edges
4. `chamarRotaInterna()` - 18 edges
5. `recusar()` - 15 edges
6. `criarIaController()` - 15 edges
7. `normalizarCodEquipe()` - 15 edges
8. `mensagemWaIdValido()` - 15 edges
9. `criarAdapter()` - 14 edges
10. `extrairConteudo()` - 14 edges

## Surprising Connections (you probably didn't know these)
- `criarPortaoIa()` --indirect_call--> `executar()`  [INFERRED]
  src/ia/portaoIa.js → scripts/run-tests.js
- `acharAddRequest()` --indirect_call--> `filho()`  [INFERRED]
  src/whatsapp/grupoGestao.js → src/audio/trilhaVideo.js
- `criarIaController()` --indirect_call--> `contexto()`  [INFERRED]
  src/http/IaController.js → src/whatsapp/filtroEntrada.js
- `criarAdapter()` --indirect_call--> `iniciar()`  [INFERRED]
  src/whatsapp/BaileysAdapter.js → src/index.js
- `criarRastreadorUploads()` --indirect_call--> `iniciar()`  [INFERRED]
  src/whatsapp/tmpMidia.js → src/index.js

## Import Cycles
- None detected.

## Communities (34 total, 2 thin omitted)

### Community 0 - "envio.js"
Cohesion: 0.10
Nodes (30): ALLOWLIST_EDICAO, ALLOWLIST_ENVIO, ALLOWLIST_EXCLUSAO, ALLOWLIST_REACAO, CAMPOS_COMUNS, CAMPOS_DO_TIPO, codEquipeValido(), { criarEdicao } (+22 more)

### Community 1 - "chamarRotaInterna"
Cohesion: 0.07
Nodes (40): alertarChamada(), { chamarRotaInterna }, registrarChamada(), valeNovaTentativa(), { chamarRotaInterna }, reportarStatus(), chamarRotaInterna(), chamarRotaInternaMultipart() (+32 more)

### Community 2 - "index.js"
Cohesion: 0.14
Nodes (20): registrarControllers(), { ativarLogEmArquivo, limparLogsAntigos }, criarApp(), criarEncerrador(), { criarInstanciaHealth }, express, heartbeat, hostDeEscuta() (+12 more)

### Community 3 - "IaController.js"
Cohesion: 0.07
Nodes (63): ALLOWLIST_AREA, ALLOWLIST_ASSISTENTE, ALLOWLIST_AVALIACAO, ALLOWLIST_CARGO, ALLOWLIST_CLASSIFICACAO, ALLOWLIST_CRITERIO, ALLOWLIST_DADOS, ALLOWLIST_FEEDBACK (+55 more)

### Community 4 - "instanciaManager.js"
Cohesion: 0.13
Nodes (12): BaileysAdapter, CAMINHO_REGISTRO, conexaoInternoClient, { criarArmazemAtividade }, criarInstanciaManager(), ErroConexaoEquipe, fs, padrao (+4 more)

### Community 5 - "trilhaVideo.js"
Cohesion: 0.12
Nodes (28): { extrairTrilhaAudio, ErroTrilhaAudio, MIMETYPE_TRILHA }, filaPadrao, transcricaoInternoClient, transcricaoService, ACEITOS_DIRETO, CONTEINERES_ISO, ehTimeout(), { extrairTrilhaAudio, ErroTrilhaAudio, MIMETYPE_TRILHA } (+20 more)

### Community 6 - "sugestaoTicketService.js"
Cohesion: 0.06
Nodes (59): bloco(), blocosBase(), COMO_LER_NUMEROS, { conversarTexto, cortarNaPalavra }, gerarFeedback(), MARCADORES_PREVIA, montarPedidoChat(), montarPedidoFeedback() (+51 more)

### Community 7 - "BaileysAdapter.js"
Cohesion: 0.06
Nodes (34): chamadaInternoClient, { criarCacheEnviadas }, { criarCacheNomeGrupo, ErroConsultaGrupo }, { criarConsolidadorChamadas }, { criarLoteRecibos }, { criarPresenca }, { criarRecibos, extrairDeAtualizacoes, extrairDeRecibos, ehPorDestinatario }, { criarRecuperacao } (+26 more)

### Community 8 - "EnvioController.js"
Cohesion: 0.07
Nodes (41): RFC-7845, baixarImagem(), { comPrazo, statusDoErro }, { detectarTipoPorConteudo }, ErroFoto, foiRedirecionamento(), lerComTeto(), MENSAGENS_ERRO_FOTO (+33 more)

### Community 9 - "grupoGestao.js"
Cohesion: 0.29
Nodes (9): configurarPastaTemporaria(), exigirPastaDedicada(), fs, limparPastaConfigurada(), limparPastaTemporaria(), PASTA_TMP_MIDIA_PADRAO, path, rastreadorUploads (+1 more)

### Community 10 - "GrupoController.js"
Cohesion: 0.12
Nodes (23): ALLOWLIST_ADICAO, ALLOWLIST_CONTATO, ALLOWLIST_CRIACAO, criarGrupoController(), { ehProprio }, { ErroConsultaGrupo }, { ErroEnvio, obterSocketDaEquipe }, { ErroGrupo } (+15 more)

### Community 11 - "diagnosticoPresenca.js"
Cohesion: 0.17
Nodes (25): CAMPOS_IGNORADOS, { desembrulhar }, diagnosticoLigado(), dominioDe(), ehEquipe(), gravar(), registrarFormaEventoCall(), registrarFormaMensagem() (+17 more)

### Community 12 - "criarAdapter"
Cohesion: 0.67
Nodes (3): nomeDoErro(), obterVersaoWaWeb(), resumoFalha()

### Community 14 - "filtroEntrada.js"
Cohesion: 0.15
Nodes (31): CHAVES_RUIDO, chavesDescartadas(), comBotoes(), contexto(), copiarKey(), ehLong(), ENVELOPES, extrairConteudo() (+23 more)

### Community 15 - "criarRecuperacao"
Cohesion: 0.33
Nodes (4): CAMINHO_ATIVIDADE, criarRecuperacao(), fs, path

### Community 16 - "normalizarJid"
Cohesion: 0.08
Nodes (50): invalido(), mesmaConversa(), validarChatJid(), validarKey(), validarMencoes(), chatRegistravel(), identidadeDe(), identidadePropria() (+42 more)

### Community 17 - "ContatoController.js"
Cohesion: 0.16
Nodes (16): ALLOWLIST_CONSULTA, ContatoController, criarContatoController(), { ErroConsultaGrupo }, { ErroEnvio, obterSocketDaEquipe }, { ErroGrupo }, ErroRequisicao, exigirTokenServico (+8 more)

### Community 18 - "criarCacheNomeGrupo"
Cohesion: 0.67
Nodes (3): apagarSessaoEmDisco(), diretorioSessao(), existeSessaoEmDisco()

### Community 19 - "index.js"
Cohesion: 0.22
Nodes (8): ConexaoController, ContatoController, CONTROLLERS, EnvioController, FotoPerfilController, GrupoController, HealthController, IaController

### Community 20 - "run-tests.js"
Cohesion: 0.32
Nodes (7): executar(), LIMITES_COBERTURA, listarArquivosDeTeste(), montarArgumentos(), path, { readdirSync }, { spawnSync }

### Community 21 - "FotoPerfilController.js"
Cohesion: 0.14
Nodes (13): ALLOWLIST_FOTO, { ErroConsultaGrupo }, { ErroEnvio, obterSocketDaEquipe }, { ErroFoto }, { ErroGrupo }, ErroRequisicao, exigirTokenServico, FotoPerfilController (+5 more)

### Community 23 - "HealthController.js"
Cohesion: 0.20
Nodes (7): fs, HealthController, instanciaManager, path, { SEGUNDOS_RETRY_AFTER }, { version: VERSAO }, padrao

### Community 24 - "envio.js"
Cohesion: 0.14
Nodes (18): CHAVES_MIDIA, { duracaoOggOpusSegundos, normalizarMimetype, MIME_DOCX, MIME_XLSX, MIME_DOC, MIME_XLS, MIME_PKCS12 }, enviarPeloSocket(), EXTENSAO_DOCUMENTO, EXTENSOES_EXTRAS, guardarParaReenvio(), montarCitacao(), montarConteudo() (+10 more)

### Community 25 - "ConexaoController.js"
Cohesion: 0.22
Nodes (9): codEquipeValido(), ConexaoController, criarConexaoController(), exigirTokenServico, instanciaManager, { normalizarCodEquipe }, crypto, exigirTokenServico() (+1 more)

### Community 26 - "criarRegistroAparelho"
Cohesion: 0.24
Nodes (12): ativarLogEmArquivo(), DIRETORIO_LOGS, formatarDataHora(), fs, gravarNoArquivo(), mascararTelefone(), mascararTelefonesNoTexto(), nomeArquivoDoDia() (+4 more)

### Community 27 - "criarCacheEnviadas"
Cohesion: 0.25
Nodes (6): criarAdapter(), criarCacheEnviadas(), { normalizarJid }, criarCacheNomeGrupo(), criarRecibos(), criarRegistroAparelho()

### Community 28 - "obterSocketDaEquipe"
Cohesion: 0.22
Nodes (7): criarPresenca(), diagnostico, ESTADO_DA_PRESENCA, estadoDaPresenca(), NodeCache, { normalizarJid }, presencaInternoClient

### Community 29 - "exclusao.js"
Cohesion: 0.33
Nodes (4): ErroEnvio, criarExclusao(), padrao, { validarChatJid, validarKey, obterSocketDaEquipe, enviarPeloSocket, ErroEnvio }

### Community 30 - "instanciaHealth.js"
Cohesion: 0.40
Nodes (3): conexaoInternoClient, criarInstanciaHealth(), instanciaManagerPadrao

### Community 31 - "reacao.js"
Cohesion: 0.40
Nodes (3): criarReacao(), padrao, { validarChatJid, validarKey, obterSocketDaEquipe, enviarPeloSocket, ErroEnvio }

### Community 32 - "resolverLid.js"
Cohesion: 0.40
Nodes (3): criarResolvedorLid(), { lidDe, telefoneDe }, telefoneDeValor()

### Community 33 - "edicao.js"
Cohesion: 0.50
Nodes (3): criarEdicao(), padrao, { validarChatJid, validarKey, validarMencoes, montarConteudo, obterSocketDaEquipe, enviarPeloSocket, ErroEnvio }

## Knowledge Gaps
- **253 isolated node(s):** `{ readdirSync }`, `{ spawnSync }`, `path`, `LIMITES_COBERTURA`, `{ extrairTrilhaAudio, ErroTrilhaAudio, MIMETYPE_TRILHA }` (+248 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `padrao` connect `HealthController.js` to `envio.js`, `index.js`, `IaController.js`, `GrupoController.js`, `ContatoController.js`, `FotoPerfilController.js`, `ConexaoController.js`?**
  _High betweenness centrality (0.081) - this node is a cross-community bridge._
- **Why does `criarIaController()` connect `IaController.js` to `sugestaoTicketService.js`, `filtroEntrada.js`?**
  _High betweenness centrality (0.047) - this node is a cross-community bridge._
- **Why does `contexto()` connect `filtroEntrada.js` to `envio.js`, `normalizarJid`, `IaController.js`?**
  _High betweenness centrality (0.046) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `normalizarJid()` (e.g. with `filtroEntrada.js` and `contexto()`) actually correct?**
  _`normalizarJid()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `{ readdirSync }`, `{ spawnSync }`, `path` to the rest of the system?**
  _253 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `envio.js` be split into smaller, more focused modules?**
  _Cohesion score 0.0967741935483871 - nodes in this community are weakly interconnected._
- **Should `chamarRotaInterna` be split into smaller, more focused modules?**
  _Cohesion score 0.07183673469387755 - nodes in this community are weakly interconnected._