# Changelog

Todas as mudanças relevantes deste projeto são documentadas aqui.
O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/).

## [0.12.2] - 2026-10-16

### Corrigido

- Envio (`envio.js`): o texto e a legenda chegavam ao Baileys com `\r\n`, porque o `multipart/form-data` normaliza as quebras de linha dos campos de texto para CRLF (confirmado com um multipart real no teste). Agora `\r\n` e `\r` isolado viram `\n` antes de montar a mensagem, o que corrige o "*Nome*\r\n<texto>" da identificação do atendente. Nada mais muda no conteúdo (sem trim, sem juntar linhas). Os limites de 65536 (texto) e 1024 (legenda) passam a valer sobre o texto já normalizado, então o CRLF não conta em dobro. Sem mudança de contrato.

## [0.12.1] - 2026-10-16

### Alterado

- Nome do app no PM2 passa de `apice-gestao-wa-back` para `Ápice Gestão - WA Back` (`ecosystem.config.cjs` e `APP` do `deploy.sh`). O `package.json` e a pasta não mudam. Todo uso de `"$APP"` no `deploy.sh` está entre aspas (a detecção `pm2 describe` e a mensagem `pm2 logs "Ápice Gestão - WA Back" --lines 100`), para o nome com espaço não cair no `pm2 start` e subir uma segunda instância na mesma sessão do Baileys.
- Testes: o stub de `pm2 describe` só acha o app com o nome inteiro em um único argumento; casos novos garantem `pm2 reload` (nunca `pm2 start`) com o app existente e `$APP` sempre entre aspas.
- **Operação (uma única vez):** no servidor, rodar `pm2 delete apice-gestao-wa-back` antes do próximo deploy. O `deploy.sh` não chama `pm2 delete`. Sem isso, o processo antigo e o novo abririam a mesma sessão do Baileys.

## [0.12.0] - 2026-10-16

### Adicionado

- Task 17.1, menções detalhadas. Em grupo, a menção chegava ao livechat só como o LID cru ("@48039360200936"). `POST /interno/mensagem-recebida` (que também leva a edição, tipo `EDICAO`) ganha o campo opcional `mencoes_detalhe: { jid, lid, telefone, propria }[]`, um item por JID de `mencoes` (que continua exatamente como era). `jid` até 100 caracteres, `lid` `/^\d{1,25}@lid$/` ou `null`, `telefone` `/^\d{8,15}$/` ou `null` e `propria` é `true` quando o mencionado é o número da própria equipe. Sem par conhecido, o campo fica `null` e a mensagem é registrada normalmente. Só vai quando a mensagem tem menções.
- `src/whatsapp/mencoesEntrada.js`: `detalharMencoes(mencoes, { resolvedorLid, participantes, eu })`, função pura que usa o resolvedor de LID da equipe e os participantes do grupo.
- `POST /equipe/:cod_equipe/grupo/participantes` (`src/http/GrupoController.js`, back → wa-back, token de serviço). Corpo `{ hash_empresa, chat_jid }` (`chat_jid` de grupo); 200 `{ participantes: [{ jid, lid, telefone, admin }] }`, sem o número da equipe e sem nome. `jid` é o `id` do participante no endereçamento do grupo (LID ou telefone), o valor que vai em `mentionedJid`. Erros: 400 ("Informe o hash_empresa da equipe.", "Grupo inválido.", "Código da equipe inválido."), 401, 404 "Equipe não encontrada." (outro tenant), 404 "Grupo não encontrado." (número fora do grupo), 409 "O WhatsApp da equipe não está conectado.", 503 com `Retry-After` (desligamento), 504 "A consulta dos participantes não respondeu." e 502 "Não foi possível consultar os participantes." (outra falha do WhatsApp). Sem efeito no WhatsApp; o log leva só o `cod_equipe` e o código do erro.
- `nomeGrupo.js`: o cache de grupo guarda também os participantes (mesma consulta ao `groupMetadata` do nome, uma por grupo mesmo com chamadas simultâneas), com `obterParticipantes(socket, jid)` (rejeita com `ErroConsultaGrupo`: `PRAZO_ESGOTADO`, `GRUPO_NAO_ENCONTRADO` ou `FALHA`) e `esquecer(jid)`.
- `BaileysAdapter`: escuta `group-participants.update` (esquece o grupo) e expõe `obterParticipantesGrupo(chatJid)`. `groups.update` continua atualizando o nome sem nova consulta e passa a invalidar os participantes do grupo.

