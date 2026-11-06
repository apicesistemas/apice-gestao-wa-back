# Graph Report - apice-gestao-wa-back  (2026-11-06)

## Corpus Check
- 59 files · ~78,542 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 766 nodes · 1614 edges · 28 communities (26 shown, 2 thin omitted)
- Extraction: 88% EXTRACTED · 12% INFERRED · 0% AMBIGUOUS · INFERRED: 200 edges (avg confidence: 0.51)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `518a6c3e`
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
- recuperacao.js
- ConexaoController.js
- resolverLid.js
- criarCacheEnviadas

## God Nodes (most connected - your core abstractions)
1. `normalizarJid()` - 28 edges
2. `telefoneDe()` - 28 edges
3. `recusar()` - 25 edges
4. `lidDe()` - 23 edges
5. `criarIaController()` - 21 edges
6. `exigirChavesPermitidas()` - 19 edges
7. `chamarRotaInterna()` - 18 edges
8. `normalizarCodEquipe()` - 15 edges
9. `criarAdapter()` - 15 edges
10. `mensagemWaIdValido()` - 15 edges

## Surprising Connections (you probably didn't know these)
- `acharAddRequest()` --indirect_call--> `filho()`  [INFERRED]
  apice-gestao-wa-back/src/whatsapp/grupoGestao.js → apice-gestao-wa-back/src/audio/trilhaVideo.js
- `criarIaController()` --indirect_call--> `caminho()`  [INFERRED]
  apice-gestao-wa-back/src/http/IaController.js → apice-gestao-wa-back/src/audio/trilhaVideo.js
- `criarIaController()` --indirect_call--> `contexto()`  [INFERRED]
  apice-gestao-wa-back/src/http/IaController.js → apice-gestao-wa-back/src/whatsapp/filtroEntrada.js
- `criarAdapter()` --indirect_call--> `itens()`  [INFERRED]
  apice-gestao-wa-back/src/whatsapp/BaileysAdapter.js → apice-gestao-wa-back/src/ia/avaliacao360Service.js
- `criarAdapter()` --indirect_call--> `iniciar()`  [INFERRED]
  apice-gestao-wa-back/src/whatsapp/BaileysAdapter.js → apice-gestao-wa-back/src/index.js

## Import Cycles
- None detected.

## Communities (28 total, 2 thin omitted)

### Community 0 - "envio.js"
Cohesion: 0.05
Nodes (57): ALLOWLIST_EDICAO, ALLOWLIST_ENVIO, ALLOWLIST_EXCLUSAO, ALLOWLIST_REACAO, CAMPOS_COMUNS, CAMPOS_DO_TIPO, codEquipeValido(), { criarEdicao } (+49 more)

### Community 1 - "chamarRotaInterna"
Cohesion: 0.07
Nodes (40): alertarChamada(), { chamarRotaInterna }, registrarChamada(), valeNovaTentativa(), { chamarRotaInterna }, reportarStatus(), chamarRotaInterna(), chamarRotaInternaMultipart() (+32 more)

### Community 2 - "index.js"
Cohesion: 0.05
Nodes (51): ConexaoController, ContatoController, CONTROLLERS, EnvioController, FotoPerfilController, GrupoController, HealthController, IaController (+43 more)

### Community 3 - "IaController.js"
Cohesion: 0.06
Nodes (86): ALLOWLIST_AREA, ALLOWLIST_ASSISTENTE, ALLOWLIST_AV360_COMENTARIO, ALLOWLIST_AV360_INSIGHTS, ALLOWLIST_AV360_NIVEIS, ALLOWLIST_AV360_PDI, ALLOWLIST_AV360_RESUMO, ALLOWLIST_AVALIACAO (+78 more)

### Community 4 - "instanciaManager.js"
Cohesion: 0.13
Nodes (12): BaileysAdapter, CAMINHO_REGISTRO, conexaoInternoClient, { criarArmazemAtividade }, criarInstanciaManager(), ErroConexaoEquipe, fs, padrao (+4 more)

### Community 5 - "trilhaVideo.js"
Cohesion: 0.12
Nodes (28): { extrairTrilhaAudio, ErroTrilhaAudio, MIMETYPE_TRILHA }, filaPadrao, transcricaoInternoClient, transcricaoService, ACEITOS_DIRETO, CONTEINERES_ISO, ehTimeout(), { extrairTrilhaAudio, ErroTrilhaAudio, MIMETYPE_TRILHA } (+20 more)

### Community 6 - "sugestaoTicketService.js"
Cohesion: 0.05
Nodes (72): bloco(), blocosBase(), COMO_LER_NUMEROS, { conversarTexto, cortarNaPalavra }, gerarFeedback(), MARCADORES_PREVIA, montarPedidoChat(), montarPedidoFeedback() (+64 more)

### Community 7 - "BaileysAdapter.js"
Cohesion: 0.06
Nodes (34): chamadaInternoClient, { criarCacheEnviadas }, { criarCacheNomeGrupo, ErroConsultaGrupo }, { criarConsolidadorChamadas }, { criarLoteRecibos }, { criarPresenca }, { criarRecibos, extrairDeAtualizacoes, extrairDeRecibos, ehPorDestinatario }, { criarRecuperacao } (+26 more)

