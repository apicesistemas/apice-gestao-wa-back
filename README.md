# apice-gestao-wa-back — Motor de conversa WhatsApp

Runtime 24/7 do Baileys com **uma instância por equipe**: recebe, normaliza e registra todas as mensagens (grupos e conversas privadas, todas as mídias, inclusive as enviadas pelo aparelho), transcreve áudio e vídeo via MiniMax e envia as respostas do atendente. Fala só com o `apice-gestao-back`, por HTTP interno com token de serviço.

Faz parte do [apice-gestao-monorepo](https://github.com/apicesistemas/apice-gestao-monorepo). Especificação em `SPEC.md` e plano em `PLAN.md`, na raiz do monorepo. Convenções de código em [CLAUDE.md](CLAUDE.md).

## Stack

Node.js 22+ (JavaScript CommonJS com JSDoc `// @ts-check`) · Baileys `6.7.24` (versão fixa) · Express 5 · MiniMax M3 (transcrição) · testes com `node:test`.

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

Detalhes e parâmetros em [CLAUDE.md](CLAUDE.md#deploy).

## Cuidados

- `sessoes-baileys/` guarda as credenciais da sessão pareada de cada equipe. Nunca versionar nem compartilhar.
- Rodar sempre com **uma única instância** (PM2 `instances: 1`). Dois processos na mesma sessão corrompem o pareamento.
- Porta 3501 só na rede interna, nunca exposta pelo nginx.
