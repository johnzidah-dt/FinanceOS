#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"

VERSION=$(cat VERSION)
grep -q "const APP_VERSION = \"$VERSION\"" outputs/prototype/app.js
node --check outputs/prototype/app.js
test -s outputs/prototype/index.html
test -s outputs/prototype/styles.css
test -s outputs/prototype/vendor/pdf-lib.min.js
grep -q "location = /healthz" deploy/nginx.conf

echo "Finance OS $VERSION: contrôles de version réussis."

