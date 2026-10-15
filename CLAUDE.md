# apice-gestao-wa-back — Motor de conversa WhatsApp

> Runtime 24/7 do Baileys com uma instância por equipe. Recebe, normaliza e registra todas as mensagens de WhatsApp (grupos e conversas privadas, todas as mídias, inclusive as enviadas pelo aparelho), transcreve áudio e vídeo via MiniMax e envia as respostas do atendente. Assim, o histórico deixa de ficar preso ao WhatsApp Web de cada atendente.

## Stack

| Camada | Tecnologia |
| ------ | ---------- |
| Runtime | Node.js, JavaScript CommonJS com JSDoc + `// @ts-check` |
| WhatsApp | Baileys (`@whiskeysockets/baileys`, versão fixa como no comandax) |
| HTTP | Express 5 (só chamadas internas do back) |
| Transcrição | MiniMax M3 |
| Comunicação com o back | HTTP interno com token de serviço (`/interno/*`) |
| Testes | `node:test` |
| Deploy | PM2 `instances: 1` no servidor `192.168.1.167`, porta 3501 (só rede interna) |
| Gerenciador de pacotes | yarn |

## Estrutura de pastas

```
apice-gestao-wa-back/
├── src/
│   ├── index.js          # boot: TZ, Express, reconexão das instâncias, desligamento gracioso
│   ├── whatsapp/         # adapter Baileys, instanciaManager (1 instância por equipe), entrada/saída
│   ├── audio/            # transcrição MiniMax (fila de concorrência)
│   ├── http/             # controllers internos (envio, QR/conexão, health) + exigência de token
│   ├── services/         # clientes HTTP das rotas /interno/* do back
│   ├── db/               # pool MySQL (fuso -03:00), se necessário
│   └── utils/            # logs, helpers
├── tests/                # espelha src/ (*.test.js); socket Baileys mockado
├── scripts/              # run-tests.js
├── sessoes-baileys/      # credenciais da sessão pareada (ignorado, nunca ler)
├── LOGS/                 # log em arquivo (ignorado)
├── ecosystem.config.cjs  # PM2 instances: 1, fork, porta 3501, kill_timeout 12 s
├── deploy.sh             # pull → install → test → pm2 reload → /ping
├── .gitattributes        # *.sh sempre LF
├── changelog.md
├── .env.example
├── CLAUDE.md             # este arquivo
└── README.md
```

## Como rodar localmente

**Backend:**
```bash
cd apice-gestao-wa-back
yarn install
cp .env.example .env  # preencher (URL e token do back, chave MiniMax)
yarn start:dev        # nodemon → node --env-file-if-exists=.env ./src/index.js (observa só src/)
yarn test             # node scripts/run-tests.js → node --test tests/**/*.test.js
```

**Frontend:** ver `apice-gestao-front/CLAUDE.md`.

## Deploy

No servidor `192.168.1.167`, na pasta do submódulo: `bash deploy.sh`.

- **Ordem:** `git pull --ff-only` → `yarn install` (`--frozen-lockfile` quando o `yarn.lock` é versionado) → `yarn test` → `pm2 reload ecosystem.config.cjs --update-env` (`pm2 start` se o app ainda não existe no PM2) → `GET http://127.0.0.1:3501/ping` com tentativas → `pm2 save`. Qualquer falha antes do PM2 aborta com código ≠ 0 e o processo em execução não é tocado. Teste vermelho nunca chega ao reload.
- **Sessão sobrevive ao reload:** `instances: 1` + `exec_mode: "fork"` são obrigatórios (sessão do Baileys em disco, dois processos corrompem o pareamento), então o reload é stop gracioso + start. O PM2 manda SIGINT, o encerrador do `src/index.js` fecha tudo sem logout dentro do teto `MS_TETO_ENCERRAMENTO` (10 s), e o `kill_timeout` (12 s) fica acima dele. O `tests/ecosystem.config.test.js` garante isso. O boot seguinte reconecta sem QR e recupera as mensagens do intervalo.
- **Porta:** `SERVER_PORT: "3501"` no `env` do ecosystem. O `--env-file=.env` não sobrescreve variável que já existe, então sob o PM2 a porta é sempre 3501. Ela fica só na rede interna.
- **`GET /ping` (sem token):** `{ status, versao, encerrando, equipes: [{ cod_equipe, status, desde? }] }`, 200 no ar e 503 durante o desligamento. Fica aberto para o PM2, o deploy e o monitor, por isso nunca pode levar JID, telefone, LID, nome do número, QR, texto de erro nem hash_empresa.
- **Parâmetros do script (ambiente):** `DEPLOY_PORTA` (3501), `DEPLOY_TENTATIVAS_PING` (20) e `DEPLOY_INTERVALO_PING` (3 s).
- **O script nunca** lê o `.env`, imprime segredo, apaga `sessoes-baileys/`, chama `pm2 delete`/`kill` ou faz `git reset`. O corpo fica numa função, então o `git pull` pode reescrever o próprio `deploy.sh` no meio da execução.
- **Testes:** o `tests/deploy.test.js` roda o script com stubs de `git`, `yarn`, `pm2`, `curl` e `sleep`. No Windows precisa do bash do Git (`BASH_TESTE` aponta outro) e, sem bash, os casos são pulados com aviso.