### Community 8 - "EnvioController.js"
Cohesion: 0.10
Nodes (30): RFC-7845, baixarMidia(), destruir(), ErroMidia, lerComTeto(), loggerBaileys, obterMidiaValidada(), pino (+22 more)

### Community 9 - "grupoGestao.js"
Cohesion: 0.13
Nodes (27): bloco(), blocoComentarios(), CLASSIFICACOES, { conversarJson, cortarNaPalavra }, gerarInsights360(), GRUPOS, itens(), mediaTexto() (+19 more)

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
Cohesion: 0.14
Nodes (34): CHAVES_RUIDO, chavesDescartadas(), comBotoes(), contexto(), copiarKey(), ehLong(), ENVELOPES, extrairConteudo() (+26 more)

### Community 15 - "criarRecuperacao"
Cohesion: 0.21
Nodes (11): baixarImagem(), { comPrazo, statusDoErro }, { detectarTipoPorConteudo }, ErroFoto, foiRedirecionamento(), lerComTeto(), MENSAGENS_ERRO_FOTO, obterPreview() (+3 more)

### Community 16 - "normalizarJid"
Cohesion: 0.08
Nodes (49): invalido(), mesmaConversa(), validarChatJid(), validarKey(), validarMencoes(), chatRegistravel(), identidadeDe(), identidadePropria() (+41 more)

### Community 17 - "ContatoController.js"
Cohesion: 0.16
Nodes (16): ALLOWLIST_CONSULTA, ContatoController, criarContatoController(), { ErroConsultaGrupo }, { ErroEnvio, obterSocketDaEquipe }, { ErroGrupo }, ErroRequisicao, exigirTokenServico (+8 more)

### Community 18 - "criarCacheNomeGrupo"
Cohesion: 0.67
Nodes (3): apagarSessaoEmDisco(), diretorioSessao(), existeSessaoEmDisco()

### Community 19 - "index.js"
Cohesion: 0.22
Nodes (7): criarPresenca(), diagnostico, ESTADO_DA_PRESENCA, estadoDaPresenca(), NodeCache, { normalizarJid }, presencaInternoClient

### Community 20 - "run-tests.js"
Cohesion: 0.20
Nodes (13): executar(), LIMITES_COBERTURA, listarArquivosDeTeste(), montarArgumentos(), path, { readdirSync }, { spawnSync }, concorrenciaDoAmbiente() (+5 more)

### Community 21 - "FotoPerfilController.js"
Cohesion: 0.14
Nodes (13): ALLOWLIST_FOTO, { ErroConsultaGrupo }, { ErroEnvio, obterSocketDaEquipe }, { ErroFoto }, { ErroGrupo }, ErroRequisicao, exigirTokenServico, FotoPerfilController (+5 more)

### Community 23 - "HealthController.js"
Cohesion: 0.20
Nodes (7): fs, HealthController, instanciaManager, path, { SEGUNDOS_RETRY_AFTER }, { version: VERSAO }, padrao

### Community 24 - "recuperacao.js"
Cohesion: 0.33
Nodes (4): CAMINHO_ATIVIDADE, criarRecuperacao(), fs, path

### Community 25 - "ConexaoController.js"
Cohesion: 0.22
Nodes (9): codEquipeValido(), ConexaoController, criarConexaoController(), exigirTokenServico, instanciaManager, { normalizarCodEquipe }, crypto, exigirTokenServico() (+1 more)

### Community 26 - "resolverLid.js"
Cohesion: 0.40
Nodes (3): criarResolvedorLid(), { lidDe, telefoneDe }, telefoneDeValor()

### Community 27 - "criarCacheEnviadas"
Cohesion: 0.25
Nodes (6): criarAdapter(), criarCacheEnviadas(), { normalizarJid }, criarCacheNomeGrupo(), criarRecibos(), criarRegistroAparelho()

## Knowledge Gaps
- **275 isolated node(s):** `{ readdirSync }`, `{ spawnSync }`, `path`, `LIMITES_COBERTURA`, `{ extrairTrilhaAudio, ErroTrilhaAudio, MIMETYPE_TRILHA }` (+270 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `padrao` connect `HealthController.js` to `envio.js`, `index.js`, `IaController.js`, `GrupoController.js`, `ContatoController.js`, `FotoPerfilController.js`, `ConexaoController.js`?**
  _High betweenness centrality (0.087) - this node is a cross-community bridge._
- **Why does `criarIaController()` connect `IaController.js` to `run-tests.js`, `trilhaVideo.js`, `sugestaoTicketService.js`, `filtroEntrada.js`?**
  _High betweenness centrality (0.068) - this node is a cross-community bridge._
- **Why does `contexto()` connect `filtroEntrada.js` to `normalizarJid`, `IaController.js`?**
  _High betweenness centrality (0.049) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `normalizarJid()` (e.g. with `filtroEntrada.js` and `contexto()`) actually correct?**
  _`normalizarJid()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **Are the 11 inferred relationships involving `criarIaController()` (e.g. with `IaController.js` and `caminho()`) actually correct?**
  _`criarIaController()` has 11 INFERRED edges - model-reasoned connections that need verification._
- **What connects `{ readdirSync }`, `{ spawnSync }`, `path` to the rest of the system?**
  _275 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `envio.js` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._