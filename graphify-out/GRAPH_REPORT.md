# Graph Report - apice-gestao-wa-back  (2026-10-24)

## Corpus Check
- 55 files · ~63,724 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 6 file(s) not represented in the graph (top: (none) 5, .example 1)

## Summary
- 761 nodes · 1713 edges · 31 communities (30 shown, 1 thin omitted)
- Extraction: 87% EXTRACTED · 13% INFERRED · 0% AMBIGUOUS · INFERRED: 223 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `bd2fc0e8`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- envio.js
- filtroEntrada.js
- src/index.js
- IaController.js
- instanciaManager.js
- trilhaVideo.js
- sugestaoTicketService.js
- BaileysAdapter.js
- tipoMidia.js
- EnvioController.js
- GrupoController.js
- diagnosticoPresenca.js
- criarAdapter
- criarLoteRecibos
- midiaEntrada.js
- criarRecuperacao
- tmpMidia.js
- ContatoController.js
- criarCacheNomeGrupo
- http/index.js
- grupoGestao.js
- FotoPerfilController.js
- criarConsolidadorChamadas
- HealthController.js
- run-tests.js
- ConexaoController.js
- criarRegistroAparelho
- criarCacheEnviadas
- normalizarCodEquipe
- diretorioSessao
- validarMidia

## God Nodes (most connected - your core abstractions)
1. `criarAdapter()` - 38 edges
2. `normalizarJid()` - 37 edges
3. `telefoneDe()` - 32 edges
4. `lidDe()` - 29 edges
5. `criarInstanciaManager()` - 21 edges
6. `chamarRotaInterna()` - 18 edges
7. `nomeDoErro()` - 18 edges
8. `obterSocketDaEquipe()` - 18 edges
9. `mensagemWaIdValido()` - 17 edges
10. `criarLoteRecibos()` - 17 edges

## Surprising Connections (you probably didn't know these)
- `carregar()` --indirect_call--> `caminho()`  [INFERRED]
  src/whatsapp/recuperacao.js → src/audio/trilhaVideo.js
- `gravar()` --indirect_call--> `caminho()`  [INFERRED]
  src/whatsapp/recuperacao.js → src/audio/trilhaVideo.js
- `publicarChamada()` --indirect_call--> `contexto()`  [INFERRED]
  src/whatsapp/BaileysAdapter.js → src/whatsapp/filtroEntrada.js
- `publicarAlertaChamada()` --indirect_call--> `contexto()`  [INFERRED]
  src/whatsapp/BaileysAdapter.js → src/whatsapp/filtroEntrada.js
- `guardar()` --indirect_call--> `normalizarJid()`  [INFERRED]
  src/whatsapp/cacheEnviadas.js → src/whatsapp/filtroEntrada.js

## Import Cycles
- 2-file cycle: `src/ia/classificacaoTicketService.js -> src/ia/sugestaoTicketService.js -> src/ia/classificacaoTicketService.js`

## Communities (31 total, 1 thin omitted)

### Community 0 - "envio.js"
Cohesion: 0.07
Nodes (66): criarEnvioController(), destinosDoChat(), criarEdicao(), editar(), padrao, { validarChatJid, validarKey, validarMencoes, montarConteudo, obterSocketDaEquipe, enviarPeloSocket, ErroEnvio }, CHAVES_MIDIA, criarEnvio() (+58 more)

### Community 1 - "filtroEntrada.js"
Cohesion: 0.05
Nodes (68): alertarChamada(), { chamarRotaInterna }, registrarChamada(), valeNovaTentativa(), chamarRotaInterna(), chamarRotaInternaMultipart(), ehTimeout(), enviarPost() (+60 more)

### Community 2 - "src/index.js"
Cohesion: 0.10
Nodes (30): registrarControllers(), { ativarLogEmArquivo, limparLogsAntigos }, criarApp(), criarEncerrador(), { criarInstanciaHealth }, express, heartbeat, hostDeEscuta() (+22 more)

### Community 3 - "IaController.js"
Cohesion: 0.08
Nodes (43): ALLOWLIST_AREA, ALLOWLIST_AVALIACAO, ALLOWLIST_CLASSIFICACAO, ALLOWLIST_CRITERIO, ALLOWLIST_IA, ALLOWLIST_NATUREZA, ALLOWLIST_PREVIA, ALLOWLIST_PRODUTO (+35 more)

### Community 4 - "instanciaManager.js"
Cohesion: 0.09
Nodes (36): { chamarRotaInterna }, reportarStatus(), conexaoInternoClient, criarInstanciaHealth(), tique(), verificarEquipe(), verificarTodas(), descreverErro() (+28 more)

