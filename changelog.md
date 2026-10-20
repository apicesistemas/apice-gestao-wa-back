# Changelog

Todas as mudanças relevantes deste projeto são documentadas aqui.
O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/).

## [0.24.0] - 2026-10-20

### Alterado

- Escuta só no endereço local (Fase 30, Task 30.3, decisão F8). Antes o `listen(porta)` sem host abria o wa-back em todas as interfaces, e o `/ping` e o `/health` (sem token) respondiam a qualquer IP da rede. Agora `src/index.js` tem `HOST_PADRAO = "127.0.0.1"`, `hostDeEscuta(env)` (`SERVER_HOST` aparado, ou o padrão quando vazio) e `iniciarServidor(porta, host = HOST_PADRAO)`. O log do boot mostra host e porta e, com `0.0.0.0` ou `::`, avisa que a rede inteira alcança o `/ping` (sem nenhum segredo na linha).
- `ecosystem.config.cjs`: `SERVER_HOST: "127.0.0.1"` fixo no `env`, como o `SERVER_PORT` (o `--env-file` não sobrescreve). `.env.example` documenta `SERVER_HOST=127.0.0.1`. O `deploy.sh` continua pingando em 127.0.0.1 (só o comentário mudou). Comentários do `HealthController` e `README` corrigidos.
- Nenhum contrato entre camadas muda. A Fase 34 não criou outro servidor ou listener: o `src/index.js` segue como o único `listen`.

### Testes

- `tests/index.test.js` (`hostDeEscuta`, aviso do `0.0.0.0` e `::`), `tests/http/health.test.js` (escuta em 127.0.0.1, /health e /ping por ele, conexão recusada pelo IPv4 não loopback, com skip quando não há outra interface), `tests/ecosystem.config.test.js` (`SERVER_HOST` igual ao `.env.example`) e `tests/http/EnvioController.test.js` (emoji de 4 bytes, incluindo tom de pele e sequência ZWJ, chega intacto ao `sendMessage`).

### Antes do deploy

- Conferir no servidor que o `WA_BACK_BASE_URL` do `.env` do back é `http://127.0.0.1:3501` (não `localhost`, que o Node pode resolver para `::1`, nem o IP da rede `192.168.1.167`). Com outro valor, o back perde o wa-back assim que este sobe. Independente do resto da Fase 30; sem SQL.

## [0.23.0] - 2026-10-19

### Adicionado

- Alerta de ligação tocando e parou (Fase 34, Task 34.6, contrato C2): `chamadaInternoClient.alertarChamada` → `POST /interno/chamada-alerta` (canal C, `X-Internal-Token`, `hash_empresa` e `cod_equipe` no corpo). Prazo técnico próprio de 3 s (`MS_PRAZO_ALERTA`, independente do `CRM_BACK_TIMEOUT_MS`) e nenhuma nova tentativa: um alerta atrasado não serve. O `chamarRotaInterna` ganha o parâmetro opcional `{ timeoutMs }` (sem efeito para quem não o passa).
- Corpo do TOCANDO: `{ chamada_wa_id, situacao: "TOCANDO", tipo_chat, chat_jid, remetente: { jid, lid, telefone, nome: null }, contato | null, video }`. Corpo do PAROU: só `{ chamada_wa_id, situacao: "PAROU" }`. Nunca nome nem `nome_chat`; quem liga só por LID vai com `lid` preenchido e `telefone` null.
- `chamadas.js` (opção `alertar`): `offer` em tempo real (`offline: false`) → TOCANDO na hora, uma vez por id; o primeiro entre `terminate`, `reject`, `accept`, `timeout` e teto → PAROU, uma vez por id, sem esperar a janela do `accept` (que só atrasa o registro). Fila por id: o PAROU espera o TOCANDO terminar (resposta, falha ou prazo). Falha do TOCANDO só vai ao log e não impede o PAROU nem o registro. `offer` offline não alerta.
- `BaileysAdapter`: o alerta NÃO passa pela `filaEntrada` (o registro final continua passando). Identidade só pelo cache (`resolvedorLid.completarIdentidade`), sem `onWhatsApp`; grupo com `groupJid` → GRUPO, sem `nome_chat`; número da equipe, status e broadcast → nada. Log só com `cod_equipe`, id, situação e o tipo/status HTTP da falha. Depois de logout, desconexão ou troca de socket (`limpar()` no `fecharSocket` e no `apagarSessaoLocal`) nenhum alerta é publicado, nem o PAROU que estava esperando o TOCANDO.
- Testes: casos de alerta em `tests/whatsapp/BaileysAdapter.chamadas.test.js` (ordem com a fila de entrada ocupada, TOCANDO lento, falha, offline, logout) e `tests/services/chamadaInternoClient.test.js` (prazo de 3 s, sem repetição).
- **Ordem de deploy: back antes do wa-back** (C2 é rota nova: `POST /interno/chamada-alerta`). Com o back antigo, a rota responde 404 e o wa-back só registra no log; o front antigo ignora `chamada_tocando` e `chamada_parou`. Sem SQL.
- Rodada de correção 1 (34.2 e 34.6): testes unitários da opção `alertar` em `tests/whatsapp/chamadas.test.js` (TOCANDO uma vez por id; PAROU no terminate sem esperar a janela do accept, no reject, no accept antes do terminate, no timeout e no teto, uma vez por id; o PAROU espera o TOCANDO pendente, inclusive quando ele falha; `limpar()` com o TOCANDO pendente descarta o PAROU, corte por `geracao`; offline e evento sem offer não alertam; falha síncrona contida). No adapter: logout pelo aparelho com a chamada tocando não publica alerta nem registro depois, e reabrir o socket (segundo `iniciar()`) deixa um único listener de `call` (o `baileysFalso` passou a contar os `ev.on` por evento em `registrosOn`) com um TOCANDO e um registro por chamada nova. O comentário de `chamadas.js` foi corrigido (o consolidador não loga; o adapter loga só `cod_equipe`, id, resultado e status) e o consolidador ganhou a opção `aoDescartar`: quando a tabela cheia (500) encerra a chamada mais antiga como ENCERRADA, o adapter loga `[CHAMADA] Equipe <cod>: tabela de chamadas abertas cheia (TABELA_CHEIA); a mais antiga foi encerrada.`, sem id.

