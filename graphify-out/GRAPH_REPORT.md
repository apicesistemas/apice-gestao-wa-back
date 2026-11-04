# Graph Report - apice-gestao-wa-back  (2026-11-04)

## Corpus Check
- 56 files · ~66,990 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 6 file(s) not represented in the graph (top: (none) 5, .example 1)

## Summary
- 788 nodes · 1782 edges · 28 communities
- Extraction: 87% EXTRACTED · 13% INFERRED · 0% AMBIGUOUS · INFERRED: 233 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `c97d363d`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- EnvioController.js
- chamarRotaInterna
- src/index.js
- IaController.js
- instanciaManager.js
- trilhaVideo.js
- sugestaoTicketService.js
- BaileysAdapter.js
- tipoMidia.js
- tmpMidia.js
- GrupoController.js
- diagnosticoPresenca.js
- criarAdapter
- criarLoteRecibos
- filtroEntrada.js
- criarRecuperacao
- normalizarJid
- ContatoController.js
- diretorioSessao
- http/index.js
- run-tests.js
- FotoPerfilController.js
- criarConsolidadorChamadas
- HealthController.js
- ConexaoController.js
- criarRegistroAparelho
- criarCacheEnviadas
- normalizarCodEquipe

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
- `publicarChamada()` --indirect_call--> `contexto()`  [INFERRED]
  src/whatsapp/BaileysAdapter.js → src/whatsapp/filtroEntrada.js
- `publicarAlertaChamada()` --indirect_call--> `contexto()`  [INFERRED]
  src/whatsapp/BaileysAdapter.js → src/whatsapp/filtroEntrada.js
- `guardar()` --indirect_call--> `normalizarJid()`  [INFERRED]
  src/whatsapp/cacheEnviadas.js → src/whatsapp/filtroEntrada.js

## Import Cycles
- 2-file cycle: `src/ia/classificacaoTicketService.js -> src/ia/sugestaoTicketService.js -> src/ia/classificacaoTicketService.js`

## Communities (28 total, 0 thin omitted)

### Community 0 - "EnvioController.js"
Cohesion: 0.06
Nodes (67): ALLOWLIST_EDICAO, ALLOWLIST_ENVIO, ALLOWLIST_EXCLUSAO, ALLOWLIST_REACAO, CAMPOS_COMUNS, CAMPOS_DO_TIPO, { criarEdicao }, { criarEnvio, ErroEnvio, EXTENSAO_DOCUMENTO } (+59 more)

### Community 1 - "chamarRotaInterna"
Cohesion: 0.08
Nodes (39): alertarChamada(), { chamarRotaInterna }, registrarChamada(), valeNovaTentativa(), { chamarRotaInterna }, chamarRotaInterna(), chamarRotaInternaMultipart(), ehTimeout() (+31 more)

### Community 2 - "src/index.js"
Cohesion: 0.08
Nodes (37): registrarControllers(), { ativarLogEmArquivo, limparLogsAntigos }, criarApp(), criarEncerrador(), { criarInstanciaHealth }, express, heartbeat, hostDeEscuta() (+29 more)

### Community 3 - "IaController.js"
Cohesion: 0.08
Nodes (44): ALLOWLIST_AREA, ALLOWLIST_AVALIACAO, ALLOWLIST_CLASSIFICACAO, ALLOWLIST_CRITERIO, ALLOWLIST_IA, ALLOWLIST_NATUREZA, ALLOWLIST_PREVIA, ALLOWLIST_PRODUTO (+36 more)

### Community 4 - "instanciaManager.js"
Cohesion: 0.12
Nodes (28): reportarStatus(), BaileysAdapter, CAMINHO_REGISTRO, conexaoInternoClient, { criarArmazemAtividade }, criarInstanciaManager(), comTrava(), conectar() (+20 more)

