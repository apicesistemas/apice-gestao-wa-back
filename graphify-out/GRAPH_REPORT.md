# Graph Report - apice-gestao-wa-back  (2026-11-02)

## Corpus Check
- 56 files · ~66,930 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 787 nodes · 1817 edges · 31 communities
- Extraction: 86% EXTRACTED · 14% INFERRED · 0% AMBIGUOUS · INFERRED: 247 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `f3b4bd14`
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
- criarResolvedorLid
- FotoPerfilController.js
- criarConsolidadorChamadas
- HealthController.js
- recibos.js
- ConexaoController.js
- criarRegistroAparelho
- criarCacheEnviadas
- obterSocketDaEquipe
- hidratado
- criarDesligamento

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
- `carregar()` --indirect_call--> `caminho()`  [INFERRED]
  src/whatsapp/recuperacao.js → apice-gestao-wa-back/src/audio/trilhaVideo.js
- `gravar()` --indirect_call--> `caminho()`  [INFERRED]
  src/whatsapp/recuperacao.js → apice-gestao-wa-back/src/audio/trilhaVideo.js
- `criarConsolidadorChamadas()` --indirect_call--> `limpar()`  [INFERRED]
  apice-gestao-wa-back/src/whatsapp/chamadas.js → src/whatsapp/chamadas.js
- `criarConsolidadorChamadas()` --indirect_call--> `tratarEvento()`  [INFERRED]
  apice-gestao-wa-back/src/whatsapp/chamadas.js → src/whatsapp/chamadas.js
- `criarEnvio()` --indirect_call--> `enviar()`  [INFERRED]
  apice-gestao-wa-back/src/whatsapp/envio.js → src/whatsapp/envio.js

## Import Cycles
- None detected.

## Communities (31 total, 0 thin omitted)

### Community 0 - "envio.js"
Cohesion: 0.11
Nodes (34): criarEdicao(), editar(), padrao, { validarChatJid, validarKey, validarMencoes, montarConteudo, obterSocketDaEquipe, enviarPeloSocket, ErroEnvio }, CHAVES_MIDIA, enviar(), { duracaoOggOpusSegundos, normalizarMimetype, MIME_DOCX, MIME_XLSX, MIME_DOC, MIME_XLS, MIME_PKCS12 }, enviarPeloSocket() (+26 more)

### Community 1 - "chamarRotaInterna"
Cohesion: 0.07
Nodes (49): alertarChamada(), { chamarRotaInterna }, registrarChamada(), valeNovaTentativa(), chamarRotaInterna(), chamarRotaInternaMultipart(), ehTimeout(), enviarPost() (+41 more)

### Community 2 - "index.js"
Cohesion: 0.07
Nodes (43): registrarControllers(), { ativarLogEmArquivo, limparLogsAntigos }, criarApp(), criarEncerrador(), { criarInstanciaHealth }, express, heartbeat, hostDeEscuta() (+35 more)

### Community 3 - "IaController.js"
Cohesion: 0.07
Nodes (51): executar(), LIMITES_COBERTURA, listarArquivosDeTeste(), montarArgumentos(), path, { readdirSync }, { spawnSync }, ALLOWLIST_AREA (+43 more)

### Community 4 - "instanciaManager.js"
Cohesion: 0.08
Nodes (37): { chamarRotaInterna }, reportarStatus(), conexaoInternoClient, criarInstanciaHealth(), tique(), verificarEquipe(), verificarTodas(), descreverErro() (+29 more)

### Community 5 - "trilhaVideo.js"
Cohesion: 0.12
Nodes (35): criarFilaTranscricao(), concluir(), enfileirarTranscricao(), transcreverComNovaTentativa(), transcreverNaVez(), desfecho(), { extrairTrilhaAudio, ErroTrilhaAudio, MIMETYPE_TRILHA }, filaPadrao (+27 more)

### Community 6 - "sugestaoTicketService.js"
Cohesion: 0.10
Nodes (39): avaliar(), { conversarJson, cortarNaPalavra }, ehObjeto(), montarPedido(), neutralizarDelimitadores(), previa(), PROMPT_SISTEMA, textoCurto() (+31 more)

