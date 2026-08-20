#!/usr/bin/env bash
# Production build entrypoint.
# This script is intentionally thin: it only installs pinned dependencies and
# delegates every build/check stage to package.json scripts.

set -Eeuo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

log() {
    printf '[BUILD][%s] %s\n' "$(date '+%Y.%m.%d.%H:%M:%S')" "$*"
}

err() {
    printf '[BUILD][ERROR][%s] %s\n' "$(date '+%Y.%m.%d.%H:%M:%S')" "$*" >&2
}

require_command() {
    local name="$1"
    if ! command -v "$name" >/dev/null 2>&1; then
        err "missing required command: ${name}"
        exit 127
    fi
}

trap 'err "build failed at line ${LINENO}"' ERR

require_command node
require_command npm
require_command cargo
require_command wasm-pack

log "installing pinned dependencies from package-lock.json"
npm ci --no-audit --no-fund

log "running Rust format and clippy checks"
npm run lint:rs

log "running tests"
npm test

log "building production artifacts"
npm run build

log "build succeeded"
log "output directory: ${PROJECT_ROOT}/dist"