### Community 5 - "trilhaVideo.js"
Cohesion: 0.12
Nodes (34): criarFilaTranscricao(), concluir(), enfileirarTranscricao(), transcreverComNovaTentativa(), transcreverNaVez(), desfecho(), { extrairTrilhaAudio, ErroTrilhaAudio, MIMETYPE_TRILHA }, filaPadrao (+26 more)

### Community 6 - "sugestaoTicketService.js"
Cohesion: 0.11
Nodes (35): avaliar(), { conversarJson, cortarNaPalavra }, ehObjeto(), montarPedido(), neutralizarDelimitadores(), previa(), PROMPT_SISTEMA, textoCurto() (+27 more)

### Community 7 - "BaileysAdapter.js"
Cohesion: 0.06
Nodes (34): chamadaInternoClient, { criarCacheEnviadas }, { criarCacheNomeGrupo, ErroConsultaGrupo }, { criarConsolidadorChamadas }, { criarLoteRecibos }, { criarPresenca }, { criarRecibos, extrairDeAtualizacoes, extrairDeRecibos, ehPorDestinatario }, { criarRecuperacao } (+26 more)

### Community 8 - "tipoMidia.js"
Cohesion: 0.13
Nodes (19): RFC-7845, ascii(), ASSINATURAS, BRANDS_3GPP, BRANDS_AUDIO_MP4, BRANDS_QUICKTIME, BRANDS_VIDEO_MP4, DECLARADOS_ACEITOS (+11 more)

### Community 9 - "EnvioController.js"
Cohesion: 0.09
Nodes (27): ALLOWLIST_EDICAO, ALLOWLIST_ENVIO, ALLOWLIST_EXCLUSAO, ALLOWLIST_REACAO, CAMPOS_COMUNS, CAMPOS_DO_TIPO, { criarEdicao }, { criarEnvio, ErroEnvio, EXTENSAO_DOCUMENTO } (+19 more)

### Community 10 - "GrupoController.js"
Cohesion: 0.12
Nodes (21): ALLOWLIST_ADICAO, ALLOWLIST_CONTATO, ALLOWLIST_CRIACAO, { ehProprio }, { ErroConsultaGrupo }, { ErroEnvio, obterSocketDaEquipe }, { ErroGrupo }, ErroRequisicao (+13 more)

### Community 11 - "diagnosticoPresenca.js"
Cohesion: 0.16
Nodes (24): CAMPOS_IGNORADOS, { desembrulhar }, diagnosticoLigado(), dominioDe(), ehEquipe(), gravar(), registrarFormaEventoCall(), registrarFormaMensagem() (+16 more)

### Community 12 - "criarAdapter"
Cohesion: 0.10
Nodes (46): carregarBaileys(), criarAdapter(), abrirSocket(), agendarReconexao(), apagarSessaoLocal(), atualizarStatus(), cancelarReconexao(), desconectar() (+38 more)

### Community 13 - "criarLoteRecibos"
Cohesion: 0.21
Nodes (19): chaveDoDestinatario(), criarLoteRecibos(), adicionar(), armar(), confirmar(), despachar(), dormir(), enviar() (+11 more)

### Community 14 - "midiaEntrada.js"
Cohesion: 0.27
Nodes (10): baixarMidia(), operar(), destruir(), ErroMidia, lerComTeto(), loggerBaileys, obterMidiaValidada(), pino (+2 more)

### Community 15 - "criarRecuperacao"
Cohesion: 0.17
Nodes (18): CAMINHO_ATIVIDADE, criarArmazemAtividade(), carregar(), gravar(), ler(), registrar(), remover(), criarRecuperacao() (+10 more)

### Community 16 - "tmpMidia.js"
Cohesion: 0.22
Nodes (12): configurarPastaTemporaria(), criarRastreadorUploads(), iniciar(), varrer(), exigirPastaDedicada(), fs, limparPastaConfigurada(), limparPastaTemporaria() (+4 more)

### Community 17 - "ContatoController.js"
Cohesion: 0.16
Nodes (13): ALLOWLIST_CONSULTA, ContatoController, criarContatoController(), { ErroConsultaGrupo }, { ErroEnvio, obterSocketDaEquipe }, { ErroGrupo }, ErroRequisicao, exigirTokenServico (+5 more)

### Community 18 - "criarCacheNomeGrupo"
Cohesion: 0.24
Nodes (16): classificarErro(), criarCacheNomeGrupo(), aprender(), buscar(), consultar(), emCache(), entradaDeParticipantes(), esquecer() (+8 more)

### Community 19 - "http/index.js"
Cohesion: 0.22
Nodes (8): ConexaoController, ContatoController, CONTROLLERS, EnvioController, FotoPerfilController, GrupoController, HealthController, IaController

