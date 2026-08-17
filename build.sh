#!/bin/bash

# 遇到错误立即退出
set -euo pipefail
# 项目根目录
PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"

log()  { echo "[LOG][$(date '+%Y.%m.%d.%H:%M:%S')] $*"; }
err()  { echo "[ERR][$(date '+%Y.%m.%d.%H:%M:%S')] $*" >&2; }

trap 'err "Build failed at line $LINENO"' ERR

log "checking WASM build, typecheck, tests, rustfmt and clippy..."
npm run check

log "building..."

cd "$PROJECT_ROOT"

npm run build:app

log "build succeeded."