### Community 7 - "BaileysAdapter.js"
Cohesion: 0.06
Nodes (37): @whiskeysockets/baileys, apagarSessaoEmDisco(), chamadaInternoClient, { criarCacheEnviadas }, { criarCacheNomeGrupo, ErroConsultaGrupo }, { criarConsolidadorChamadas }, { criarLoteRecibos }, { criarPresenca } (+29 more)

### Community 8 - "EnvioController.js"
Cohesion: 0.05
Nodes (62): RFC-7845, ALLOWLIST_EDICAO, ALLOWLIST_ENVIO, ALLOWLIST_EXCLUSAO, ALLOWLIST_REACAO, CAMPOS_COMUNS, CAMPOS_DO_TIPO, codEquipeValido() (+54 more)

### Community 9 - "grupoGestao.js"
Cohesion: 0.13
Nodes (26): baixarImagem(), { comPrazo, statusDoErro }, { detectarTipoPorConteudo }, ErroFoto, foiRedirecionamento(), lerComTeto(), MENSAGENS_ERRO_FOTO, obterPreview() (+18 more)

### Community 10 - "GrupoController.js"
Cohesion: 0.14
Nodes (20): ALLOWLIST_ADICAO, ALLOWLIST_CONTATO, ALLOWLIST_CRIACAO, { ehProprio }, { ErroConsultaGrupo }, { ErroEnvio, obterSocketDaEquipe }, { ErroGrupo }, ErroRequisicao (+12 more)

### Community 11 - "diagnosticoPresenca.js"
Cohesion: 0.18
Nodes (24): CAMPOS_IGNORADOS, { desembrulhar }, diagnosticoLigado(), dominioDe(), ehEquipe(), gravar(), registrarFormaEventoCall(), registrarFormaMensagem() (+16 more)

### Community 12 - "criarAdapter"
Cohesion: 0.18
Nodes (30): carregarBaileys(), criarAdapter(), abrirSocket(), agendarReconexao(), apagarSessaoLocal(), atualizarStatus(), cancelarReconexao(), desconectar() (+22 more)

### Community 13 - "criarLoteRecibos"
Cohesion: 0.21
Nodes (19): chaveDoDestinatario(), criarLoteRecibos(), adicionar(), armar(), confirmar(), despachar(), dormir(), enviar() (+11 more)

### Community 14 - "filtroEntrada.js"
Cohesion: 0.22
Nodes (22): chatRegistravel(), CHAVES_RUIDO, chavesDescartadas(), contexto(), copiarKey(), desembrulhar(), ehLong(), ENVELOPES (+14 more)

### Community 15 - "criarRecuperacao"
Cohesion: 0.17
Nodes (18): CAMINHO_ATIVIDADE, criarArmazemAtividade(), carregar(), gravar(), ler(), registrar(), remover(), criarRecuperacao() (+10 more)

### Community 16 - "normalizarJid"
Cohesion: 0.20
Nodes (19): destinosDoChat(), { normalizarJid }, { normalizarJid, lidDe, telefoneDe, mensagemWaIdValido }, mesmaConversa(), validarMencoes(), identidadeDe(), identidadePropria(), lidDe() (+11 more)

### Community 17 - "ContatoController.js"
Cohesion: 0.18
Nodes (12): ALLOWLIST_CONSULTA, ContatoController, { ErroConsultaGrupo }, { ErroEnvio, obterSocketDaEquipe }, { ErroGrupo }, ErroRequisicao, exigirTokenServico, { normalizarCodEquipe } (+4 more)

### Community 18 - "criarCacheNomeGrupo"
Cohesion: 0.24
Nodes (16): classificarErro(), criarCacheNomeGrupo(), aprender(), buscar(), consultar(), emCache(), entradaDeParticipantes(), esquecer() (+8 more)

