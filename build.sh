#!/bin/bash
# 构建脚本:先编译 WASM;再执行前端构建;

# 时间提示函数
__time_prompt() {
    date "+%Y.%m.%d.%H:%M:%S"
}

# 开始构建
echo "[LOG][$(__time_prompt)] building..."

# 遇到错误立即退出
set -e  

# rust wasm 构建
echo "[LOG][$(__time_prompt)] rust wasm building..."
# 进入 wasm 项目目录,执行 wasm-pack 构建
cd math-lab/ml_wasm
# 执行 rust wasm 构建
wasm-pack build --target web --out-dir ../src/wasm
# 返回项目根目录(脚本所在目录)
cd "$(dirname "$0")"

# 前端构建
echo "[LOG][$(__time_prompt)] npm checking..."
# 检查
npx tsc --noEmit
# 执行前端构建
npm run build

echo "[LOG][$(__time_prompt)] build succeeded."