### Corrigido

- `filtroEntrada`: na edição (`EDICAO`), as menções também são lidas do `contextInfo` do nó de mídia editado (`imageMessage`, `videoMessage`, `documentMessage` e `documentWithCaptionMessage`, que já vem desembrulhado), não só do `extendedTextMessage`. Editar a legenda de uma mídia que tinha "@<lid>" não zera mais `mencoes` nem `mencoes_detalhe`.

### Deploy

- Campo e rota são aditivos e opcionais. Ordem recomendada: back → wa-back → front (o back passa a aceitar `mencoes_detalhe` antes de o wa-back enviá-lo; a rota de participantes só é chamada pelo back depois de o wa-back estar no ar). A ordem inversa também é segura: o back atual ignora o campo desconhecido, e o wa-back antigo responde 404 à rota nova, que o back deve tratar como indisponível.

## [0.11.1] - 2026-10-15

### Alterado

- `package.json`: `engines.node` passa de `>=22` para `>=22.9`, porque o `start` e o `nodemon.json` usam `node --env-file-if-exists`, que só existe a partir do Node 22.9.0. O README passa a dizer "Node.js 22.9+".
- README: a seção de deploy documenta `DEPLOY_PORTA`, `DEPLOY_TENTATIVAS_PING` e `DEPLOY_INTERVALO_PING` (padrão e para que serve). Sem mudança de comportamento.

## [0.11.0] - 2026-10-14

### Adicionado

- `deploy.sh` (Task 15.3): deploy no servidor interno com `bash deploy.sh`, na pasta do submódulo. A ordem é `git pull --ff-only`, `yarn install` (com `--frozen-lockfile` quando o `yarn.lock` é versionado) e `yarn test`. Se os testes falham, o deploy aborta com código 1 antes de chamar o PM2, e o processo em execução fica como estava. Com a suíte verde, roda `pm2 reload ecosystem.config.cjs --update-env` (ou `pm2 start` na primeira vez) e confere o `GET http://127.0.0.1:3501/ping` com tentativas. Só depois disso grava a lista do PM2 (`pm2 save`). O corpo fica numa função, então o `git pull` pode reescrever o próprio script sem quebrar a execução. O script não lê o `.env`, não imprime segredo e não apaga `sessoes-baileys/`.
- `tests/deploy.test.js`: roda o `deploy.sh` de verdade com bash, numa pasta temporária, com stubs de `git`, `yarn`, `pm2`, `curl` e `sleep`. No Windows usa o bash do Git e, sem bash, pula com aviso.
- `tests/ecosystem.config.test.js`: confere o app único em fork, a porta 3501 igual à do `.env.example` e o `kill_timeout` acima do teto do desligamento gracioso.
- `instanciaManager.listarStatus()`: status de cada equipe (as instâncias do processo e as pareadas sem instância, como DESCONECTADO), só com código, status e desde quando.
- `.gitattributes`: `*.sh` sempre com LF, mesmo com `core.autocrlf` no Windows.

### Alterado

- `GET /ping` passa de `200 ok` (texto) para JSON `{ status, versao, encerrando, equipes: [{ cod_equipe, status, desde? }] }`. A rota continua sem token, para o PM2, o `deploy.sh` e o monitor consultarem na rede interna, e por isso não leva JID, telefone, LID, nome do número, QR, texto de erro nem hash_empresa. Durante o desligamento gracioso responde 503 com `status: "encerrando"`, `encerrando: true` e `Retry-After: 10`. Uma falha ao ler o status das equipes não derruba o ping, que responde com as equipes vazias. O `GET /health` não mudou.
- `ecosystem.config.cjs` final: `cwd` na pasta do projeto, `watch: false`, `autorestart` com `max_restarts: 10`, `min_uptime: 10000` e `restart_delay: 5000`, `listen_timeout: 10000` e `SERVER_PORT: "3501"` no `env`. O `--env-file` não sobrescreve variável que já existe, então sob o PM2 a porta é sempre 3501. Continuam `instances: 1`, `exec_mode: "fork"` e `kill_timeout: 12000`.
- `src/index.js` exporta `MS_TETO_ENCERRAMENTO` (10 s), usado pelo teste do ecosystem.

## [0.10.0] - 2026-10-14

### Adicionado

