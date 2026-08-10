#!/bin/bash

# 遇到错误立即退出
set -euo pipefail
# 项目根目录
PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"

log()  { echo "[LOG][$(date '+%Y.%m.%d.%H:%M:%S')] $*"; }
err()  { echo "[ERR][$(date '+%Y.%m.%d.%H:%M:%S')] $*" >&2; }

trap 'err "Build failed at line $LINENO"' ERR

log "building..."

# rust wasm 构建
log "rust wasm building..."
cd "$PROJECT_ROOT/math-lab/ml_wasm"
wasm-pack build --target web --out-dir ../src/wasm

log "npm type-checking..."
cd "$PROJECT_ROOT"
npx tsc --noEmit

# 前端构建
log "npm building..."
npm run build

log "build succeeded."
