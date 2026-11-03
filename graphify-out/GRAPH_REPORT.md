# Graph Report - apice-gestao-wa-back  (2026-11-03)

## Corpus Check
- 56 files · ~66,990 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 788 nodes · 1819 edges · 27 communities
- Extraction: 86% EXTRACTED · 14% INFERRED · 0% AMBIGUOUS · INFERRED: 247 edges (avg confidence: 0.83)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `43e1be3f`
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
- FotoPerfilController.js
- criarConsolidadorChamadas
- HealthController.js
- ConexaoController.js
- criarRegistroAparelho
- criarCacheEnviadas
- obterSocketDaEquipe

## God Nodes (most connected - your core abstractions)
1. `criarAdapter()` - 41 edges
2. `normalizarJid()` - 37 edges
3. `telefoneDe()` - 32 edges
4. `lidDe()` - 29 edges
5. `criarInstanciaManager()` - 21 edges
6. `nomeDoErro()` - 20 edges
7. `chamarRotaInterna()` - 18 edges
8. `obterSocketDaEquipe()` - 18 edges
9. `criarEnvioController()` - 17 edges
10. `mensagemWaIdValido()` - 17 edges

## Surprising Connections (you probably didn't know these)
- `criarPortaoIa()` --indirect_call--> `executar()`  [INFERRED]
  src/ia/portaoIa.js → scripts/run-tests.js
- `acharAddRequest()` --indirect_call--> `filho()`  [INFERRED]
  src/whatsapp/grupoGestao.js → src/audio/trilhaVideo.js
- `carregar()` --indirect_call--> `caminho()`  [INFERRED]
  src/whatsapp/recuperacao.js → src/audio/trilhaVideo.js
- `gravar()` --indirect_call--> `caminho()`  [INFERRED]
  src/whatsapp/recuperacao.js → src/audio/trilhaVideo.js
- `criarIaController()` --indirect_call--> `contexto()`  [INFERRED]
  src/http/IaController.js → src/whatsapp/filtroEntrada.js

## Import Cycles
- 2-file cycle: `src/ia/classificacaoTicketService.js -> src/ia/sugestaoTicketService.js -> src/ia/classificacaoTicketService.js`

## Communities (27 total, 0 thin omitted)

### Community 0 - "envio.js"
Cohesion: 0.06
Nodes (66): ALLOWLIST_EDICAO, ALLOWLIST_ENVIO, ALLOWLIST_EXCLUSAO, ALLOWLIST_REACAO, CAMPOS_COMUNS, CAMPOS_DO_TIPO, { criarEdicao }, { criarEnvio, ErroEnvio, EXTENSAO_DOCUMENTO } (+58 more)

### Community 1 - "chamarRotaInterna"
Cohesion: 0.09
Nodes (40): alertarChamada(), { chamarRotaInterna }, registrarChamada(), valeNovaTentativa(), chamarRotaInterna(), chamarRotaInternaMultipart(), ehTimeout(), enviarPost() (+32 more)

### Community 2 - "index.js"
Cohesion: 0.07
Nodes (43): registrarControllers(), { ativarLogEmArquivo, limparLogsAntigos }, criarApp(), criarEncerrador(), { criarInstanciaHealth }, express, heartbeat, hostDeEscuta() (+35 more)

### Community 3 - "IaController.js"
Cohesion: 0.07
Nodes (51): executar(), LIMITES_COBERTURA, listarArquivosDeTeste(), montarArgumentos(), path, { readdirSync }, { spawnSync }, ALLOWLIST_AREA (+43 more)

### Community 4 - "instanciaManager.js"
Cohesion: 0.09
Nodes (36): { chamarRotaInterna }, reportarStatus(), conexaoInternoClient, criarInstanciaHealth(), tique(), verificarEquipe(), verificarTodas(), descreverErro() (+28 more)

### Community 5 - "trilhaVideo.js"
Cohesion: 0.12
Nodes (35): criarFilaTranscricao(), concluir(), enfileirarTranscricao(), transcreverComNovaTentativa(), transcreverNaVez(), desfecho(), { extrairTrilhaAudio, ErroTrilhaAudio, MIMETYPE_TRILHA }, filaPadrao (+27 more)

### Community 6 - "sugestaoTicketService.js"
Cohesion: 0.10
Nodes (39): avaliar(), { conversarJson, cortarNaPalavra }, ehObjeto(), montarPedido(), neutralizarDelimitadores(), previa(), PROMPT_SISTEMA, textoCurto() (+31 more)

### Community 7 - "BaileysAdapter.js"
Cohesion: 0.06
Nodes (35): @whiskeysockets/baileys, chamadaInternoClient, { criarCacheEnviadas }, { criarCacheNomeGrupo, ErroConsultaGrupo }, { criarConsolidadorChamadas }, { criarLoteRecibos }, { criarPresenca }, { criarRecibos, extrairDeAtualizacoes, extrairDeRecibos, ehPorDestinatario } (+27 more)

### Community 8 - "EnvioController.js"
Cohesion: 0.07
Nodes (43): RFC-7845, criarFotoPerfilController(), baixarImagem(), { comPrazo, statusDoErro }, { detectarTipoPorConteudo }, ErroFoto, foiRedirecionamento(), lerComTeto() (+35 more)

### Community 9 - "grupoGestao.js"
Cohesion: 0.26
Nodes (11): criarPresenca(), inscrever(), tratarAtualizacao(), diagnostico, ESTADO_DA_PRESENCA, estadoDaPresenca(), NodeCache, { normalizarJid } (+3 more)