## [0.22.0] - 2026-10-19

### Adicionado

- Registro das chamadas de voz e vídeo recebidas (Fase 34, Task 34.2, contrato C1): `chamadaInternoClient.registrarChamada` → `POST /interno/chamada` (canal C, `X-Internal-Token`, `hash_empresa` e `cod_equipe` no corpo). Uma nova tentativa só para 503, falha de rede ou prazo (espera técnica de 1 s); 400, 404 e 500 não se repetem. Corpo: `{ chamada_wa_id, origem: "CLIENTE", tipo_chat, chat_jid, remetente, contato | null, video | null, resultado, timestamp_wa, nome_chat? }`.
- Novo `src/whatsapp/chamadas.js` (`criarConsolidadorChamadas`): estado por id da chamada, só em memória, que junta os eventos `call` num registro por chamada (D9 revista após a homologação): `offer` guarda o contexto (incluindo o vídeo) e liga o teto; `ringing` é ignorado; `reject` → RECUSADA na hora, e o `terminate` seguinte não gera nada; `terminate` abre uma janela técnica de 15 s por um `accept`; `accept` na janela (ou antes) → ATENDIDA; sem `accept` → PERDIDA; `timeout`, se um dia chegar → PERDIDA; teto de 5 min (limite de protocolo, alinhado ao `CALL_OFFER` do Baileys) sem desfecho → ENCERRADA. Publica uma vez por chamada e lembra os ids publicados (TTL = teto, tamanho limitado a 500; abrir chamada com a tabela cheia encerra a mais antiga). Evento final sem `offer` (reinício) → registro com `video: null` e a identidade do `from`.
- Sempre origem CLIENTE: nenhum POST APARELHO. A chamada feita não é registrada (nenhuma fonte foi observada na homologação da 34.0; D12 pendente): evento com `from` igual ao número da equipe (JID ou LID) e o `callLogMesssage` não publicam nada. O stub `CALL_MISSED_*`, o `message.call` e o `callLogMesssage` continuam fora do `normalizarMensagem` e de `/interno/mensagem-recebida` (teste de regressão em `filtroEntrada.test.js` e no adapter).
- `BaileysAdapter`: o listener `call` chama o diagnóstico (desligado por padrão, `DIAGNOSTICO_CHAMADAS`, continua no código para repetir os cenários 5 a 8) e o consolidador. Identidade de quem liga pelo cache `resolvedorLid` e, no privado só com telefone, UM `onWhatsApp` com prazo (como na mensagem); grupo com `groupJid` → GRUPO (chat do grupo, remetente = participante, `nome_chat`), grupo sem `groupJid` → PRIVADO; status, broadcast e newsletter são ignorados; chamada `offline` só dentro da janela de recuperação (sem data válida, descarta). O registro passa pela `filaEntrada` serial. Os pendentes são descartados (`limpar()`) no fechamento do socket e no logout. Nunca `rejectCall` nem `sendMessage`. Log só com `cod_equipe`, o id, a origem, o resultado e a sequência de estados; falhas só com o nome do erro e o status HTTP (nunca telefone, JID ou LID).
- Testes: `tests/whatsapp/chamadas.test.js` (consolidador com relógio e agendador injetados), `tests/services/chamadaInternoClient.test.js`, `tests/whatsapp/BaileysAdapter.chamadas.test.js` (`baileysFalso` emitindo `call` e `messages.upsert`, com o espião `espiarSaidas`) e a regressão em `tests/whatsapp/filtroEntrada.test.js`.
- Fonte escolhida e evidência da homologação da 34.0 (2026-10-19): só a recebida (F1 da recebida). Offer → N× ringing → terminate quando ninguém atende (nunca chega `timeout`); atendida no celular: o `accept` chega DEPOIS do terminate, com `chatId` igual ao número da equipe e `video`/`grupo` desconhecidos; recusada: reject → terminate; o vídeo vem certo no `offer`; quem liga vem só por LID. Chamada feita: nenhuma fonte observada (limitação registrada no SPEC).
- **Ordem de deploy: back antes do wa-back** (C1 é rota nova: `POST /interno/chamada`, back 0.44.0). Com o back antigo a rota responde 404 e o wa-back só registra a falha no log. Sem SQL. O registro só grava no back com `chamada_registro_ativo = "S"`.

## [0.21.0] - 2026-10-19

### Adicionado