### Community 20 - "grupoGestao.js"
Cohesion: 0.12
Nodes (26): baixarImagem(), { comPrazo, statusDoErro }, { detectarTipoPorConteudo }, ErroFoto, foiRedirecionamento(), lerComTeto(), MENSAGENS_ERRO_FOTO, obterPreview() (+18 more)

### Community 21 - "FotoPerfilController.js"
Cohesion: 0.16
Nodes (13): ALLOWLIST_FOTO, criarFotoPerfilController(), { ErroConsultaGrupo }, { ErroEnvio, obterSocketDaEquipe }, { ErroFoto }, { ErroGrupo }, ErroRequisicao, exigirTokenServico (+5 more)

### Community 22 - "criarConsolidadorChamadas"
Cohesion: 0.26
Nodes (14): criarConsolidadorChamadas(), abrir(), cancelarTimers(), concluir(), ehEquipe(), jaPublicada(), lembrar(), limpar() (+6 more)

### Community 23 - "HealthController.js"
Cohesion: 0.20
Nodes (8): criarHealthController(), fs, HealthController, instanciaManager, path, { SEGUNDOS_RETRY_AFTER }, { version: VERSAO }, padrao

### Community 24 - "run-tests.js"
Cohesion: 0.32
Nodes (7): executar(), LIMITES_COBERTURA, listarArquivosDeTeste(), montarArgumentos(), path, { readdirSync }, { spawnSync }

### Community 25 - "ConexaoController.js"
Cohesion: 0.21
Nodes (9): codEquipeValido(), ConexaoController, criarConexaoController(), exigirTokenServico, instanciaManager, { normalizarCodEquipe }, crypto, exigirTokenServico() (+1 more)

### Community 26 - "criarRegistroAparelho"
Cohesion: 0.53
Nodes (5): criarRegistroAparelho(), deveRegistrar(), ehEcoDoCrm(), expirar(), marcarEnviada()

### Community 27 - "criarCacheEnviadas"
Cohesion: 0.47
Nodes (5): criarCacheEnviadas(), expirar(), guardar(), obter(), { normalizarJid }

### Community 28 - "normalizarCodEquipe"
Cohesion: 0.31
Nodes (9): codEquipeValido(), criarGrupoController(), operacaoDeGrupo(), responder409(), responderErroGrupo(), criarDesligamento(), avisarSeVazio(), recusarDuranteEncerramento() (+1 more)

### Community 29 - "diretorioSessao"
Cohesion: 0.67
Nodes (3): apagarSessaoEmDisco(), diretorioSessao(), existeSessaoEmDisco()

## Knowledge Gaps
- **253 isolated node(s):** `{ readdirSync }`, `{ spawnSync }`, `path`, `LIMITES_COBERTURA`, `{ extrairTrilhaAudio, ErroTrilhaAudio, MIMETYPE_TRILHA }` (+248 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 278 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `criarAdapter()` connect `criarAdapter` to `envio.js`, `filtroEntrada.js`, `instanciaManager.js`, `BaileysAdapter.js`, `criarLoteRecibos`, `criarRecuperacao`, `criarCacheNomeGrupo`, `criarConsolidadorChamadas`, `criarRegistroAparelho`, `criarCacheEnviadas`, `normalizarCodEquipe`, `diretorioSessao`?**
  _High betweenness centrality (0.051) - this node is a cross-community bridge._
- **Why does `padrao` connect `HealthController.js` to `src/index.js`, `IaController.js`, `EnvioController.js`, `GrupoController.js`, `ContatoController.js`, `FotoPerfilController.js`, `ConexaoController.js`?**
  _High betweenness centrality (0.047) - this node is a cross-community bridge._
- **Why does `criarLoteRecibos()` connect `criarLoteRecibos` to `criarAdapter`, `BaileysAdapter.js`?**
  _High betweenness centrality (0.035) - this node is a cross-community bridge._
- **Are the 4 inferred relationships involving `criarAdapter()` (e.g. with `BaileysAdapter.js` and `desconectar()`) actually correct?**
  _`criarAdapter()` has 4 INFERRED edges - model-reasoned connections that need verification._
- **Are the 3 inferred relationships involving `normalizarJid()` (e.g. with `guardar()` and `filtroEntrada.js`) actually correct?**
  _`normalizarJid()` has 3 INFERRED edges - model-reasoned connections that need verification._
- **Are the 12 inferred relationships involving `criarInstanciaManager()` (e.g. with `instanciaManager.js` and `conectar()`) actually correct?**
  _`criarInstanciaManager()` has 12 INFERRED edges - model-reasoned connections that need verification._
- **What connects `{ readdirSync }`, `{ spawnSync }`, `path` to the rest of the system?**
  _253 weakly-connected nodes found - possible documentation gaps or missing edges._