- `src/whatsapp/tmpMidia.js`: pasta temporária dedicada (`.cache/tmp-midia`) para o upload de mídia do Baileys. Trata da exceção 14b, aceita pelo responsável do projeto em 2026-10-14: o Baileys grava um temporário cifrado durante o upload de mídia, e a recepção e o restante do pipeline continuam sem disco. No boot, o `os.tmpdir()` do processo passa a apontar para essa pasta (TMPDIR/TMP/TEMP), e o que sobrou de uma execução anterior é apagado. O módulo também traz um rastreador dos uploads em andamento: 1 s depois que o último termina, a pasta é varrida. Isso cobre o órfão de uma corrida do Baileys 6.7.24, em que o `encryptedStream` não espera o arquivo abrir e, quando o upload falha na hora, o `unlink` dá ENOENT e o arquivo é criado logo depois. A limpeza só aceita a pasta dedicada e nunca toca no temporário do sistema.

### Alterado

- `src/whatsapp/envio.js`: o envio de imagem, vídeo, áudio e documento passa `mediaUploadTimeoutMs` (o mesmo prazo do envio, `ENVIO_PRAZO_MS`) ao `sendMessage`. Sem ele, o axios do Baileys não tem prazo, e um upload travado deixava o temporário em disco para sempre. O envio de mídia também entra no rastreador de uploads e só sai quando o `sendMessage` termina de fato, mesmo que isso aconteça depois do 504. O comentário do módulo registra a exceção.
- `src/index.js`: o boot configura a pasta temporária dedicada antes de reconectar as instâncias. O desligamento gracioso apaga os temporários de mídia depois de encerrar as instâncias e antes de fechar o HTTP, e também quando o teto força a saída. Uma falha nessa limpeza só vai para o log.
- `CLAUDE.md`: nova seção "Exceções aceitas", que explica o temporário cifrado do upload de mídia, o que pode sobrar em disco e a mitigação.

## [0.9.0] - 2026-10-14

### Adicionado

- `src/whatsapp/recuperacao.js`: decide o que entra quando o Baileys entrega na reconexão as mensagens que chegaram com a equipe fora do ar (fila offline, `messages.upsert` com `type: "append"`). Esses lotes passam pelo mesmo pipeline do `notify`: normalização, eco/aparelho, LID, mídia, registro e transcrição. A deduplicação local é feita por `(cod_equipe, mensagem_wa_id)`, em memória, com TTL de 6 h e teto de 5000. A mensagem só é marcada depois que o back a registrou, então uma falha no back deixa a reentrega tentar de novo, e uma mensagem repetida não baixa nem transcreve a mídia outra vez. O `append` só entra a partir da última atividade conhecida da instância, com folga de 10 min. Sem atividade conhecida, entra o que estiver dentro de `RECUPERACAO_JANELA_MS` (padrão 72 h). O `notify` nunca é cortado. A última atividade de cada equipe fica em `.cache/atividade-wa.json`, só com o instante, sem dado de mensagem. Ela é gravada a cada 60 s no máximo e sempre na queda e no desligamento, então sobrevive ao reinício.
- `src/whatsapp/cacheEnviadas.js`: guarda em memória (TTL de 1 h, teto de 500) o `message` de cada envio do CRM para o `getMessage` do Baileys, que atende o pedido de reenvio quando o aparelho mostra "Aguardando mensagem". O pedido só é atendido para o destino do envio: o chat ou, na conversa privada, o outro JID do mesmo contato (LID ↔ telefone). Sem a mensagem no cache, a resposta é `undefined`, nunca `{ conversation: "" }`.
- `src/utils/desligamento.js`: estado de desligamento do processo. Depois do sinal, `POST /equipe/:cod_equipe/enviar`, `/reagir` e `/conectar` respondem 503 `{ msg: "Serviço de WhatsApp reiniciando. Tente novamente em instantes." }` com `Retry-After: 10`, então nenhum pedido é aceito e descartado em silêncio. As requisições que já tinham entrado são acompanhadas até responderem.
- `.env.example`: `ENVIO_PRAZO_MS` e `RECUPERACAO_JANELA_MS`.

### Alterado

