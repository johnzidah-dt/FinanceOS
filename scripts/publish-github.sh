#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 git@github.com:PROPRIETAIRE/FinanceOS.git" >&2
  exit 1
fi

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
GIT_DIR="$ROOT/.git-local"
REMOTE_URL="$1"
VERSION=$(cat "$ROOT/VERSION")

if [ ! -d "$GIT_DIR" ]; then
  echo "Métadonnées Git introuvables: $GIT_DIR" >&2
  exit 1
fi

if git --git-dir="$GIT_DIR" remote get-url origin >/dev/null 2>&1; then
  git --git-dir="$GIT_DIR" remote set-url origin "$REMOTE_URL"
else
  git --git-dir="$GIT_DIR" remote add origin "$REMOTE_URL"
fi

git --git-dir="$GIT_DIR" push -u origin main
git --git-dir="$GIT_DIR" push origin "v$VERSION"

echo "FinanceOS $VERSION publié sur $REMOTE_URL"