### Community 10 - "GrupoController.js"
Cohesion: 0.12
Nodes (21): ALLOWLIST_ADICAO, ALLOWLIST_CONTATO, ALLOWLIST_CRIACAO, { ehProprio }, { ErroConsultaGrupo }, { ErroEnvio, obterSocketDaEquipe }, { ErroGrupo }, ErroRequisicao (+13 more)

### Community 11 - "diagnosticoPresenca.js"
Cohesion: 0.18
Nodes (24): CAMPOS_IGNORADOS, { desembrulhar }, diagnosticoLigado(), dominioDe(), ehEquipe(), gravar(), registrarFormaEventoCall(), registrarFormaMensagem() (+16 more)

### Community 12 - "criarAdapter"
Cohesion: 0.10
Nodes (48): carregarBaileys(), criarAdapter(), abrirSocket(), agendarReconexao(), apagarSessaoLocal(), atualizarStatus(), cancelarReconexao(), desconectar() (+40 more)

### Community 13 - "criarLoteRecibos"
Cohesion: 0.21
Nodes (19): chaveDoDestinatario(), criarLoteRecibos(), adicionar(), armar(), confirmar(), despachar(), dormir(), enviar() (+11 more)

### Community 14 - "filtroEntrada.js"
Cohesion: 0.14
Nodes (36): chatRegistravel(), CHAVES_RUIDO, chavesDescartadas(), comBotoes(), contexto(), copiarKey(), desembrulhar(), ehLong() (+28 more)

### Community 15 - "criarRecuperacao"
Cohesion: 0.17
Nodes (18): CAMINHO_ATIVIDADE, criarArmazemAtividade(), carregar(), gravar(), ler(), registrar(), remover(), criarRecuperacao() (+10 more)

### Community 16 - "normalizarJid"
Cohesion: 0.08
Nodes (57): destinosDoChat(), { normalizarJid, lidDe, telefoneDe, mensagemWaIdValido }, mesmaConversa(), identidadeDe(), lidDe(), normalizarJid(), telefoneDe(), acharAddRequest() (+49 more)

### Community 17 - "ContatoController.js"
Cohesion: 0.18
Nodes (13): ALLOWLIST_CONSULTA, ContatoController, criarContatoController(), { ErroConsultaGrupo }, { ErroEnvio, obterSocketDaEquipe }, { ErroGrupo }, ErroRequisicao, exigirTokenServico (+5 more)

### Community 18 - "criarCacheNomeGrupo"
Cohesion: 0.67
Nodes (3): apagarSessaoEmDisco(), diretorioSessao(), existeSessaoEmDisco()

### Community 19 - "index.js"
Cohesion: 0.22
Nodes (8): ConexaoController, ContatoController, CONTROLLERS, EnvioController, FotoPerfilController, GrupoController, HealthController, IaController

### Community 21 - "FotoPerfilController.js"
Cohesion: 0.18
Nodes (12): ALLOWLIST_FOTO, { ErroConsultaGrupo }, { ErroEnvio, obterSocketDaEquipe }, { ErroFoto }, { ErroGrupo }, ErroRequisicao, exigirTokenServico, FotoPerfilController (+4 more)

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

### Community 28 - "obterSocketDaEquipe"
Cohesion: 0.31
Nodes (9): codEquipeValido(), criarGrupoController(), operacaoDeGrupo(), responder409(), responderErroGrupo(), criarDesligamento(), avisarSeVazio(), recusarDuranteEncerramento() (+1 more)

## Knowledge Gaps
- **227 isolated node(s):** `{ readdirSync }`, `{ spawnSync }`, `path`, `LIMITES_COBERTURA`, `{ extrairTrilhaAudio, ErroTrilhaAudio, MIMETYPE_TRILHA }` (+222 more)
  These have ≤1 connection - possible missing edges or undocumented components.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `criarAdapter()` connect `criarAdapter` to `index.js`, `instanciaManager.js`, `BaileysAdapter.js`, `grupoGestao.js`, `criarLoteRecibos`, `criarRecuperacao`, `normalizarJid`, `criarCacheNomeGrupo`, `criarConsolidadorChamadas`, `criarRegistroAparelho`, `criarCacheEnviadas`, `obterSocketDaEquipe`?**
  _High betweenness centrality (0.064) - this node is a cross-community bridge._
- **Why does `contexto()` connect `filtroEntrada.js` to `chamarRotaInterna`, `IaController.js`, `grupoGestao.js`, `criarAdapter`, `criarLoteRecibos`, `normalizarJid`?**
  _High betweenness centrality (0.049) - this node is a cross-community bridge._
- **Why does `criarIaController()` connect `IaController.js` to `sugestaoTicketService.js`, `filtroEntrada.js`?**
  _High betweenness centrality (0.047) - this node is a cross-community bridge._
- **Are the 5 inferred relationships involving `criarAdapter()` (e.g. with `BaileysAdapter.js` and `iniciar()`) actually correct?**
  _`criarAdapter()` has 5 INFERRED edges - model-reasoned connections that need verification._
- **Are the 3 inferred relationships involving `normalizarJid()` (e.g. with `guardar()` and `filtroEntrada.js`) actually correct?**
  _`normalizarJid()` has 3 INFERRED edges - model-reasoned connections that need verification._
- **Are the 12 inferred relationships involving `criarInstanciaManager()` (e.g. with `instanciaManager.js` and `conectar()`) actually correct?**
  _`criarInstanciaManager()` has 12 INFERRED edges - model-reasoned connections that need verification._
- **What connects `{ readdirSync }`, `{ spawnSync }`, `path` to the rest of the system?**
  _227 weakly-connected nodes found - possible documentation gaps or missing edges._