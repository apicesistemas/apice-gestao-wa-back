# Changelog

Todas as mudanças relevantes deste projeto são documentadas aqui.
O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/).

## [0.4.0] - 2026-10-14

### Adicionado

- `src/whatsapp/filtroEntrada.js`: `normalizarMensagem(waMessage, { eu })` transforma cada mensagem recebida numa `MensagemRecebida`, sem baixar nem consultar nada. Cobre texto, imagem, vídeo, áudio (com indicação de nota de voz), documento, figurinha, localização, contato (vCard), reação, citação, menções, edição e exclusão, inclusive em mensagens temporárias e de visualização única. Mensagens de grupo identificam o grupo e o participante que enviou. Mensagens enviadas pelo aparelho da equipe ficam com origem `APARELHO`. Um contato só com LID é registrado pelo LID. A mídia vai só com os metadados (tipo, tamanho declarado, nome do arquivo, duração). A `key` e o conteúdo bruto (em JSON) são guardados para citar e reagir depois. Status, transmissão, canais e a conversa do número com ele mesmo são ignorados.
- `src/whatsapp/registroAparelho.js`: separa o eco das mensagens enviadas pelo CRM (cache `enviadas` em memória, com prazo e teto) das mensagens digitadas no celular ou no WhatsApp Web, que são registradas.
- `src/whatsapp/resolverLid.js`: pares LID ↔ telefone por equipe, só em memória, aprendidos de `senderPn`/`senderLid`, `participantPn`/`participantLid`, `chats.phoneNumberShare` e dos contatos. A consulta `onWhatsApp` tem cache e prazo. Mensagens do aparelho nunca servem de fonte, porque nelas o `senderPn` é o número da equipe.
- `src/services/mensagemInternoClient.js`: `registrarMensagem(mensagem, { hash_empresa, cod_equipe })` envia a mensagem ao back em `POST /interno/mensagem-recebida`.

### Alterado

- `src/whatsapp/BaileysAdapter.js`: `messages.upsert` (`notify` e `append`) passa por normalização, descarte do eco, complemento de LID ↔ telefone e registro no back, numa fila serial por equipe. Uma falha no back só gera log (sem telefone nem conteúdo), não derruba o processo e não altera a ordem das mensagens seguintes. Novo `marcarEnviadaPeloCrm(id)` para o pipeline de saída. O logout pelo aparelho também limpa os caches de entrada.

## [0.3.0] - 2026-10-14

### Adicionado

- `src/whatsapp/BaileysAdapter.js`: conexão WhatsApp de uma equipe, com sessão em `sessoes-baileys/<cod_equipe>` (`useMultiFileAuthState`) e caches próprios. `iniciar()` é reentrante e nunca deixa dois sockets abertos na mesma sessão. O QR deixa a equipe em `QR_PENDENTE` e fica disponível em PNG, e some ao conectar (`CONECTADO`). Um logout feito pelo aparelho apaga a sessão da equipe e reporta `DESCONECTADO`. Qualquer outra queda reporta `ERRO` e agenda uma única reconexão, mesmo que a queda chegue duas vezes. Um QR que expira sem leitura não é regerado sozinho. `pararSocket()` encerra a conexão sem apagar a sessão.
- `src/whatsapp/instanciaManager.js`: uma instância por equipe (`conectar`, `obter`, `reconectarTodas`, `encerrarTodas`). Uma instância com falha na abertura não fica presa em memória. Equipes de empresas diferentes não compartilham instância. As equipes já pareadas ficam num registro em `.cache/equipes-wa.json` (fora da pasta de sessões), e no boot só elas reconectam, se a sessão ainda estiver em disco. Nenhum QR é gerado sem pedido.
- `src/http/ConexaoController.js`: `POST /equipe/:cod_equipe/conectar` (body com `hash_empresa`) e `GET /equipe/:cod_equipe/qr` (PNG, ou 404 sem QR pendente), só com o token de serviço do back. Responde 400 para código de equipe inválido ou sem `hash_empresa`, e 409 para equipe já conectada por outra empresa.
- `src/services/conexaoInternoClient.js`: `reportarStatus(codEquipe, status)` envia ao back `POST /interno/wa/status` com `hash_empresa`, `cod_equipe`, `status_conexao` e `ultimo_erro_conexao`. O erro reportado traz só o código da queda, sem telefone.

### Alterado

- `src/index.js`: no boot, reconecta as equipes pareadas. O desligamento gracioso encerra as instâncias do WhatsApp antes de fechar o HTTP, e uma falha nesse passo não impede a saída.

## [0.2.0] - 2026-10-14

### Adicionado

- `src/http/exigirTokenServico.js`: exige o token de serviço do back no header `X-Internal-Token` (comparação em tempo constante); sem token ou com token errado responde 401 `{ msg }` em pt-BR.
- `src/http/index.js` com `registrarControllers(server)`: tabela de controllers, 404 "Rota não encontrada." e tratador de erros 500 "Erro interno do servidor." sem `stack` nem mensagem do erro.
- `src/http/HealthController.js` com `GET /ping` (a rota `GET /health` foi movida para cá).
- `src/services/internoHttpClient.js` com `chamarRotaInterna(rota, corpo)`: POST JSON ao back com `X-Internal-Token` e `hash_empresa` obrigatório no corpo, prazo configurável (`CRM_BACK_TIMEOUT_MS`, padrão 10 s) e falhas de configuração, rede, timeout e HTTP convertidas em `ErroRotaInterna`.
- `src/utils/logArquivo.js`: espelho do console em `LOGS/log_AAAAMMDD.txt`, telefone/JID/LID mascarado no console e no arquivo, e limpeza diária dos logs com mais de 10 dias.
- `src/index.js`: validação das variáveis obrigatórias só no boot real, log em arquivo e desligamento gracioso em SIGINT/SIGTERM com teto de 10 s.
- `CRM_BACK_TIMEOUT_MS` no `.env.example`.

### Removido

- `src/http/health.js` (substituído pelo `HealthController`).

## [0.1.0] - 2026-10-14

### Adicionado

- Estrutura inicial do projeto: servidor HTTP com a rota `GET /health` e suíte de testes com teste de fumaça.