### Community 19 - "index.js"
Cohesion: 0.22
Nodes (8): ConexaoController, ContatoController, CONTROLLERS, EnvioController, FotoPerfilController, GrupoController, HealthController, IaController

### Community 20 - "criarResolvedorLid"
Cohesion: 0.29
Nodes (10): comPrazo(), criarResolvedorLid(), aprenderDaMensagem(), aprenderPar(), completarIdentidade(), consultarLidDoTelefone(), lidDoTelefone(), telefoneDoLid() (+2 more)

### Community 21 - "FotoPerfilController.js"
Cohesion: 0.18
Nodes (12): ALLOWLIST_FOTO, { ErroConsultaGrupo }, { ErroEnvio, obterSocketDaEquipe }, { ErroFoto }, { ErroGrupo }, ErroRequisicao, exigirTokenServico, FotoPerfilController (+4 more)

### Community 22 - "criarConsolidadorChamadas"
Cohesion: 0.35
Nodes (13): criarConsolidadorChamadas(), abrir(), cancelarTimers(), concluir(), ehEquipe(), jaPublicada(), lembrar(), limpar() (+5 more)

### Community 23 - "HealthController.js"
Cohesion: 0.22
Nodes (7): criarHealthController(), fs, HealthController, instanciaManager, path, { SEGUNDOS_RETRY_AFTER }, { version: VERSAO }

### Community 24 - "recibos.js"
Cohesion: 0.16
Nodes (19): criarRecibos(), adiarRecibos(), limpar(), processar(), ehPorDestinatario(), extrairDeAtualizacoes(), extrairDeRecibos(), idDaEnviada() (+11 more)

### Community 25 - "ConexaoController.js"
Cohesion: 0.20
Nodes (10): codEquipeValido(), ConexaoController, criarConexaoController(), exigirTokenServico, instanciaManager, { normalizarCodEquipe }, crypto, exigirTokenServico() (+2 more)

### Community 26 - "criarRegistroAparelho"
Cohesion: 0.53
Nodes (5): criarRegistroAparelho(), deveRegistrar(), ehEcoDoCrm(), expirar(), marcarEnviada()

### Community 27 - "criarCacheEnviadas"
Cohesion: 0.83
Nodes (4): criarCacheEnviadas(), expirar(), guardar(), obter()

### Community 28 - "obterSocketDaEquipe"
Cohesion: 0.54
Nodes (8): criarContatoController(), criarFotoPerfilController(), criarGrupoController(), operacaoDeGrupo(), responder409(), responderErroGrupo(), normalizarCodEquipe(), obterSocketDaEquipe()

### Community 29 - "hidratado"
Cohesion: 0.26
Nodes (14): comBotoes(), hidratado(), interativa(), lerJson(), limpo(), lista(), listaDeOpcoes(), modelo() (+6 more)

### Community 30 - "criarDesligamento"
Cohesion: 0.67
Nodes (3): criarDesligamento(), avisarSeVazio(), recusarDuranteEncerramento()

## Knowledge Gaps
- **227 isolated node(s):** `{ readdirSync }`, `{ spawnSync }`, `path`, `LIMITES_COBERTURA`, `{ extrairTrilhaAudio, ErroTrilhaAudio, MIMETYPE_TRILHA }` (+222 more)
  These have ≤1 connection - possible missing edges or undocumented components.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `criarAdapter()` connect `criarAdapter` to `chamarRotaInterna`, `index.js`, `instanciaManager.js`, `BaileysAdapter.js`, `criarLoteRecibos`, `criarRecuperacao`, `normalizarJid`, `criarCacheNomeGrupo`, `criarResolvedorLid`, `criarConsolidadorChamadas`, `recibos.js`, `criarRegistroAparelho`, `criarCacheEnviadas`, `obterSocketDaEquipe`?**
  _High betweenness centrality (0.064) - this node is a cross-community bridge._
- **Why does `contexto()` connect `filtroEntrada.js` to `chamarRotaInterna`, `IaController.js`, `criarAdapter`, `criarLoteRecibos`, `normalizarJid`, `recibos.js`?**
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