#!/usr/bin/env bash
# Rust -> wasm32-unknown-unknown,再用 wasm-bindgen 生成 web/pkg/.
#
# 归属:本脚本属于 metro_window 子项目,但**由仓库根目录的 package.json 调用**
# (`npm run build:wasm`).这样做是为了保住"构建步骤序列只有 package.json 一处
# 事实源"这条约定:根 build.sh 仍然只负责装依赖 + 调 `npm run build:all`,
# 不在 shell 里另排一遍步骤.
#
# 为什么这几步不直接写进 package.json:
#   - 编译前要探测并补装 wasm32 target;
#   - wasm-bindgen CLI 必须与 Cargo.lock 里的 crate 版本逐位一致,
#     版本得从 Cargo.lock 解析;版本不符时装到本子项目的 .cargo-tools/,
#     不污染全局,也不需要手工维护版本常量.
#
# 单独运行(只改了 Rust/WGSL 时):
#   bash metro_window/scripts/build-wasm.sh
# 等价于在仓库根跑:
#   npm run build:wasm

set -Eeuo pipefail

# 脚本在 metro_window/scripts/ 下,项目根是它的上一级
METRO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$METRO_ROOT"

log() {
    printf '[WASM][%s] %s\n' "$(date '+%Y.%m.%d.%H:%M:%S')" "$*"
}

err() {
    printf '[WASM][ERROR][%s] %s\n' "$(date '+%Y.%m.%d.%H:%M:%S')" "$*" >&2
}

require_command() {
    local name="$1"
    if ! command -v "$name" >/dev/null 2>&1; then
        err "missing required command: ${name}"
        exit 127
    fi
}

trap 'err "failed at line ${LINENO}"' ERR

target=wasm32-unknown-unknown
tools_dir="${METRO_ROOT}/.cargo-tools"

require_command cargo
require_command rustc

# rustup 工具链缺少 wasm32 target 时自动补装
if command -v rustup >/dev/null 2>&1 && ! rustup target list --installed | grep -qx "$target"; then
    log "安装 ${target} target"
    rustup target add "$target"
fi

log "编译 Rust(${target})"
cargo build --release --target "$target"

# CLI 与 crate 版本不一致时 wasm-bindgen 会在运行时报错,
# 因此版本从 Cargo.lock 解析(cargo pkgid),不手工维护常量
wb_version="$(cargo pkgid wasm-bindgen | sed 's/.*#wasm-bindgen@//')"
if ! printf '%s' "$wb_version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+'; then
    err "无法从 Cargo.lock 解析 wasm-bindgen 版本(got: '${wb_version}')"
    exit 1
fi

# 候选顺序:显式指定的 WASM_BINDGEN_BIN -> PATH 中的 -> 项目本地安装的
wb=""
for cand in "${WASM_BINDGEN_BIN:-}" "$(command -v wasm-bindgen 2>/dev/null || true)" "$tools_dir/bin/wasm-bindgen"; do
    if [ -n "$cand" ] && [ -x "$cand" ] \
        && [ "$("$cand" --version 2>/dev/null)" = "wasm-bindgen $wb_version" ]; then
        wb="$cand"
        break
    fi
done

if [ -z "$wb" ]; then
    log "安装 wasm-bindgen-cli=${wb_version} 到 .cargo-tools/"
    cargo install wasm-bindgen-cli --version "=${wb_version}" --root "$tools_dir"
    wb="$tools_dir/bin/wasm-bindgen"
fi

# 最终只校验一次:走到这里 wb 必须是可执行且版本一致的 CLI
if [ ! -x "$wb" ] || [ "$("$wb" --version 2>/dev/null)" != "wasm-bindgen $wb_version" ]; then
    err "wasm-bindgen 版本不匹配: 需要 ${wb_version},实际 $("$wb" --version 2>/dev/null || echo 不可执行)"
    exit 1
fi
log "wasm-bindgen ${wb_version} (${wb})"

# web/pkg 先清空再生成:改了 --out-name 后不会残留旧文件
# (build:all 里的 clean 已经删过一次,这里保证单独执行也干净)
rm -rf web/pkg
mkdir -p web/pkg
log "生成 web/pkg/(wasm-bindgen --target web)"
"$wb" --target web --out-dir web/pkg --out-name metro_window \
    "target/${target}/release/metro_window.wasm"

log "wasm 产物: ${METRO_ROOT}/web/pkg"
