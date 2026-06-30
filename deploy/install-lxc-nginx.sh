#!/usr/bin/env sh
set -eu

APP_ROOT="${APP_ROOT:-/var/www/finance-os}"
SOURCE_DIR="${SOURCE_DIR:-outputs/prototype}"

if [ ! -d "$SOURCE_DIR" ]; then
  echo "Dossier source introuvable: $SOURCE_DIR" >&2
  exit 1
fi

apt update
apt install -y nginx rsync

mkdir -p "$APP_ROOT"
rsync -av "$SOURCE_DIR"/ "$APP_ROOT"/

cat >/etc/nginx/sites-available/finance-os <<'NGINX'
server {
  listen 80;
  server_name _;

  root /var/www/finance-os;
  index index.html;

  etag on;
  add_header X-Content-Type-Options "nosniff" always;
  add_header X-Frame-Options "SAMEORIGIN" always;
  add_header Referrer-Policy "strict-origin-when-cross-origin" always;

  location = /healthz {
    access_log off;
    add_header Content-Type text/plain;
    return 200 "ok\n";
  }

  location = /index.html {
    add_header Cache-Control "no-store, no-cache, must-revalidate";
    try_files $uri =404;
  }

  location / {
    try_files $uri $uri/ /index.html;
    add_header Cache-Control "no-store";
  }
}
NGINX

ln -sf /etc/nginx/sites-available/finance-os /etc/nginx/sites-enabled/finance-os
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

echo "Finance OS est installé dans $APP_ROOT"