## Padrões de código

- Nomenclatura de arquivos: adapters e classes em PascalCase (`BaileysAdapter.js`), demais em `camelCase.js` (`instanciaManager.js`, `transcricaoService.js`, `filtroEntrada.js`), controllers `NomeController.js`. Testes em `tests/<mesma pasta>/<arquivo>.test.js`.
- Nomenclatura de variáveis e funções: camelCase em português, sem acento. Textos em pt-BR com acentuação correta.
- Estrutura de endpoints: controllers como tabela de rotas (`NomeController(server)`, sem `express.Router()`), aceitando só chamadas do back com token de serviço. Toda escrita vai para o back via `/interno/*`, com `hash_empresa` no body.
- Estrutura de componentes: base do comandax (`instanciaManager` + adapter Baileys, adaptados para uma instância por equipe) com a robustez do financeiro: normalização pura de entrada (`filtroEntrada`), download de mídia em stream com teto e prazo, validação por *magic bytes*, envio sem disco (exceto o temporário cifrado do upload do Baileys, ver "Exceções aceitas"), LID completo e registro de mensagens do aparelho.
- Tipagem: JSDoc + `// @ts-check` nos arquivos, sem etapa de build.

## TDD

- Framework backend: `node:test`
- Framework frontend: não se aplica
- Onde ficam os testes: `tests/`, espelhando `src/`. O Baileys é mockado via `require.cache`, com payloads montados nos testes.
- Regra: cobertura mínima em %: a definir. Todo critério de aceitação do SPEC tem teste, e a task só termina com `yarn test` verde.
- Testes críticos deste projeto:
  - [ ] Cada tipo recebido (texto, foto, vídeo, áudio, documento, figurinha, localização, contato, reação, citação, edição, exclusão) é normalizado corretamente. Mensagens de grupo identificam o grupo e o participante.
  - [ ] A mesma mensagem recebida duas vezes gera um único registro.
  - [ ] Nenhum payload enviado ao WhatsApp contém transcrição, explicação de resolução ou nota interna (teste de contrato).
  - [ ] Uma mensagem enviada pelo aparelho é registrada com origem "aparelho", e o eco de uma mensagem enviada pelo CRM não é registrado de novo.
  - [ ] Depois de reiniciar, as instâncias reconectam sem novo QR Code, e as mensagens recebidas durante a reinicialização são recuperadas.
  - [ ] Um arquivo acima do tamanho máximo, ou com conteúdo diferente do tipo declarado, é recusado.
  - [ ] Uma falha na transcrição não impede o registro da mensagem.

## Nunca fazer

- Nunca enviar ao WhatsApp transcrição, explicação da resolução ou nota interna. O adaptador de envio recebe só o conteúdo destinado ao cliente.
- Nunca ler, listar ou versionar `sessoes-baileys/`, nem gravar mídia em disco (a única exceção é o temporário cifrado do upload do Baileys, ver "Exceções aceitas").
- Nunca rodar mais de uma instância do processo nem encerrar sem desligamento gracioso, o que corromperia a sessão.
- Nunca identificar o contato só pelo telefone. Guardar também o LID.
- Nunca aceitar chamadas fora da rede interna ou sem o token de serviço, nem fazer envio em massa (risco de banimento do número).
- Nunca usar range de versão (`^`) no Baileys. A versão é fixa.

## Exceções aceitas

- **Temporário cifrado no upload de mídia (14b).** Exceção aceita pelo responsável do projeto em 2026-10-14: o Baileys grava temporário cifrado durante o upload de mídia, e a recepção e o restante do pipeline continuam sem disco. No 6.7.24, o `encryptedStream` (`lib/Utils/messages-media.js`, chamado por `prepareWAMessageMedia` em `lib/Utils/messages.js`) grava `<tipo><id>-enc` em `os.tmpdir()`. O arquivo tem AES-256-CBC + HMAC, e a chave fica só em memória. Ele é enviado por `createReadStream` e apagado no `finally`, tanto no sucesso quanto na falha. A cópia em claro (`-original`) não é gerada porque o envio manda `jpegThumbnail: null` e `seconds`.
  - O que pode sobrar em disco: o arquivo de uma queda no meio do upload, o de um `unlink` que falhou (o Baileys só registra no log) e o órfão de uma corrida do Baileys. O `encryptedStream` não espera o arquivo abrir, então, se o upload falha na hora, o `unlink` dá ENOENT e o arquivo é criado logo depois.
  - Mitigação (`src/whatsapp/tmpMidia.js`): o `os.tmpdir()` do processo aponta para `.cache/tmp-midia` (TMPDIR/TMP/TEMP, no boot). A pasta é limpa no boot, no desligamento (também quando o teto força a saída) e 1 s depois que o último upload em andamento termina (rastreador de uploads em `envio.js`). O upload de mídia recebe `mediaUploadTimeoutMs` igual ao prazo do envio, porque sem ele o axios do Baileys espera para sempre.
  - Não vale para mais nada: nenhum outro código grava mídia em disco, e a pasta não pode ser usada para outra coisa (ela é esvaziada sem aviso).

## Decisões em aberto

- [ ] Cobertura mínima de testes em %.
