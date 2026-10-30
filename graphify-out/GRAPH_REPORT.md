# Graph Report - apice-gestao-wa-back  (2026-10-30)

## Corpus Check
- 55 files · ~65,389 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 6 file(s) not represented in the graph (top: (none) 5, .example 1)

## Summary
- 781 nodes · 1770 edges · 31 communities
- Extraction: 87% EXTRACTED · 13% INFERRED · 0% AMBIGUOUS · INFERRED: 231 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `556b24e8`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- envio.js
- chamarRotaInterna
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
- filtroEntrada.js
- criarRecuperacao
- tmpMidia.js
- ContatoController.js
- criarCacheNomeGrupo
- http/index.js
- criarResolvedorLid
- FotoPerfilController.js
- criarConsolidadorChamadas
- HealthController.js
- run-tests.js
- ConexaoController.js
- criarRegistroAparelho
- criarCacheEnviadas
- obterSocketDaEquipe
- diretorioSessao
- criarDesligamento

## God Nodes (most connected - your core abstractions)
1. `criarAdapter()` - 40 edges
2. `normalizarJid()` - 37 edges
3. `telefoneDe()` - 32 edges
4. `lidDe()` - 29 edges
5. `criarInstanciaManager()` - 21 edges
6. `nomeDoErro()` - 20 edges
7. `chamarRotaInterna()` - 18 edges
8. `obterSocketDaEquipe()` - 18 edges
9. `mensagemWaIdValido()` - 17 edges
10. `criarLoteRecibos()` - 17 edges

## Surprising Connections (you probably didn't know these)
- `carregar()` --indirect_call--> `caminho()`  [INFERRED]
  src/whatsapp/recuperacao.js → src/audio/trilhaVideo.js
- `gravar()` --indirect_call--> `caminho()`  [INFERRED]
  src/whatsapp/recuperacao.js → src/audio/trilhaVideo.js
- `operacaoDeGrupo()` --indirect_call--> `recusarDuranteEncerramento()`  [INFERRED]
  src/http/GrupoController.js → src/utils/desligamento.js
- `publicarChamada()` --indirect_call--> `contexto()`  [INFERRED]
  src/whatsapp/BaileysAdapter.js → src/whatsapp/filtroEntrada.js
- `publicarAlertaChamada()` --indirect_call--> `contexto()`  [INFERRED]
  src/whatsapp/BaileysAdapter.js → src/whatsapp/filtroEntrada.js

## Import Cycles
- 2-file cycle: `src/ia/classificacaoTicketService.js -> src/ia/sugestaoTicketService.js -> src/ia/classificacaoTicketService.js`

## Communities (31 total, 0 thin omitted)

### Community 0 - "envio.js"
Cohesion: 0.06
Nodes (68): destinosDoChat(), { normalizarJid, lidDe, telefoneDe, mensagemWaIdValido }, criarEdicao(), editar(), padrao, { validarChatJid, validarKey, validarMencoes, montarConteudo, obterSocketDaEquipe, enviarPeloSocket, ErroEnvio }, CHAVES_MIDIA, enviar() (+60 more)

### Community 1 - "chamarRotaInterna"
Cohesion: 0.07
Nodes (49): alertarChamada(), { chamarRotaInterna }, registrarChamada(), valeNovaTentativa(), chamarRotaInterna(), chamarRotaInternaMultipart(), ehTimeout(), enviarPost() (+41 more)

### Community 2 - "src/index.js"
Cohesion: 0.10
Nodes (30): registrarControllers(), { ativarLogEmArquivo, limparLogsAntigos }, criarApp(), criarEncerrador(), { criarInstanciaHealth }, express, heartbeat, hostDeEscuta() (+22 more)

### Community 3 - "IaController.js"
Cohesion: 0.08
Nodes (43): ALLOWLIST_AREA, ALLOWLIST_AVALIACAO, ALLOWLIST_CLASSIFICACAO, ALLOWLIST_CRITERIO, ALLOWLIST_IA, ALLOWLIST_NATUREZA, ALLOWLIST_PREVIA, ALLOWLIST_PRODUTO (+35 more)

