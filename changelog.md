# Changelog

Todas as mudanças relevantes deste projeto são documentadas aqui.
O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/).

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