- Diagnóstico das chamadas de voz e vídeo (Fase 34, Task 34.0). **Só log, nada sai do wa-back:** nenhuma rota `/interno/*`, nenhum `sendMessage`, nenhum `rejectCall`, nenhuma resposta a quem liga. Serve para a homologação escolher a fonte da chamada feita (bloco W do PLAN: F1 evento `call` ou F2 `callLogMesssage`).
- Ativação: `DIAGNOSTICO_CHAMADAS=S` no ambiente (lido a cada evento; qualquer outro valor, ou ausente, desliga e não escreve nada). Documentado no `.env.example` (padrão `N`).
- Novo `src/whatsapp/diagnosticoChamadas.js` (`registrarFormaEventoCall`, `registrarFormaMensagem`). Uma linha `[DIAG-CHAMADA]` por evento `call` e por mensagem do `messages.upsert`, só com flags, nomes de enum e domínios (`s.whatsapp.net`, `lid`, `g.us`, `outro`, `ausente`). Nunca id, telefone, JID, LID nem nome (o teste recusa dígitos longos, `@`, id e nome).
- `BaileysAdapter`: `"call"` em `EVENTOS_SOCKET` (sai no `fecharSocket`, como os demais) com um listener que só chama o diagnóstico, e `registrarFormaMensagem` no início do `processarMensagem`, antes do `normalizarMensagem`. O registro das mensagens não muda (teste de regressão compara o registro com o diagnóstico ligado e desligado; o `callLogMesssage` continua sem virar registro). `filtroEntrada` passa a exportar `desembrulhar` (sem mudança de comportamento).
- Linha do evento `call` (um `WACallEvent`): `[DIAG-CHAMADA] evento=call status=<offer|ringing|timeout|reject|accept|terminate|outro> offline=<S|N|?> video=<S|N|?> grupo=<S|N|?> groupJid=<S|N> from_equipe=<S|N|?> from_dominio=<dom> chat_equipe=<S|N|?> chat_dominio=<dom>`. `from_equipe` e `chat_equipe` valem S quando o `from` e o `chatId` são o número da própria equipe (por telefone ou LID, sem o sufixo de dispositivo).
- Linha da mensagem (`messages.upsert`, todas as mensagens, não só chamadas; filtre pelo grep): `[DIAG-CHAMADA] evento=upsert fromMe=<S|N|?> dominio=<dom do remoteJid> participante=<dom|ausente> stub=<CALL_MISSED_VOICE|CALL_MISSED_VIDEO|CALL_MISSED_GROUP_VOICE|CALL_MISSED_GROUP_VIDEO|número|outro|ausente> embrulhada=<S|N> callLog=<S|N> call=<S|N> outcome=<CONNECTED|MISSED|FAILED|REJECTED|ACCEPTED_ELSEWHERE|ONGOING|SILENCED_BY_DND|SILENCED_UNKNOWN_CALLER|ausente|outro|-> video=<S|N|?|-> duracao=<S|N|-> campo=<nome do campo do proto, ex.: conversation, callLogMesssage, nenhum> equipe_remetente=<S|N|?>`. `outcome`, `video` e `duracao` valem `-` quando não há `callLogMesssage` (3 "s", como no WAProto); `duracao=S` quer dizer que o `durationSecs` veio presente.
- Testes: `tests/whatsapp/diagnosticoChamadas.test.js` (8) e 3 casos novos em `tests/whatsapp/BaileysAdapter.eventos.test.js` (desligado não loga, ligado loga sem efeito algum, regressão do registro, listener `call` removido no `pararSocket`). Rodada de correção 1: o espião das saídas vive em `tests/helpers/baileysFalso.js` (`espiarSaidas(socket)`: instala `sendMessage` e `rejectCall` no socket e troca o `fetch` global por um que rejeita, registrando tudo em `efeitos`; `restaurar()` no `finally`) e é usado nos três casos da 34.0, inclusive o do `callLogMesssage`, que antes não vigiava `sendMessage` nem `rejectCall`; o terceiro caso agora emite um `call` antes do `pararSocket`. Variável `comDiagnostico` (adapter sem diagnóstico) renomeada para `semDiagnostico`.
- **Ordem de deploy:** nenhum contrato novo, sem SQL e sem dependência do back. Publicar o wa-back, pôr `DIAGNOSTICO_CHAMADAS=S` no `.env` do wa-back e reiniciar o PM2 "Ápice Gestão - WA Back". Depois da coleta, voltar a `N` (ou remover a linha) e reiniciar de novo.

### Roteiro de homologação da 34.0 (número de teste, fora do CI)

Como coletar: depois de cada cenário, `pm2 logs "Ápice Gestão - WA Back" --lines 200 --nostream | grep "\[DIAG-CHAMADA\]"` (ou `grep "\[DIAG-CHAMADA\]"` no arquivo da pasta `LOGS/`). Devolver as linhas de cada cenário, na ordem, com o número do cenário. Linhas esperadas abaixo (`<dom>` = `s.whatsapp.net` ou `lid`; `*` = qualquer valor; o que decide está na última coluna). Se um cenário não gerar nenhuma linha, informe isso: também é resposta.