### Community 4 - "instanciaManager.js"
Cohesion: 0.08
Nodes (37): { chamarRotaInterna }, reportarStatus(), conexaoInternoClient, criarInstanciaHealth(), tique(), verificarEquipe(), verificarTodas(), descreverErro() (+29 more)

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
Cohesion: 0.07
Nodes (41): RFC-7845, baixarImagem(), { comPrazo, statusDoErro }, { detectarTipoPorConteudo }, ErroFoto, foiRedirecionamento(), lerComTeto(), MENSAGENS_ERRO_FOTO (+33 more)

### Community 9 - "EnvioController.js"
Cohesion: 0.09
Nodes (32): ALLOWLIST_EDICAO, ALLOWLIST_ENVIO, ALLOWLIST_EXCLUSAO, ALLOWLIST_REACAO, CAMPOS_COMUNS, CAMPOS_DO_TIPO, codEquipeValido(), { criarEdicao } (+24 more)

### Community 10 - "GrupoController.js"
Cohesion: 0.14
Nodes (20): ALLOWLIST_ADICAO, ALLOWLIST_CONTATO, ALLOWLIST_CRIACAO, { ehProprio }, { ErroConsultaGrupo }, { ErroEnvio, obterSocketDaEquipe }, { ErroGrupo }, ErroRequisicao (+12 more)

### Community 11 - "diagnosticoPresenca.js"
Cohesion: 0.16
Nodes (24): CAMPOS_IGNORADOS, { desembrulhar }, diagnosticoLigado(), dominioDe(), ehEquipe(), gravar(), registrarFormaEventoCall(), registrarFormaMensagem() (+16 more)

### Community 12 - "criarAdapter"
Cohesion: 0.10
Nodes (48): carregarBaileys(), criarAdapter(), abrirSocket(), agendarReconexao(), apagarSessaoLocal(), atualizarStatus(), cancelarReconexao(), desconectar() (+40 more)

### Community 13 - "criarLoteRecibos"
Cohesion: 0.21
Nodes (19): chaveDoDestinatario(), criarLoteRecibos(), adicionar(), armar(), confirmar(), despachar(), dormir(), enviar() (+11 more)

### Community 14 - "filtroEntrada.js"
Cohesion: 0.13
Nodes (37): chatRegistravel(), CHAVES_RUIDO, chavesDescartadas(), comBotoes(), contexto(), copiarKey(), desembrulhar(), ehLong() (+29 more)

### Community 15 - "criarRecuperacao"
Cohesion: 0.17
Nodes (18): CAMINHO_ATIVIDADE, criarArmazemAtividade(), carregar(), gravar(), ler(), registrar(), remover(), criarRecuperacao() (+10 more)

### Community 16 - "tmpMidia.js"
Cohesion: 0.22
Nodes (12): configurarPastaTemporaria(), criarRastreadorUploads(), iniciar(), varrer(), exigirPastaDedicada(), fs, limparPastaConfigurada(), limparPastaTemporaria() (+4 more)

### Community 17 - "ContatoController.js"
Cohesion: 0.17
Nodes (12): ALLOWLIST_CONSULTA, ContatoController, { ErroConsultaGrupo }, { ErroEnvio, obterSocketDaEquipe }, { ErroGrupo }, ErroRequisicao, exigirTokenServico, { normalizarCodEquipe } (+4 more)

### Community 18 - "criarCacheNomeGrupo"
Cohesion: 0.28
Nodes (15): classificarErro(), criarCacheNomeGrupo(), aprender(), buscar(), consultar(), emCache(), entradaDeParticipantes(), esquecer() (+7 more)

### Community 19 - "http/index.js"
Cohesion: 0.22
Nodes (8): ConexaoController, ContatoController, CONTROLLERS, EnvioController, FotoPerfilController, GrupoController, HealthController, IaController

### Community 20 - "criarResolvedorLid"
Cohesion: 0.27
Nodes (11): comPrazo(), criarResolvedorLid(), aprenderContatos(), aprenderDaMensagem(), aprenderPar(), completarIdentidade(), consultarLidDoTelefone(), lidDoTelefone() (+3 more)

### Community 21 - "FotoPerfilController.js"
Cohesion: 0.17
Nodes (12): ALLOWLIST_FOTO, { ErroConsultaGrupo }, { ErroEnvio, obterSocketDaEquipe }, { ErroFoto }, { ErroGrupo }, ErroRequisicao, exigirTokenServico, FotoPerfilController (+4 more)

