#!/usr/bin/env bash
# Instala/atualiza o Prospex em produção numa VPS Ubuntu/Debian (rodar como root).
#   curl -fsSL https://raw.githubusercontent.com/miguelvespa400/cliente/main/deploy/setup-vps.sh | bash
# Idempotente: na 1ª vez instala Docker, cria o .env com segredos novos e sobe tudo;
# nas próximas só atualiza o código e reconstrói. O .env nunca é sobrescrito.
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/miguelvespa400/cliente.git}"
APP_DIR="${APP_DIR:-/opt/prospex}"

log() { printf '\n\033[1;35m==> %s\033[0m\n' "$*"; }

# Build do Next + Chromium pedem memória; em VPS de 2–4 GB, swap evita "killed" no build.
if ! swapon --show | grep -q .; then
  log "Criando swap de 4 GB"
  fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

if ! command -v docker >/dev/null 2>&1; then
  log "Instalando Docker"
  curl -fsSL https://get.docker.com | sh
fi
command -v git >/dev/null 2>&1 || { apt-get update -y && apt-get install -y git; }

if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  log "Liberando portas 22, 80 e 443 no firewall"
  ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp
fi

if [ -d "$APP_DIR/.git" ]; then
  log "Atualizando código"
  git -C "$APP_DIR" pull --ff-only
else
  log "Baixando código"
  git clone "$REPO_URL" "$APP_DIR"
fi
cd "$APP_DIR"

if [ ! -f .env ]; then
  log "Gerando .env com segredos novos"
  PUBLIC_IP="$(curl -fsS https://api.ipify.org)"
  cat > .env <<EOF
# Gerado por deploy/setup-vps.sh em $(date -u +%F). NÃO versionar.
# Endereço público. Sem domínio próprio usamos sslip.io (HTTPS automático pelo IP).
# Com domínio: troque por ex. prospex.netwish.com.br e aponte o DNS (A) para ${PUBLIC_IP}.
SITE_ADDRESS=${PUBLIC_IP//./-}.sslip.io

POSTGRES_USER=prospex
POSTGRES_PASSWORD=$(openssl rand -hex 24)
POSTGRES_DB=prospex
REDIS_PASSWORD=$(openssl rand -hex 24)
JWT_SECRET=$(openssl rand -base64 48 | tr -d '\n')
ENCRYPTION_KEY=$(openssl rand -base64 32 | tr -d '\n')

# Chave da OpenAI: prefira cadastrar no painel (Configurações → IA), que fica criptografada.
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini

# Cadastro fechado: o 1º usuário vira dono; demais só se o e-mail estiver aqui (vírgulas).
REGISTRATION_ALLOWED_EMAILS=
EOF
  chmod 600 .env
fi

log "Construindo e subindo os containers (a 1ª vez leva ~10 min)"
docker compose -f docker-compose.prod.yml --env-file .env up -d --build

SITE="$(grep '^SITE_ADDRESS=' .env | cut -d= -f2)"
log "Aguardando a API responder"
for _ in $(seq 1 60); do
  if curl -fsS "https://${SITE}/api/health" >/dev/null 2>&1; then
    log "Pronto: https://${SITE}  (crie a conta do administrador em /register)"
    exit 0
  fi
  sleep 10
done
echo "A API ainda não respondeu. Veja os logs: docker compose -f docker-compose.prod.yml logs --tail=100 api caddy" >&2
exit 1