| # | Cenário | Linhas esperadas (formato) | O que decide |
|---|---------|----------------------------|--------------|
| 1 | Recebida e não atendida (deixar tocar até o fim) | `evento=call status=offer offline=N video=N grupo=* groupJid=N from_equipe=N from_dominio=<dom> chat_equipe=N chat_dominio=<dom>`, depois `evento=call status=timeout ...` (mesmo formato) e, talvez, `evento=upsert fromMe=N dominio=<dom> ... stub=CALL_MISSED_VOICE callLog=N ...` ou `callLog=S ... outcome=MISSED` | Confirma `offer` e `timeout` da recebida (PERDIDA) |
| 2 | Recebida e o cliente desiste antes do fim | `status=offer from_equipe=N`, depois `status=terminate` (ou `timeout`); possível `upsert ... stub=CALL_MISSED_VOICE` ou `callLog=S outcome=MISSED fromMe=N` | Qual status chega quando o cliente cancela (ENCERRADA ou PERDIDA) |
| 3 | Recebida e atendida no celular | `status=offer from_equipe=N`, possível `status=accept`, depois `status=terminate`; possível `upsert ... callLog=S ... outcome=CONNECTED` ou `ACCEPTED_ELSEWHERE` | Se o `accept` chega ao aparelho vinculado (ATENDIDA) e se o registro vem com `fromMe=N` |
| 4 | Recebida e recusada no celular | `status=offer from_equipe=N`, depois `status=reject`; possível `upsert ... callLog=S ... outcome=REJECTED` | Se o `reject` chega (RECUSADA) |
| 5 | Feita pelo celular e atendida | F1: `evento=call status=offer ... from_equipe=S chat_equipe=N` e `status=accept`. F2: `evento=upsert fromMe=S dominio=<dom> ... callLog=S call=N outcome=CONNECTED video=N duracao=S ...` | **F2 se aparecer `upsert fromMe=S callLog=S`; F1 se só houver `call` com `from_equipe=S`; nenhuma das duas = limitação** |
| 6 | Feita pelo celular e não atendida (deixar tocar) | F1: `evento=call ... from_equipe=S ... status=timeout`. F2: `evento=upsert fromMe=S ... callLog=S ... outcome=MISSED` (ou `FAILED`) `duracao=N` | Como a não atendida aparece (NAO_ATENDIDA) |
| 7 | Feita e cancelada antes de atender | F1: `evento=call status=terminate ... from_equipe=S`. F2: `evento=upsert fromMe=S ... callLog=S ... outcome=MISSED`, `REJECTED` ou `FAILED` | Como o cancelamento aparece (ENCERRADA ou NAO_ATENDIDA) |
| 8 | Feita pelo WhatsApp Desktop | As mesmas linhas do cenário 5 (F1: `from_equipe=S`; F2: `fromMe=S callLog=S`) | **Se a chamada do Desktop também chega ao número vinculado do wa-back** |
| 9 | Vídeo nos dois sentidos (uma recebida e uma feita) | Recebida: `evento=call status=offer ... video=S ...`. Feita: `video=S` no `call` (F1) ou `callLog=S ... video=S` (F2) | Se o `isVideo` vem correto nas duas pontas |
| 10 | Chamada num grupo da equipe (recebida e, se possível, feita) | `evento=call status=offer ... grupo=S groupJid=S from_equipe=N from_dominio=<dom> chat_equipe=N chat_dominio=g.us`; possível `evento=upsert ... dominio=g.us participante=<dom> ... stub=CALL_MISSED_GROUP_VOICE` ou `callLog=S` | Domínio do grupo e se o participante vem identificado (D8) |
| 11 | Reiniciar o wa-back (`pm2 restart`) no meio de uma chamada recebida tocando | Depois do boot: `evento=call status=offer offline=S ...`, ou só `evento=upsert fromMe=N ... stub=CALL_MISSED_VOICE` / `callLog=S`, ou nenhuma linha | Se a chamada perdida durante a queda chega como `offline=S` ou como registro de mensagem (`append`) |

Instruções no servidor (192.168.1.167):

1. Ligar: editar o `.env` do wa-back e acrescentar `DIAGNOSTICO_CHAMADAS=S`; depois `pm2 restart "Ápice Gestão - WA Back" --update-env`. Conferir com `pm2 logs "Ápice Gestão - WA Back" --lines 50 --nostream` que o processo voltou e a equipe reconectou sem QR.
2. Executar os 11 cenários com o número de teste. Para cada um, esperar uns 30 s e coletar com o `grep` acima (as linhas dos cenários anteriores ficam no log: anote o horário de cada cenário).
3. Desligar: trocar para `DIAGNOSTICO_CHAMADAS=N` (ou remover a linha) e reiniciar o PM2 como no passo 1. Conferir que uma mensagem de teste não gera mais nenhuma linha `[DIAG-CHAMADA]`.
4. Com as linhas em mãos, aplicar a tabela do bloco W do PLAN (F2, F1 ou limitação) e registrar o resultado neste changelog antes de iniciar a Task 34.2.

## [0.20.0] - 2026-10-18

### Adicionado