### Community 22 - "criarConsolidadorChamadas"
Cohesion: 0.35
Nodes (13): criarConsolidadorChamadas(), abrir(), cancelarTimers(), concluir(), ehEquipe(), jaPublicada(), lembrar(), limpar() (+5 more)

### Community 23 - "HealthController.js"
Cohesion: 0.22
Nodes (7): criarHealthController(), fs, HealthController, instanciaManager, path, { SEGUNDOS_RETRY_AFTER }, { version: VERSAO }

### Community 24 - "run-tests.js"
Cohesion: 0.32
Nodes (7): executar(), LIMITES_COBERTURA, listarArquivosDeTeste(), montarArgumentos(), path, { readdirSync }, { spawnSync }

### Community 25 - "ConexaoController.js"
Cohesion: 0.20
Nodes (10): codEquipeValido(), ConexaoController, criarConexaoController(), exigirTokenServico, instanciaManager, { normalizarCodEquipe }, crypto, exigirTokenServico() (+2 more)

### Community 26 - "criarRegistroAparelho"
Cohesion: 0.53
Nodes (5): criarRegistroAparelho(), deveRegistrar(), ehEcoDoCrm(), expirar(), marcarEnviada()

### Community 27 - "criarCacheEnviadas"
Cohesion: 0.47
Nodes (5): criarCacheEnviadas(), expirar(), guardar(), obter(), { normalizarJid }

### Community 28 - "obterSocketDaEquipe"
Cohesion: 0.54
Nodes (8): criarContatoController(), criarFotoPerfilController(), criarGrupoController(), operacaoDeGrupo(), responder409(), responderErroGrupo(), normalizarCodEquipe(), obterSocketDaEquipe()

### Community 29 - "diretorioSessao"
Cohesion: 0.67
Nodes (3): apagarSessaoEmDisco(), diretorioSessao(), existeSessaoEmDisco()

### Community 30 - "criarDesligamento"
Cohesion: 0.67
Nodes (3): criarDesligamento(), avisarSeVazio(), recusarDuranteEncerramento()

## Knowledge Gaps
- **254 isolated node(s):** `{ readdirSync }`, `{ spawnSync }`, `path`, `LIMITES_COBERTURA`, `{ extrairTrilhaAudio, ErroTrilhaAudio, MIMETYPE_TRILHA }` (+249 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 279 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `criarAdapter()` connect `criarAdapter` to `envio.js`, `chamarRotaInterna`, `instanciaManager.js`, `BaileysAdapter.js`, `criarLoteRecibos`, `criarRecuperacao`, `criarCacheNomeGrupo`, `criarResolvedorLid`, `criarConsolidadorChamadas`, `criarRegistroAparelho`, `criarCacheEnviadas`, `obterSocketDaEquipe`, `diretorioSessao`?**
  _High betweenness centrality (0.052) - this node is a cross-community bridge._
- **Why does `padrao` connect `ConexaoController.js` to `src/index.js`, `IaController.js`, `EnvioController.js`, `GrupoController.js`, `ContatoController.js`, `FotoPerfilController.js`, `HealthController.js`?**
  _High betweenness centrality (0.046) - this node is a cross-community bridge._
- **Why does `criarLoteRecibos()` connect `criarLoteRecibos` to `criarAdapter`, `BaileysAdapter.js`?**
  _High betweenness centrality (0.034) - this node is a cross-community bridge._
- **Are the 4 inferred relationships involving `criarAdapter()` (e.g. with `BaileysAdapter.js` and `desconectar()`) actually correct?**
  _`criarAdapter()` has 4 INFERRED edges - model-reasoned connections that need verification._
- **Are the 3 inferred relationships involving `normalizarJid()` (e.g. with `guardar()` and `filtroEntrada.js`) actually correct?**
  _`normalizarJid()` has 3 INFERRED edges - model-reasoned connections that need verification._
- **Are the 12 inferred relationships involving `criarInstanciaManager()` (e.g. with `instanciaManager.js` and `conectar()`) actually correct?**
  _`criarInstanciaManager()` has 12 INFERRED edges - model-reasoned connections that need verification._
- **What connects `{ readdirSync }`, `{ spawnSync }`, `path` to the rest of the system?**
  _254 weakly-connected nodes found - possible documentation gaps or missing edges._