### Community 5 - "trilhaVideo.js"
Cohesion: 0.11
Nodes (35): criarFilaTranscricao(), concluir(), enfileirarTranscricao(), transcreverComNovaTentativa(), transcreverNaVez(), desfecho(), { extrairTrilhaAudio, ErroTrilhaAudio, MIMETYPE_TRILHA }, filaPadrao (+27 more)

### Community 6 - "sugestaoTicketService.js"
Cohesion: 0.09
Nodes (39): avaliar(), { conversarJson, cortarNaPalavra }, ehObjeto(), montarPedido(), neutralizarDelimitadores(), previa(), PROMPT_SISTEMA, textoCurto() (+31 more)

### Community 7 - "BaileysAdapter.js"
Cohesion: 0.06
Nodes (34): chamadaInternoClient, { criarCacheEnviadas }, { criarCacheNomeGrupo, ErroConsultaGrupo }, { criarConsolidadorChamadas }, { criarLoteRecibos }, { criarPresenca }, { criarRecibos, extrairDeAtualizacoes, extrairDeRecibos, ehPorDestinatario }, { criarRecuperacao } (+26 more)

### Community 8 - "tipoMidia.js"
Cohesion: 0.06
Nodes (42): RFC-7845, baixarImagem(), { comPrazo, statusDoErro }, { detectarTipoPorConteudo }, ErroFoto, foiRedirecionamento(), lerComTeto(), MENSAGENS_ERRO_FOTO (+34 more)

### Community 9 - "tmpMidia.js"
Cohesion: 0.22
Nodes (12): configurarPastaTemporaria(), criarRastreadorUploads(), iniciar(), varrer(), exigirPastaDedicada(), fs, limparPastaConfigurada(), limparPastaTemporaria() (+4 more)

### Community 10 - "GrupoController.js"
Cohesion: 0.12
Nodes (21): ALLOWLIST_ADICAO, ALLOWLIST_CONTATO, ALLOWLIST_CRIACAO, { ehProprio }, { ErroConsultaGrupo }, { ErroEnvio, obterSocketDaEquipe }, { ErroGrupo }, ErroRequisicao (+13 more)

### Community 11 - "diagnosticoPresenca.js"
Cohesion: 0.10
Nodes (35): CAMPOS_IGNORADOS, { desembrulhar }, diagnosticoLigado(), dominioDe(), ehEquipe(), gravar(), registrarFormaEventoCall(), registrarFormaMensagem() (+27 more)

### Community 12 - "criarAdapter"
Cohesion: 0.10
Nodes (48): carregarBaileys(), criarAdapter(), abrirSocket(), agendarReconexao(), apagarSessaoLocal(), atualizarStatus(), cancelarReconexao(), desconectar() (+40 more)

### Community 13 - "criarLoteRecibos"
Cohesion: 0.21
Nodes (19): chaveDoDestinatario(), criarLoteRecibos(), adicionar(), armar(), confirmar(), despachar(), dormir(), enviar() (+11 more)

### Community 14 - "filtroEntrada.js"
Cohesion: 0.13
Nodes (38): chatRegistravel(), CHAVES_RUIDO, chavesDescartadas(), comBotoes(), contexto(), copiarKey(), desembrulhar(), ehLong() (+30 more)

### Community 15 - "criarRecuperacao"
Cohesion: 0.17
Nodes (18): CAMINHO_ATIVIDADE, criarArmazemAtividade(), carregar(), gravar(), ler(), registrar(), remover(), criarRecuperacao() (+10 more)

### Community 16 - "normalizarJid"
Cohesion: 0.08
Nodes (57): destinosDoChat(), { normalizarJid, lidDe, telefoneDe, mensagemWaIdValido }, mesmaConversa(), identidadeDe(), lidDe(), normalizarJid(), telefoneDe(), acharAddRequest() (+49 more)