- Identificação do participante do grupo para a conversa privada (Fase 32, Task 32.1, contrato D1): `POST /equipe/:cod_equipe/grupo/participante/contato` (canal D, `exigirTokenServico` + `recusarDuranteEncerramento`, SEM `travaGrupo`: não altera o grupo). Corpo (allowlist; chave desconhecida, inclusive `transcricao`, `nota_interna` e `explicacao`, responde 400 sem tocar no Baileys): `{ hash_empresa, chat_jid (/^[\d-]{1,40}@g\.us$/), participante_jid (/^(\d{1,25}@lid|\d{8,15}@s\.whatsapp\.net)$/) }`. Responde 200 `{ jid_privado, lid, telefone }`. Erros: 400, 400 `{ msg: "Não é possível iniciar conversa com o número da própria equipe.", codigo: "PROPRIO_NUMERO" }`, 401, 404 "Equipe não encontrada." / "Grupo não encontrado." (número da equipe fora do grupo), 409 `{ msg, codigo }` com `DESCONECTADA`, `FORA_DO_GRUPO` ("Participante não encontrado no grupo.") ou `SEM_WHATSAPP` ("Este número não tem WhatsApp."), 502, 503 + `Retry-After`, 504 "A consulta do participante não respondeu." e 500 sem vazar o erro.
- Fluxo: participantes pelo cache do `nomeGrupo` → participante achado por jid, LID ou telefone (o número da equipe é PROPRIO_NUMERO, também quando o par do LID resolve para o telefone da equipe) → telefone = o do grupo ou o par do `resolvedorLid`; com telefone, UM `onWhatsApp` (prazo técnico de 15 s): o `jid_privado` é o jid DEVOLVIDO (9º dígito), nunca o digitado, o `lid` é o do participante ou o da consulta e o par é aprendido; sem telefone, `jid_privado` é o LID e `telefone` é null, sem consulta. Nenhum `sendMessage` e nenhuma chamada a `/interno/*`.
- `grupoGestao.resolverContatoParticipante` e `acharParticipante`; `ErroGrupo` ganha `FORA_DO_GRUPO`, `SEM_WHATSAPP` e `PROPRIO_NUMERO`. `BaileysAdapter.resolverContatoParticipante(chatJid, participanteJid)` (a fachada do grupo expõe `telefoneDoLid` e `aprenderPar`).
- Miniatura da foto de perfil (Fase 32, Task 32.1, contrato D2): `POST /equipe/:cod_equipe/foto-perfil` (canal D, `exigirTokenServico` + `recusarDuranteEncerramento`). Corpo (allowlist; mesma recusa de campo interno): `{ hash_empresa, jid (/^(\d{1,25}@lid|\d{8,15}@s\.whatsapp\.net|[\d-]{1,40}@g\.us)$/), grupo_jid? (/^[\d-]{1,40}@g\.us$/; `null` é 400) }`. Responde 200 `{ situacao: "SEM_FOTO" }` ou `{ situacao: "COM_FOTO", mimetype, conteudo_base64 }`. Erros: 400, 401, 404 "Equipe não encontrada.", 409 `{ msg, codigo }` com `DESCONECTADA` ou `FORA_DO_GRUPO`, 429 `{ msg: "O WhatsApp limitou as consultas. Tente mais tarde.", codigo: "LIMITE_WHATSAPP" }`, 502 "Não foi possível consultar a foto.", 503 + `Retry-After`, 504 "A consulta da foto não respondeu." e 500 sem vazar o erro.
- Fluxo: com `grupo_jid`, o `jid` precisa estar nos participantes do grupo (cache do `nomeGrupo`; fora dele 409 FORA_DO_GRUPO, sem IQ) → `profilePictureUrl(jid, "preview", prazo)` → sem URL ou Boom com `data` 401 (privacidade) / 404 (sem foto) → SEM_FOTO; `rate-overlimit` (`data` 429) → 429 → a URL só é seguida se for https, de host terminado em `.whatsapp.net`, sem porta nem credencial; `fetch` com `redirect: "error"`, prazo técnico de 10 s (IQ e download, cada um) e teto técnico de 100 KB (por `Content-Length` e pelo que chega; o stream é encerrado ao passar do teto) → tipo detectado pelo CONTEÚDO (JPEG, PNG ou WebP; senão SEM_FOTO). Redirecionamento, host fora da lista, http, status 4xx do CDN, acima do teto ou conteúdo que não é imagem → SEM_FOTO; 429 do CDN → LIMITE_WHATSAPP; 5xx ou rede → 502.
- Novo `src/whatsapp/fotoPerfil.js` (`obterPreview`, `urlPermitida`, `ErroFoto`) e `BaileysAdapter.obterFotoPerfil(jid, { grupoJid })`. Nada em disco, nenhum cache de imagem no wa-back e nenhum log com URL do CDN, JID ou LID (só `cod_equipe` e código).
- Testes: `tests/whatsapp/fotoPerfil.test.js`, `tests/http/FotoPerfilController.test.js`, `tests/http/GrupoController.contato.test.js` e casos de `resolverContatoParticipante` em `tests/whatsapp/grupoGestao.test.js`; `baileysFalso` ganha `criarFotoFalsa` e `erroBoomFalso`.
- Rodada de correção 1: `grupo_jid: null` na D2 passa a ser 400 (allowlist estrita, como na D1). Os testes dos dois controllers contam as chamadas dos stubs `reportarStatus` e `registrarMensagem` e espiam qualquer `fetch` que não seja para o servidor de teste (inclui http para o back); o `afterEach` de todos os testes, de sucesso e de erro, confere que `sendMessage`, `groupParticipantsUpdate`, `groupCreate`, o registro de mensagem, o status ao back e as chamadas a `/interno/*` ficam zerados. Teste do `fetch` real contra um servidor http local que responde 302 confirma que `foiRedirecionamento` reconhece o erro do Node 22 (e não confunde com falha de rede).
- **Ordem de deploy: wa-back antes do back** (duas rotas D novas, sem SQL). Com o wa-back antigo, o back recebe 404 nestas rotas: a mensagem privada responde 409 "indisponível" e a foto responde 204 (o front mostra as iniciais).

## [0.19.0] - 2026-10-18

### Adicionado

