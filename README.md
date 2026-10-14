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

Saúde do processo: `GET http://127.0.0.1:3501/ping` → `200 ok` e `GET /health` → `200 {"status":"ok"}`. As demais rotas exigem o header `X-Internal-Token`.

## Scripts

| Comando | O que faz |
|---|---|
| `yarn start` | Sobe o servidor (`node --env-file-if-exists=.env ./src/index.js`) |
| `yarn start:dev` | Sobe com nodemon, reiniciando a cada mudança em `src/` |
| `yarn test` | Roda `tests/**/*.test.js` com `node --test` |
| `yarn typecheck` | Verifica os tipos JSDoc (`tsc -p jsconfig.json`) |

## Cuidados

- `sessoes-baileys/` guarda as credenciais da sessão pareada de cada equipe. Nunca versionar nem compartilhar.
- Rodar sempre com **uma única instância** (PM2 `instances: 1`). Dois processos na mesma sessão corrompem o pareamento.
- Porta 3501 só na rede interna, nunca exposta pelo nginx.