- `src/index.js`: o desligamento gracioso (SIGTERM/SIGINT) marca o processo como encerrando já no sinal, espera os envios em andamento responderem, encerra as instâncias e fecha o HTTP, tudo dentro do teto de 10 s.
- `src/whatsapp/BaileysAdapter.js`: as gravações de credenciais (`saveCreds`) passam a ser feitas em série e acompanhadas. O `pararSocket` fecha o socket sem logout, grava a última atividade, espera a gravação de credenciais em andamento e depois a fila de entrada, porque uma mensagem que o Baileys já confirmou ao WhatsApp não volta se não for registrada. A sessão fica intacta para reconectar sem QR. O socket passa a ter `shouldSyncHistoryMessage: () => false`, então o histórico do pareamento nunca é baixado e não inunda o back, e `getMessage` usa o cache de reenvio. Novo `guardarEnviada(id, message, chatJid)`.
- `src/whatsapp/envio.js`: o `sendMessage` tem prazo (`ENVIO_PRAZO_MS`, padrão 90 s, abaixo dos 120 s do back). Quando o prazo passa, o envio responde 504 `{ msg: "Envio não confirmado." }`, porque a mensagem pode ter saído. O `message` enviado vai para o cache de reenvio, mesmo quando o `sendMessage` termina depois do prazo. A reação tem prazo de 10 s, abaixo dos 15 s do back.
- `src/whatsapp/instanciaManager.js`: um armazém de atividade em arquivo (`atividade-wa.json`, ao lado do registro de pareadas) é compartilhado pelos adapters.

## [0.8.0] - 2026-10-14

### Adicionado

- `src/whatsapp/envio.js`: `enviar(codEquipe, { hash_empresa, chat_jid, conteudo, citacao, mencoes })` envia uma mensagem do atendente ao cliente. O conteúdo vira o do Baileys campo a campo: texto vira `{ text }`, imagem e vídeo viram `{ image | video, mimetype, caption, jpegThumbnail: null }`, a nota de voz vira `{ audio, mimetype: "audio/ogg; codecs=opus", ptt: true, seconds }` com a duração real do Ogg/Opus, outro áudio vai com `ptt: false` e `seconds` sempre preenchido, e PDF/Office vira `{ document, mimetype, fileName, caption }` com o nome saneado e a extensão do tipo. A citação vira `quoted` com a `key` e o `message` originais guardados pelo back (os Buffers serializados voltam a ser Buffer), e só vale para uma mensagem da mesma conversa. As menções vão em `mentions`. O id é gerado com `generateMessageIDV2` e marcado no cache de eco ANTES do `sendMessage`, que recebe `messageId`. O sucesso já devolve `status: "ENVIADA"`, porque o Baileys não emite SERVER_ACK para o envio do próprio socket. Nada é gravado em disco pelo pipeline (sem miniatura nem medição de duração).
- `src/whatsapp/reacao.js`: `reagir(codEquipe, chat_jid, key, emoji, hashEmpresa)` envia `{ react: { text, key } }` no chat da mensagem alvo. O emoji vazio remove a reação, e o id da reação também entra no cache de eco.
- `src/http/EnvioController.js`: `POST /equipe/:cod_equipe/enviar` (multipart/form-data, arquivo no campo `midia`) e `POST /equipe/:cod_equipe/reagir` (JSON), com o token de serviço conferido antes de ler o corpo. O contrato é uma allowlist do conteúdo destinado ao cliente: qualquer outro campo (`transcricao`, `nota_interna`, `explicacao` ou outro) responde 400 sem chamar o Baileys, e também um campo que não se aplica ao tipo ou que vem repetido. O arquivo é lido só em memória e validado pelo conteúdo (magic bytes) e pelo teto `MIDIA_TETO_BYTES`. Um conteúdo que não bate com o tipo responde 400. Uma equipe de outra empresa responde 404, uma equipe desconectada ou sem instância responde 409 (nunca 200), e uma falha no `sendMessage` responde 502 com mensagem genérica. Sempre uma mensagem por requisição.
- `src/whatsapp/recibos.js`: `adiarRecibos(id)` retém os recibos de um envio do CRM por `RECIBO_ATRASO_ENVIO_MS` (padrão 3000 ms, 0 desliga), porque o back só grava a mensagem enviada depois da resposta do envio. Ao fim da retenção, os recibos saem na ordem em que chegaram, pela fila serial da equipe e pela regra de "só avança". O logout descarta os recibos retidos.

### Alterado

- `src/whatsapp/BaileysAdapter.js`: `marcarEnviadaPeloCrm(id)` passa a reter também os recibos do id, e o novo `socketConectado()` devolve o socket só com a equipe `CONECTADO`.