- Criação de grupo de WhatsApp pelo número da equipe (Fase 29, Task 29.1, contrato D2): `POST /equipe/:cod_equipe/grupo/criar` (canal D, `exigirTokenServico` + `recusarDuranteEncerramento`, a mesma `travaGrupo` da adição). Corpo (allowlist; chave desconhecida, inclusive `transcricao`, `nota_interna`, `explicacao` e `chat_jid`, responde 400 sem tocar no Baileys): `{ hash_empresa, nome_grupo (1 a 100 caracteres, aparado), telefones (/^55\d{10,11}$/, 1..50), segundos_intervalo (inteiro >= 0), convite?: { texto (1..500) } }`. Responde 200 `{ chat_jid, nome_grupo, participantes: [{ telefone, status, convite_enviado }] }`. Erros: 400, 401, 404 "Equipe não encontrada.", 409 `{ msg, codigo }` com `DESCONECTADA`, `OCUPADA` ou `SEM_PARTICIPANTE_VALIDO` (esta com `participantes` e a `msg` "Nenhum dos telefones informados tem WhatsApp. O grupo não foi criado."), 502, 503 + `Retry-After`, 504 "Criação do grupo não confirmada." e 500 sem vazar o erro.
- Fluxo: `onWhatsApp` em série até o 1º número com WhatsApp (nenhum: 409, sem criar) → `groupCreate` UMA vez, com o nome e esse único jid (o Baileys 6.7.24 não devolve status por participante), com prazo técnico de 30 s; erro, prazo ou resposta sem id de grupo → 504, sem nova tentativa → o nome entra no cache (`aprender`, de novo no fim) → `groupMetadata` confere o 1º (ADICIONADO, ou CONVITE_NECESSARIO sem convite) → pausa e os demais pelo `adicionarEmSerie` da Fase 28 (mesmo ritmo, aborto, 429 e convite).
- Depois do `groupCreate` bem-sucedido a resposta é sempre 200, com o `chat_jid`: falha do `groupMetadata` (1º FALHA, restante NAO_PROCESSADO), falha do `add`, desligamento, desconectar, remover e o back fechando a conexão só mudam os status. Abortar ANTES de criar não cria nada e responde 409 DESCONECTADA.
- `grupoGestao.criarGrupo`, `BaileysAdapter.criarGrupo` e `ErroGrupo` com `CRIACAO_NAO_CONFIRMADA` e `SEM_PARTICIPANTE_VALIDO`. No `GrupoController`, a adição e a criação passam pela mesma rotina (trava, aborto se o back desistir, tabela de erros).
- Nome do grupo: `nome.trim().length` de 1 a 100 (UTF-16). Nome com quebra de linha ou caractere de controle (`/[\u0000-\u001F\u007F]/`) e nome que fica vazio depois de remover os espaços invisíveis (U+200B a U+200D e U+FEFF) e aparar são recusados. Vazio, longo e inválido respondem 400 com o mesmo texto, igual ao do back e do front: "Informe o nome do grupo com até 100 caracteres, sem quebra de linha.".
- Desligamento gracioso ANTES do `groupCreate` (nada criado): 503 + `Retry-After`, como o `recusarDuranteEncerramento`. Desconectar e remover antes de criar continuam 409 DESCONECTADA.
- Quando o `groupMetadata` de confirmação falha, o 1º participante fica FALHA (não há como saber se entrou). O restante tende a sair NAO_PROCESSADO, porque a falha fica em cache por 60 s; o grupo existe e os demais podem ser adicionados depois pela adição (Fase 28). O retorno do `groupCreate` do Baileys 6.7.24 traz `participants` (`extractGroupMetadata`, `lib/Socket/groups.js`), mas montado dos nós `participant` da resposta sem olhar o atributo `error`, então não foi usado para confirmar o 1º: um convidado recusado poderia aparecer como adicionado. A confirmação segue pelo `groupMetadata`.
- Nenhum log com telefone, JID, LID nem nome do grupo (só `cod_equipe`, contagens e códigos).
- Testes: `tests/http/GrupoController.criar.test.js` e casos de `criarGrupo` em `tests/whatsapp/grupoGestao.test.js`; `baileysFalso.criarGrupoFalso` ganha `groupCreate`.
- **Ordem de deploy: wa-back antes do back** (rota D nova, sem SQL). Com o wa-back antigo, o back recebe 404 nesta rota e responde 409 de WhatsApp indisponível.

## [0.18.0] - 2026-10-18

### Adicionado

