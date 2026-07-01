#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"

VERSION=$(cat VERSION)
grep -q "const APP_VERSION = \"$VERSION\"" outputs/prototype/app.js
node --check outputs/prototype/app.js
node --check server/src/server.js
test -s outputs/prototype/index.html
test -s outputs/prototype/styles.css
test -s outputs/prototype/vendor/pdf-lib.min.js
test -s outputs/prototype/manifest.webmanifest
test -s outputs/prototype/sw.js
test -s server/package.json
test -x install.sh
bash -n install.sh
grep -q "location = /healthz" deploy/nginx.conf
grep -q "location /api/" deploy/nginx.conf
grep -q "postgres:17-alpine" docker-compose.yml

echo "Finance OS $VERSION: contrôles de version réussis."