## [0.7.0] - 2026-10-14

### Adicionado

- `src/whatsapp/recibos.js`: os recibos do Baileys (`messages.update` na conversa privada e `message-receipt.update` no grupo) viram o status da mensagem enviada pela equipe: `SERVER_ACK` vira `ENVIADA`, `DELIVERY_ACK` vira `ENTREGUE`, e `READ` ou `PLAYED` viram `LIDA`. `ERROR` e `PENDING` são ignorados. No grupo, `receiptTimestamp` vira `ENTREGUE`, e `readTimestamp` ou `playedTimestamp` viram `LIDA`. Só mensagens `fromMe` têm status, e o recibo de outro aparelho da própria equipe é ignorado. Vale o maior status recebido: no grupo, a mensagem fica `LIDA` quando o primeiro participante lê, e o status nunca regride. Um update sem id ou sem status mapeável não chama o back, e uma falha do back só vai para o log.
- `src/services/mensagemStatusInternoClient.js`: `registrarStatusMensagem(mensagem_wa_id, status, contexto)` envia `POST /interno/mensagem-status` com `{ hash_empresa, cod_equipe, mensagem_wa_id, status }`. Para um id que ele não conhece, o back responde 200 sem efeito.
- `src/whatsapp/presenca.js`: o "digitando..." do cliente sai do `presence.update`. `composing` vira `DIGITANDO`, `recording` vira `GRAVANDO`, e `paused`, `available` ou `unavailable` viram `PARADO`. Só a presença da outra ponta é enviada, e só quando o estado muda. A presença do chat é inscrita (`presenceSubscribe`) na primeira mensagem dele, uma vez por chat e por socket.
- `src/services/presencaInternoClient.js`: `registrarPresenca({ chat_jid, participante_jid, estado }, contexto)` envia `POST /interno/presenca`, com `participante_jid` `null` na conversa privada. Até a rota existir no back (Task 7.1), a chamada falha e só vai para o log.
- `src/whatsapp/nomeGrupo.js`: guarda em cache o subject do grupo (`groupMetadata`, TTL de 1 h, prazo de 2 s, uma consulta por grupo mesmo com mensagens simultâneas). O `groups.update` atualiza o cache. Uma falha fica em cache por 60 s e nunca rejeita.
- `src/whatsapp/instanciaHealth.js`: heartbeat a cada 60 s para cada equipe do registro de pareadas. Uma equipe com instância em memória reporta o status atual. Uma equipe sem instância reporta `DESCONECTADO` e só reconecta se houver sessão salva, sem gerar QR à toa. As rodadas nunca se sobrepõem.
- `src/whatsapp/instanciaManager.js`: `listarRegistradas()` e `temSessaoSalva(codEquipe)`.

### Alterado

- `src/whatsapp/BaileysAdapter.js`: passa a escutar `messages.update`, `message-receipt.update`, `presence.update` e `groups.update`. Os recibos entram na mesma fila serial da entrada, então o status nunca chega ao back antes do registro da mensagem. A mensagem de grupo vai a `/interno/mensagem-recebida` com `nome_chat` (o subject do grupo). Quando o subject falha, ela vai sem esse campo, e a mensagem privada nunca leva `nome_chat`.
- `src/index.js`: o heartbeat começa depois da reconexão do boot e para antes de as instâncias serem encerradas no desligamento gracioso.

## [0.6.0] - 2026-10-14

### Adicionado