- Adição de participantes a um grupo da equipe (Fase 28, Task 28.1, contrato D1): `POST /equipe/:cod_equipe/grupo/participantes/adicionar` (canal D, `exigirTokenServico` + `recusarDuranteEncerramento`). Corpo (allowlist; chave desconhecida, inclusive `transcricao`, `nota_interna` e `explicacao`, responde 400 sem tocar no Baileys): `{ hash_empresa, chat_jid, telefones (/^55\d{10,11}$/, 1..50), segundos_intervalo (inteiro >= 0), convite?: { texto (1..500) } }`. Responde 200 `{ participantes: [{ telefone, status, convite_enviado }] }` na ordem da entrada, com `status` em ADICIONADO, JA_PARTICIPA, CONVITE_NECESSARIO, SAIU_RECENTEMENTE, SEM_WHATSAPP, FALHA ou NAO_PROCESSADO. Erros: 400, 401, 404 "Equipe não encontrada." / "Grupo não encontrado.", 409 `{ msg, codigo }` com `DESCONECTADA`, `NAO_ADMIN` ou `OCUPADA`, 502, 503 + `Retry-After`, 504 "A consulta dos participantes não respondeu." e 500 sem vazar o erro. Nenhum efeito no CRM; o log leva só `cod_equipe`, contagens e códigos.
- `src/whatsapp/grupoGestao.js`: `consultarNumero` (`onWhatsApp` de um telefone por vez, prazo técnico de 15 s; o `add` usa o jid devolvido, nunca o digitado), `mapearStatusAdicao` (200/403/408/409/outro; o `add_request` `code`/`expiration` é lido de forma defensiva no `content`), `adicionarEmSerie` (um IQ por telefone, `dormir(segundos_intervalo)` depois de cada telefone com IQ, abortável, resposta na ordem da entrada; 429 do WhatsApp para o laço) e `enviarConviteV4` (convite nativo `groupInvite` em mensagem privada, só no 403 com `add_request` e só com `convite` no corpo; o id é marcado como enviado pelo CRM antes do `sendMessage`, então o eco não vira `/interno/mensagem-recebida`).
- `src/whatsapp/travaGrupo.js`: uma operação de grupo por `cod_equipe`, com `AbortController`, separada do `comTrava` do `instanciaManager` (`entrar`, `sair`, `abortar`, `abortarTodas`, `ocupada`).
- `nomeGrupo`: guarda o `memberAddMode` do grupo e expõe `podeAdicionar(socket, jid, proprio)` (admin ou `memberAddMode`; equipe fora do grupo vira 404). O `BaileysAdapter` ganha `adicionarParticipantesGrupo(chatJid, opcoes)` e esquece o cache do grupo no fim da operação.
- `instanciaManager`: `desconectar` e `remover` chamam `travaGrupo.abortar(cod)` antes do logout (o restante sai NAO_PROCESSADO e a chamada seguinte recebe 409 DESCONECTADA, nunca OCUPADA); com `equipeOcupada(cod)` a operação não começa (409 OCUPADA). O desligamento gracioso (`desligamento.aoIniciarEncerramento`) também aborta as operações de grupo, então a resposta cabe no teto de encerramento.
- Mensagem de sistema de participante (`messageStubType` 27 a 32, como `GROUP_PARTICIPANT_ADD`) não gera registro e invalida o cache dos participantes do grupo.
- Testes: `tests/whatsapp/grupoGestao.test.js`, `tests/whatsapp/travaGrupo.test.js`, `tests/http/GrupoController.adicionar.test.js`, casos em `nomeGrupo`, `desligamento`, `instanciaManager.desconectar` e `instanciaManager.remover`; `baileysFalso.criarGrupoFalso` e `conteudoComAddRequest`.
- Ritmo: **uma pausa por telefone** em que houve IQ (decisão do orquestrador). O convite sai junto com a adição daquele telefone e entra na mesma pausa, e não há pausa depois do último telefone.
- Aborto: o sinal é conferido depois da consulta `onWhatsApp` e antes do IQ de adição e do convite; o telefone abortado e o restante saem NAO_PROCESSADO. Desconectar, remover, desligamento e o back fechar a conexão antes da resposta (prazo esgotado) abortam a operação, e a trava cai no `finally`. Um IQ que já foi enviado não é cancelado: no desligamento o back recebe a conexão interrompida e trata como "não confirmada".
- Erro lançado pelo Baileys 6.7.24 (`assertNodeErrorFree`: `new Boom(texto, { data: +codigo })`, com `output.statusCode` em 500): o código é lido de `data`, depois de `output.statusCode` e por fim do texto. 429 para o laço; 403, 408 e 409 lançados no IQ de adição viram CONVITE_NECESSARIO, SAIU_RECENTEMENTE e JA_PARTICIPA.
- Prazos técnicos (constantes de rede, não regra de negócio): 15 s no `onWhatsApp`, 30 s no IQ de adição e 30 s no envio do convite.
- **Ordem de deploy: wa-back antes do back** (rota D nova). Com o wa-back antigo, o back recebe 404 nesta rota e responde 409 "WhatsApp indisponível no momento. Tente novamente.".

## [0.17.1] - 2026-10-18

### Corrigido

- `yarn typecheck` volta a passar (5 erros de tipagem): cast de `req.params.cod_equipe` no `GrupoController`, parâmetro tipado no `filter` do `nomeGrupo` e casts de teste em `instanciaManager.remover` e `nomeGrupo`. Sem mudança de comportamento e sem contrato novo para o back.

## [0.17.0] - 2026-10-18

### Adicionado

- `yarn test:cobertura`: roda a mesma suíte do `yarn test` (`scripts/run-tests.js --cobertura`) com a cobertura do Node limitada a `src/**` e mínimos sobre o total: linhas 95%, desvios 88%, funções 90%. Abaixo de qualquer um, o processo sai com código ≠ 0. O `yarn test` e o `deploy.sh` ficam iguais.
- Testes de ramos de erro e de borda: tratador de erros do `registrarControllers` (JSON malformado, resposta já iniciada, erro que não é `Error`), `internoHttpClient` (corpo ilegível, JSON inválido, prazo por ambiente, detalhe truncado, multipart), heartbeat (falhas isoladas por equipe, equipe ocupada, parada no meio da rodada) e `tipoMidia` (MP3 sem ID3, ADTS, AMR, brands ISO, ZIP/OLE adulterados ou ambíguos, Ogg truncado). O helper `arquivosMidia` passa a exportar `ole`.
- `scripts/run-tests.js` exporta `montarArgumentos`, `listarArquivosDeTeste` e `LIMITES_COBERTURA` e só roda quando executado direto; `tests/scripts/runTests.test.js` confere as flags 95/88/90, o include `src/**` e o código de saída (≠ 0 abaixo do limite, 0 acima) num projeto temporário.
- Sem mudança de comportamento em `src/` e sem contrato novo para o back. Ordem de deploy: indiferente.

## [0.16.0] - 2026-10-17

### Adicionado

- Remoção da equipe no WhatsApp (Fase 26, Task 26.5): `POST /equipe/:cod_equipe/remover` (canal D, `exigirTokenServico` + `recusarDuranteEncerramento`), corpo `{ hash_empresa }`. Responde 200 `{ msg: "Equipe removida do WhatsApp.", cod_equipe, status_conexao: "DESCONECTADO", ultimo_erro_conexao: null, havia_sessao, remocao_aparelho, instancia_descartada }`. Erros: 400 (código ou `hash_empresa` inválido), 401, 409 (outra empresa, nada é tocado), 503 com `Retry-After` no encerramento e 500 sem vazar o erro.
- `instanciaManager.remover(codEquipe, hashEmpresa)`: na mesma trava por equipe, faz o fluxo do `desconectar` (logout quando pareada, sessão em disco apagada, saída do registro de pareadas, reporte DESCONECTADO aguardado com prazo) e depois remove a atividade, a instância do Map e o `desdeStatus`. O `/ping` deixa de listar a equipe, e o heartbeat e o `reconectarTodas` não abrem socket nem geram QR. Idempotente: sem nada da equipe, `havia_sessao: false` e `instancia_descartada: false`; instância que ficou em DESCONECTADO, `havia_sessao: false` e `instancia_descartada: true`, sem logout nem reporte.
- O corpo do `desconectar` virou `desconectarSemTrava`, compartilhado com o `remover` (sem mudança de comportamento do `/desconectar`).
- Testes de regressão do `remover`: o 409 não toca em atividade, registro nem reporte (instância e só registro); o `desde` do `/ping` não é herdado ao conectar de novo; o `GET /ping` real não lista a equipe removida.
- **Ordem de deploy: wa-back antes do back** (rota D nova). Com o wa-back antigo, o back recebe 404 no `/remover` e cai no `/desconectar`.

