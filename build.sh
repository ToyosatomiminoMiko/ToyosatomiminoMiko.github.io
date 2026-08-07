#!/bin/bash
# 构建脚本:先编译 WASM;再执行前端构建;

set -e  # 遇到错误立即退出

# 进入 wasm 项目目录,执行 wasm-pack 构建
cd math-lab/ml_wasm
wasm-pack build --target web --out-dir ../src/wasm

# 返回项目根目录(脚本所在目录)
cd "$(dirname "$0")"

npx tsc --noEmit

# 执行前端构建
npm run build