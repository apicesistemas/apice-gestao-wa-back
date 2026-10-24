# apice-gestao-wa-back — Motor de conversa WhatsApp

Runtime 24/7 do Baileys com **uma instância por equipe**: recebe, normaliza e registra todas as mensagens (grupos e conversas privadas, todas as mídias, inclusive as enviadas pelo aparelho), transcreve áudio e vídeo via MiniMax e envia as respostas do atendente. Fala só com o `apice-gestao-back`, por HTTP interno com token de serviço.

Faz parte do [apice-gestao-monorepo](https://github.com/apicesistemas/apice-gestao-monorepo). Especificação em `SPEC.md` e plano em `PLAN.md`, na raiz do monorepo. Convenções de código em [CLAUDE.md](CLAUDE.md).

## Stack

Node.js 22.9+ (JavaScript CommonJS com JSDoc `// @ts-check`) · Baileys `6.7.24` (versão fixa) · Express 5 · MiniMax M3 (transcrição) · testes com `node:test`.

## Como rodar

```bash
yarn install
cp .env.example .env   # URL e token do back, chave da MiniMax
yarn start:dev         # nodemon, observa src/
```

Saúde do processo (sem token, só rede interna):

- `GET http://127.0.0.1:3501/ping` → `200 {"status":"ok","versao":"0.11.0","encerrando":false,"equipes":[{"cod_equipe":1,"status":"CONECTADO","desde":"2026-10-14T21:00:00.000Z"}]}`. Durante o desligamento gracioso responde `503` com `"status":"encerrando"` e `"encerrando":true`. Nunca leva JID, telefone, LID, nome do número, QR, texto de erro nem hash_empresa.
- `GET /health` → `200 {"status":"ok"}`.

As demais rotas exigem o header `X-Internal-Token`.

## Scripts

| Comando | O que faz |
|---|---|
| `yarn start` | Sobe o servidor (`node --env-file-if-exists=.env ./src/index.js`) |
| `yarn start:dev` | Sobe com nodemon, reiniciando a cada mudança em `src/` |
| `yarn test` | Roda `tests/**/*.test.js` com `node --test` |
| `yarn typecheck` | Verifica os tipos JSDoc (`tsc -p jsconfig.json`) |

## Deploy

No servidor interno (`192.168.1.167`), na pasta do submódulo, com o `.env` já preenchido:

```bash
bash deploy.sh
```

O script faz `git pull --ff-only`, `yarn install` e `yarn test`. Se os testes falham, ele para antes do PM2 e o processo em execução continua como estava. Com a suíte verde, roda `pm2 reload ecosystem.config.cjs --update-env` (ou `pm2 start` na primeira vez), espera o `GET /ping` responder 200 e grava a lista do PM2 (`pm2 save`).

O reload não derruba as sessões do WhatsApp. Com instância única em fork, o PM2 manda SIGINT ao processo, e o wa-back recusa envios novos com 503, espera os em andamento e encerra o Baileys sem logout, tudo em até 10 s, antes do `kill_timeout` de 12 s. O processo novo reconecta sem QR e recupera as mensagens que chegaram no intervalo.

> **Migração do nome do app no PM2.** O app agora se chama `Ápice Gestão - WA Back` (antes `apice-gestao-wa-back`). Quem já tem o processo antigo rodando no servidor precisa rodar `pm2 delete apice-gestao-wa-back` **uma única vez** antes do próximo deploy. Sem isso, o deploy sobe o app novo e os dois processos abririam a mesma sessão do Baileys, corrompendo o pareamento. O `deploy.sh` continua sem chamar `pm2 delete`. Depois, os comandos usam o nome entre aspas: `pm2 logs "Ápice Gestão - WA Back" --lines 100`.

Variáveis de ambiente do `deploy.sh` (opcionais, de shell, não vêm do `.env`):

| Variável | Padrão | Para que serve |
| -------- | ------ | -------------- |
| `DEPLOY_PORTA` | `3501` | Porta do `GET /ping` conferido depois do reload |
| `DEPLOY_TENTATIVAS_PING` | `20` | Quantas vezes o script tenta o `/ping` antes de falhar |
| `DEPLOY_INTERVALO_PING` | `3` | Espera, em segundos, entre as tentativas |

Exemplo: `DEPLOY_TENTATIVAS_PING=30 bash deploy.sh`.

Detalhes e parâmetros em [CLAUDE.md](CLAUDE.md#deploy).

## Cuidados

- `sessoes-baileys/` guarda as credenciais da sessão pareada de cada equipe. Nunca versionar nem compartilhar.
- Rodar sempre com **uma única instância** (PM2 `instances: 1`). Dois processos na mesma sessão corrompem o pareamento.
- Porta 3501 só na rede interna, nunca publicada pelo proxy (nginx). O processo escuta apenas em `SERVER_HOST` (padrão e valor fixo no PM2: `127.0.0.1`), então outra máquina da rede não alcança nem o `/ping`. `0.0.0.0` e `::` geram aviso no log. O `WA_BACK_BASE_URL` do back precisa ser `http://127.0.0.1:3501` (não `localhost`, que o Node pode resolver para `::1`).
- `CRM_BACK_URL` precisa ser `http://127.0.0.1:3500`: o back só aceita `/interno/*` vindo do loopback e sem cabeçalho de proxy, então não aponte para o domínio público nem para o nginx.

## Graphify (índice do código)

O graphify gera um grafo local do código (por AST, sem LLM e sem chave de API). O harness do Claude Code o consulta antes de `Grep`/`Glob` para achar arquivos e relações (quem chama, o que depende). Ele é índice, não fonte da verdade: confirme sempre abrindo o arquivo. Usar é opcional, e sem o graphify instalado nada quebra.

### Instalação

- Python 3.10+.
- `pip install graphifyy` (atenção: o nome do pacote tem dois "y").
- Confira com `graphify --help`. No Windows, se o comando não for achado, adicione a pasta `Scripts` do Python ao `PATH` (por exemplo `%APPDATA%\Python\Python314\Scripts`).

### Uso no wa-back

O `graphify-out/graph.json` e o `GRAPH_REPORT.md` vêm versionados, então quem clonar só esta pasta já consulta de dentro dela:

```bash
graphify query "Baileys conexão equipe"
graphify explain "BaileysAdapter.js"
graphify god-nodes --top 5
```

Para atualizar depois de mudar o código (local, sem LLM):

```bash
graphify update .
```

O `.graphifyignore` já exclui `.env*`, `sessoes-baileys/`, `LOGS/`, `.cache/`, testes e configs. Não o altere para incluí-los.

### Como testar se está funcionando

1. `graphify --help` mostra a lista de comandos (`Usage: graphify <command>`).
2. `graphify query "Baileys conexão equipe"` (dentro desta pasta) devolve `Graph: graphify-out/graph.json (761 nodes)` e linhas `NODE ... [src=src/... ]` apontando para arquivos de `src/`. Se der `error: graph file not found`, o `graph.json` não existe: rode `graphify extract . --code-only`.
3. `graphify explain "BaileysAdapter.js"` descreve o nó (`Node:`, `Source:`, `Community:`, `Degree:`) e os vizinhos.
4. `graphify god-nodes --top 5` lista os 5 nós mais conectados (`God nodes (most connected):`).