## [0.15.0] - 2026-10-17

### Adicionado

- Marca de mensagem recuperada (Fase 24, Task 24.3): `POST /interno/mensagem-recebida` ganha `recuperada?: boolean` (aditivo). Vai `recuperada: true` somente quando o lote do `messages.upsert` é `append` e a origem é CLIENTE; em `notify` e no eco do aparelho (origem APARELHO) a chave não vai no corpo. Token (`X-Internal-Token`), `hash_empresa` e `cod_equipe` ficam intactos. O back usa a marca para não disparar o aviso de recebimento em mensagens recuperadas após reinício.
- **Ordem de deploy: back antes do wa-back** (o back trata a ausência como `false` e nunca responde 400 por causa da chave). Só ligar o aviso automático nas equipes depois deste deploy.

## [0.14.2] - 2026-10-16

### Alterado

- Documentação: proxy reverso é o Apache (Cloudflare → Apache 192.168.1.165 → 192.168.1.167). Ajuste de comentários e README, sem mudança de comportamento. Ordem de deploy: indiferente.

## [0.14.1] - 2026-10-16

### Adicionado

- Teste de contrato do envio: um `TEXTO` com campos da pesquisa de satisfação (`comentario`, `nota`, `token`, `titulo_ticket`) responde 400 sem tocar o Baileys, e o texto com o link da pesquisa segue aceito. Sem mudança de comportamento nem de contrato (a allowlist já recusava). Ordem de deploy: indiferente.

## [0.14.0] - 2026-10-16

### Adicionado

- Desconectar WhatsApp da equipe: `POST /equipe/:cod_equipe/desconectar` (token de serviço, 503 + `Retry-After` no encerramento). Entrada `{ hash_empresa }`. Saída 200 `{ msg: "WhatsApp da equipe desconectado.", cod_equipe, status_conexao: "DESCONECTADO", ultimo_erro_conexao: null, havia_sessao, remocao_aparelho: "CONFIRMADA" | "NAO_CONFIRMADA" | "SEM_PAREAMENTO" }`. Erros: 400 (código inválido ou sem `hash_empresa`), 409 (equipe de outra empresa, nada é desconectado), 500. Faz o `sock.logout()` (prazo técnico de 3 s, `end()` como reserva; espera as credenciais por até 1,5 s e o reporte por até 2,5 s, no pior caso 7 s, dentro do teto de 10 s do encerramento), apaga a sessão Baileys, tira a equipe do registro de pareadas e reporta `DESCONECTADO` sem erro por `/interno/wa/status` (canal C sem mudança), aguardando o reporte antes de liberar a trava. Sem reconexão automática depois. Idempotente: sem instância, registro nem `creds.json`, responde `havia_sessao: false` sem tocar em nada. Equipe em ERRO, sem instância ou com logout que falha ou estoura o prazo: sessão local apagada e `NAO_CONFIRMADA`.
- `instanciaManager`: `desconectar(cod, hash)`, `reconectarSePareada(cod, hash)`, `equipeOcupada(cod)` e trava por equipe que serializa conectar, desconectar e a reconexão do heartbeat (cliques simultâneos em conectar continuam abrindo um socket só).
- `BaileysAdapter`: `desconectar()`, `temSocket()` e o helper exportado `apagarSessaoEmDisco` (só o `rm` da pasta, sem listar nem ler).

### Alterado

- A reconexão do heartbeat e o `reconectarTodas` do boot usam a trava da equipe (`reconectarSePareada`): conferem o registro e o `creds.json` dentro da trava, então uma rodada que leu o registro antes de um desconectar não abre socket nem gera QR. O heartbeat pula a equipe com conectar/desconectar em andamento, e códigos de equipe inválidos rejeitam a Promise em vez de lançar de forma síncrona.
- A limpeza da sessão local (caches e `rm` da pasta) virou uma rotina comum ao logout pelo aparelho e ao desconectar voluntário, e agora espera a gravação de credenciais em andamento antes de apagar a pasta (corrige o risco de o logout pelo aparelho não esperar a fila de credenciais). A remoção feita pelo celular continua reportando "Sessão encerrada pelo aparelho.".
- O desligamento gracioso (`pararSocket`) continua sem logout.
- Ordem de deploy: rota nova do canal D, publicar o wa-back antes do back.

## [0.13.0] - 2026-10-16

### Adicionado

- GIF recebido. No WhatsApp o GIF chega como `videoMessage` (ou `ptvMessage`) com `gifPlayback: true`. `POST /interno/mensagem-recebida` ganha `midia.gif: boolean` (campo opcional para o back): `true` só nesse caso e `false` em imagem, áudio, documento, figurinha e vídeo comum. O tipo continua `VIDEO` e `POST /interno/midia` não muda.

### Alterado

- O GIF (`midia.gif === true`) não é enfileirado para transcrição (sem trilha de áudio, geraria transcrição FALHOU): nenhuma chamada a `/interno/transcricao` para ele. A mídia continua sendo baixada, validada e enviada ao back.
- Ordem de deploy: back, wa-back, front.

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
