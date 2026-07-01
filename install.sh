#!/usr/bin/env bash
set -Eeuo pipefail

REPOSITORY="${FINANCEOS_REPOSITORY:-https://github.com/johnzidah-dt/FinanceOS.git}"
INSTALL_DIR="${FINANCEOS_INSTALL_DIR:-/opt/financeos}"
PORT="${FINANCEOS_PORT:-8080}"
BRANCH="${FINANCEOS_BRANCH:-main}"

info() { printf '\033[1;34m[FinanceOS]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[FinanceOS]\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(uname -s)" = "Linux" ] || fail "Cet installateur doit être exécuté sur Linux."
[ "${EUID:-$(id -u)}" -eq 0 ] || fail "Exécutez cette commande avec root ou sudo."

export DEBIAN_FRONTEND=noninteractive

install_base_packages() {
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update -qq
    apt-get install -y -qq ca-certificates curl git openssl >/dev/null
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y ca-certificates curl git openssl >/dev/null
  elif command -v apk >/dev/null 2>&1; then
    apk add --no-cache ca-certificates curl git openssl >/dev/null
  else
    fail "Distribution non prise en charge automatiquement. Installez curl, git, OpenSSL et Docker."
  fi
}

install_docker() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then return; fi
  info "Installation de Docker Engine et Docker Compose..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker 2>/dev/null || true
  docker compose version >/dev/null 2>&1 || fail "Docker Compose n'est pas disponible après l'installation."
}

repository_url() {
  if [ -n "${GITHUB_TOKEN:-}" ] && printf '%s' "$REPOSITORY" | grep -q '^https://github.com/'; then
    printf '%s' "$REPOSITORY" | sed "s#https://github.com/#https://x-access-token:${GITHUB_TOKEN}@github.com/#"
  else
    printf '%s' "$REPOSITORY"
  fi
}

fetch_source() {
  local authenticated_repository
  authenticated_repository=$(repository_url)
  if [ -d "$INSTALL_DIR/.git" ]; then
    info "Mise à jour du code existant..."
    git -C "$INSTALL_DIR" remote set-url origin "$authenticated_repository"
    git -C "$INSTALL_DIR" fetch --prune origin "$BRANCH"
    git -C "$INSTALL_DIR" checkout "$BRANCH"
    git -C "$INSTALL_DIR" reset --hard "origin/$BRANCH"
  else
    info "Téléchargement de FinanceOS..."
    mkdir -p "$(dirname "$INSTALL_DIR")"
    git clone --branch "$BRANCH" --depth 1 "$authenticated_repository" "$INSTALL_DIR"
  fi
  git -C "$INSTALL_DIR" remote set-url origin "$REPOSITORY"
}

random_secret() { openssl rand -hex "$1"; }

backup_database() {
  [ -d "$INSTALL_DIR/.git" ] || return
  [ -f "$INSTALL_DIR/docker-compose.yml" ] || return
  if ! docker compose -f "$INSTALL_DIR/docker-compose.yml" ps --status running db 2>/dev/null | grep -q db; then return; fi
  local backup_dir backup_file
  backup_dir="$INSTALL_DIR/backups"
  backup_file="$backup_dir/financeos-pre-update-$(date +%Y%m%d-%H%M%S).dump"
  mkdir -p "$backup_dir"
  info "Sauvegarde de la base avant mise à jour..."
  if ! docker compose -f "$INSTALL_DIR/docker-compose.yml" exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$backup_file"; then
    rm -f "$backup_file"
    fail "La sauvegarde PostgreSQL a échoué. La mise à jour est annulée."
  fi
  info "Sauvegarde créée : $backup_file"
}

configure_environment() {
  cd "$INSTALL_DIR"
  if [ -f .env ]; then
    info "Configuration existante conservée."
    local current_version
    current_version=$(cat VERSION)
    sed -i "s/^FINANCE_OS_VERSION=.*/FINANCE_OS_VERSION=$current_version/" .env
    sed -i "s/^FINANCE_OS_PORT=.*/FINANCE_OS_PORT=$PORT/" .env
    sed -i '/^INITIAL_ADMIN_EMAIL=/d; /^INITIAL_ADMIN_PASSWORD=/d' .env
    return
  fi

  local database_password jwt_secret current_version
  database_password=$(random_secret 24)
  jwt_secret=$(random_secret 48)
  current_version=$(cat VERSION)

  cat > .env <<EOF
FINANCE_OS_IMAGE=finance-os
FINANCE_OS_API_IMAGE=finance-os-api
FINANCE_OS_VERSION=$current_version
FINANCE_OS_PORT=$PORT
POSTGRES_DB=financeos
POSTGRES_USER=financeos
POSTGRES_PASSWORD=$database_password
JWT_SECRET=$jwt_secret
EOF
  chmod 600 .env
}

deploy() {
  cd "$INSTALL_DIR"
  info "Construction et démarrage des services..."
  docker compose up -d --build --remove-orphans
  info "Attente du démarrage de FinanceOS..."
  local attempt
  for attempt in $(seq 1 60); do
    if curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1; then return; fi
    sleep 2
  done
  docker compose ps
  docker compose logs --tail=80 api finance-os >&2 || true
  fail "FinanceOS n'a pas répondu dans le délai prévu."
}

main() {
  info "Installation ou mise à jour de FinanceOS"
  install_base_packages
  install_docker
  backup_database
  fetch_source
  configure_environment
  deploy

  local address
  address=$(hostname -I 2>/dev/null | awk '{print $1}')
  printf '\n\033[1;32mFinanceOS est opérationnel.\033[0m\n'
  printf 'Adresse : http://%s:%s\n' "${address:-IP_DU_SERVEUR}" "$PORT"
  printf 'Première installation : ouvrez cette adresse, puis créez le premier compte et la première société.\n'
  printf 'Dossier : %s\n' "$INSTALL_DIR"
  printf '\nConfigurez ensuite un domaine HTTPS pour activer l’installation PWA sur les appareils distants.\n'
}

main "$@"