- `src/audio/transcricaoService.js`: `transcrever(buffer, mimetype, { duracaoSegundos })` transcreve o áudio pela MiniMax ASR (`POST /v1/speech_to_text`, modelo `asr-1.0`, idioma pt), no padrão já usado em produção no comandax e no financeiro. Nunca rejeita: devolve `{ texto }` ou `{ erro, transitorio }`. OGG/Opus, MP3 e AAC vão direto. MP4, 3GP, QuickTime e M4A são convertidos (a MiniMax não aceita contêiner de vídeo) e vão como `audio/aac`. AMR, que a MiniMax não aceita, falha sem chamar a API. Áudio acima dos limites da API (50 MB ou 500 s), vazio ou sem `MINIMAX_API_KEY` também não chega a ser enviado. 429, 5xx, prazo esgotado e falha de rede são falhas transitórias. As demais são definitivas. A chave e o corpo da resposta nunca vão para o log.
- `src/audio/trilhaVideo.js`: `extrairTrilhaAudio(bufferVideo)` extrai em memória a trilha AAC de um vídeo (ou M4A) e a devolve em ADTS (`audio/aac`), sem ffmpeg, sem processo externo e sem disco. Funciona com o `moov` no fim do arquivo (MP4 sem "faststart"), com `co64`, com descritores de tamanho estendido e com QuickTime (`esds` dentro de `wave`). Um vídeo sem áudio, uma trilha em outro codec ou um contêiner truncado geram erro com código.
- `src/audio/filaTranscricao.js`: uma fila de concorrência 1 para o processo todo, porque a MiniMax limita as conexões por chave (6 áudios em paralelo derrubaram 5 com 429 no comandax). Uma falha transitória ganha uma nova tentativa, depois de 2 s e ainda na mesma vez da fila. O resultado vai ao back como `CONCLUIDA`, `PENDENTE` (falha transitória que persistiu, ou chave não configurada) ou `FALHOU` (erro definitivo). A fila nunca rejeita, e uma falha no back só gera log.
- `src/services/transcricaoInternoClient.js`: `registrarTranscricao(mensagem_wa_id, { status, texto }, { hash_empresa, cod_equipe })` envia `POST /interno/transcricao` com `{ hash_empresa, cod_equipe, mensagem_wa_id, status, texto }`. `texto` só vai preenchido em `CONCLUIDA`.

### Alterado

- `src/whatsapp/BaileysAdapter.js`: um áudio ou vídeo registrado, com a mídia aceita, entra na fila de transcrição sem bloquear a fila de entrada da equipe. Uma falha na transcrição não desfaz nem impede o registro da mensagem.

## [0.5.0] - 2026-10-14

### Adicionado

- `src/whatsapp/tipoMidia.js`: `detectarTipoPorConteudo(buffer)` identifica o tipo pelo conteúdo (magic bytes), nunca pela extensão. Reconhece JPEG, PNG, WebP (inclusive figurinha), GIF, PDF, OGG/Opus, MP3, AAC, AMR, MP4/M4A, 3GP, QuickTime, DOCX e XLSX (pelo diretório central do ZIP, então um ZIP comum não passa) e DOC e XLS (OLE). `validarMidia(buffer, mimetypeDeclarado, tetoBytes)` recusa buffer vazio, arquivo acima do teto, tipo não reconhecido e conteúdo que não bate com o tipo declarado. Sem tipo declarado, ou com `application/octet-stream`, vale o tipo detectado. `duracaoOggOpusSegundos` lê a duração real do áudio.
- `src/whatsapp/midiaEntrada.js`: `baixarMidia(sock, waMessage, { tetoBytes, prazoMs })` baixa a mídia em stream e só em memória, com `reuploadRequest` para mídia expirada. Ao passar do teto, o stream é destruído e o resto não é baixado. O prazo cobre a obtenção e a leitura do stream. `obterMidiaValidada` junta download e validação e devolve o buffer com o tipo detectado, o tamanho real e a duração, ou o motivo da pendência. Um tamanho declarado acima do teto é recusado antes de qualquer download. Teto e prazo vêm de `MIDIA_TETO_BYTES` (padrão 16 MB) e `MIDIA_PRAZO_MS` (padrão 60 s).
- `src/services/midiaInternoClient.js`: `enviarMidia(mensagem_wa_id, buffer, metadados)` envia o binário ao back em `POST /interno/midia` (multipart/form-data, com os campos de texto antes do arquivo `midia`).
- `src/services/internoHttpClient.js`: `chamarRotaInternaMultipart(rota, formulario)`, com o mesmo token, prazo e tratamento de erros das chamadas JSON.
- `.env.example`: `MIDIA_TETO_BYTES` e `MIDIA_PRAZO_MS`.

### Alterado

- `src/whatsapp/BaileysAdapter.js`: uma mensagem com mídia tem o arquivo baixado e validado no recebimento. Depois a mensagem é registrada e, se a mídia foi aceita, o binário vai ao back. Se o download ou a validação falhar, a mensagem é registrada mesmo assim, com `midia_pendente: true` e o motivo. Uma falha ao enviar a mídia só gera log e a fila continua.
- `src/services/mensagemInternoClient.js`: `POST /interno/mensagem-recebida` passa a levar `midia_pendente` (padrão `false`) e `midia_motivo_pendencia` (padrão `null`).

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