### Community 17 - "ContatoController.js"
Cohesion: 0.16
Nodes (13): ALLOWLIST_CONSULTA, ContatoController, criarContatoController(), { ErroConsultaGrupo }, { ErroEnvio, obterSocketDaEquipe }, { ErroGrupo }, ErroRequisicao, exigirTokenServico (+5 more)

### Community 18 - "diretorioSessao"
Cohesion: 0.67
Nodes (3): apagarSessaoEmDisco(), diretorioSessao(), existeSessaoEmDisco()

### Community 19 - "http/index.js"
Cohesion: 0.22
Nodes (8): ConexaoController, ContatoController, CONTROLLERS, EnvioController, FotoPerfilController, GrupoController, HealthController, IaController

### Community 20 - "run-tests.js"
Cohesion: 0.32
Nodes (7): executar(), LIMITES_COBERTURA, listarArquivosDeTeste(), montarArgumentos(), path, { readdirSync }, { spawnSync }

### Community 21 - "FotoPerfilController.js"
Cohesion: 0.16
Nodes (13): ALLOWLIST_FOTO, criarFotoPerfilController(), { ErroConsultaGrupo }, { ErroEnvio, obterSocketDaEquipe }, { ErroFoto }, { ErroGrupo }, ErroRequisicao, exigirTokenServico (+5 more)

### Community 22 - "criarConsolidadorChamadas"
Cohesion: 0.35
Nodes (13): criarConsolidadorChamadas(), abrir(), cancelarTimers(), concluir(), ehEquipe(), jaPublicada(), lembrar(), limpar() (+5 more)

### Community 23 - "HealthController.js"
Cohesion: 0.20
Nodes (8): criarHealthController(), fs, HealthController, instanciaManager, path, { SEGUNDOS_RETRY_AFTER }, { version: VERSAO }, padrao

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

## Knowledge Gaps
- **258 isolated node(s):** `{ readdirSync }`, `{ spawnSync }`, `path`, `LIMITES_COBERTURA`, `{ extrairTrilhaAudio, ErroTrilhaAudio, MIMETYPE_TRILHA }` (+253 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 283 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `criarAdapter()` connect `criarAdapter` to `instanciaManager.js`, `BaileysAdapter.js`, `diagnosticoPresenca.js`, `criarLoteRecibos`, `criarRecuperacao`, `normalizarJid`, `diretorioSessao`, `criarConsolidadorChamadas`, `criarRegistroAparelho`, `criarCacheEnviadas`, `normalizarCodEquipe`?**
  _High betweenness centrality (0.052) - this node is a cross-community bridge._
- **Why does `padrao` connect `HealthController.js` to `EnvioController.js`, `src/index.js`, `IaController.js`, `GrupoController.js`, `ContatoController.js`, `FotoPerfilController.js`, `ConexaoController.js`?**
  _High betweenness centrality (0.048) - this node is a cross-community bridge._
- **Why does `criarLoteRecibos()` connect `criarLoteRecibos` to `criarAdapter`, `BaileysAdapter.js`?**
  _High betweenness centrality (0.033) - this node is a cross-community bridge._
- **Are the 4 inferred relationships involving `criarAdapter()` (e.g. with `BaileysAdapter.js` and `desconectar()`) actually correct?**
  _`criarAdapter()` has 4 INFERRED edges - model-reasoned connections that need verification._
- **Are the 3 inferred relationships involving `normalizarJid()` (e.g. with `guardar()` and `filtroEntrada.js`) actually correct?**
  _`normalizarJid()` has 3 INFERRED edges - model-reasoned connections that need verification._
- **Are the 12 inferred relationships involving `criarInstanciaManager()` (e.g. with `instanciaManager.js` and `conectar()`) actually correct?**
  _`criarInstanciaManager()` has 12 INFERRED edges - model-reasoned connections that need verification._
- **What connects `{ readdirSync }`, `{ spawnSync }`, `path` to the rest of the system?**
  _258 weakly-connected nodes found - possible documentation gaps or missing edges._