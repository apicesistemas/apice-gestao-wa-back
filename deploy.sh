#!/usr/bin/env bash
# Deploy do apice-gestao-wa-back no servidor interno (192.168.1.167), PM2 + porta 3501 (só rede interna).
# Uso, na pasta do submódulo no servidor:  bash deploy.sh
#
# 1. git pull --ff-only (nunca merge nem reset; .env, sessoes-baileys/ e .cache/ estão no .gitignore
#    e não são tocados);
# 2. yarn install (--frozen-lockfile quando o yarn.lock é versionado);
# 3. pm2 reload ecosystem.config.cjs --update-env (pm2 start na primeira vez). Com instância única
#    em fork, o reload é stop gracioso + start: o PM2 manda SIGINT, o wa-back recusa envios novos com
#    503, espera os em andamento, encerra as sessões do Baileys SEM logout e sai dentro do teto de
#    10 s, antes do kill_timeout de 12 s. A sessão fica em disco e o processo novo reconecta sem QR,
#    recuperando as mensagens que chegaram no intervalo;
# 4. confere o GET http://127.0.0.1:3501/ping com tentativas (503 durante o encerramento conta como
#    "ainda não") e só então grava a lista do PM2 (pm2 save). O ping em 127.0.0.1 é de propósito: o
#    wa-back escuta só no loopback (SERVER_HOST=127.0.0.1 no ecosystem.config.cjs).
#
# Não lê o .env, não imprime segredo e não apaga nada. Parâmetros opcionais por ambiente:
# DEPLOY_PORTA (3501), DEPLOY_TENTATIVAS_PING (20), DEPLOY_INTERVALO_PING (3 s).
set -Eeuo pipefail

# Nome do app no PM2 (com acento e espaços): TODO uso de "$APP" precisa estar entre aspas. Sem elas,
# o `pm2 describe` não acharia o app, o script cairia no `pm2 start` e subiria uma segunda instância
# na mesma sessão do Baileys. Deve ser igual ao `name` do ecosystem.config.cjs (conferido em teste).
APP="Ápice Gestão - WA Back"

# Tudo dentro de uma função: o bash lê o corpo inteiro antes de executar, então o git pull pode
# reescrever este arquivo no meio do deploy sem o bash ler lixo.
main() {
  local dir
  dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  cd "$dir"

  local porta="${DEPLOY_PORTA:-3501}"
  local tentativas="${DEPLOY_TENTATIVAS_PING:-20}"
  local intervalo="${DEPLOY_INTERVALO_PING:-3}"

  trap 'echo "[DEPLOY] Falha na linha $LINENO. Deploy abortado; o processo em execução não foi recarregado." >&2' ERR

  echo "[DEPLOY] Atualizando o código (git pull --ff-only)..."
  git pull --ff-only

  echo "[DEPLOY] Instalando as dependências..."
  if [ -f yarn.lock ] && git ls-files --error-unmatch yarn.lock >/dev/null 2>&1; then
    yarn install --frozen-lockfile --non-interactive
  else
    yarn install --non-interactive
  fi

  if pm2 describe "$APP" >/dev/null 2>&1; then
    echo "[DEPLOY] Recarregando no PM2 (desligamento gracioso, a sessão do WhatsApp é mantida)..."
    pm2 reload ecosystem.config.cjs --update-env
  else
    echo "[DEPLOY] $APP ainda não existe no PM2; subindo pela primeira vez..."
    pm2 start ecosystem.config.cjs
  fi

  local tentativa
  for ((tentativa = 1; tentativa <= tentativas; tentativa++)); do
    if curl -fsS --max-time 3 -o /dev/null "http://127.0.0.1:${porta}/ping"; then
      pm2 save --force >/dev/null
      local versao
      versao="$(node -p "require('./package.json').version" 2>/dev/null || echo "?")"
      echo "[DEPLOY] OK: $APP v${versao} respondendo em /ping (tentativa ${tentativa})."
      return 0
    fi
    sleep "$intervalo"
  done

  echo "[DEPLOY] O /ping não respondeu depois de ${tentativas} tentativas. Veja: pm2 logs \"$APP\" --lines 100" >&2
  exit 1
}

main "$@"; exit $?
