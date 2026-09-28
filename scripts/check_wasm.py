#!/usr/bin/env python3
"""
检查 wasm 产物是否存在, 缺了就用一句能直接照做的话报错.

为什么要单独一步: src/metro_window/wasm/ 是 wasm-bindgen 的生成物(已 gitignore),
而 src/metro_window/src 里的 TS 是**静态 import** 它的. 少了这层检查,
用户拿到的会是 Vite 或 tsc 的 "Failed to resolve import ..." --
说得没错, 但没告诉他该跑什么.

缺产物时按 buildlib 的分阶段格式打印两行: `[CHECK][ERROR][<时间>] ...`.
"""

from __future__ import annotations

import sys

import build_wasm
import buildlib as kit

LOG = kit.Logger("CHECK")

# 相对仓库根, 不依赖调用方的 cwd(npm run 本来就在仓库根, 这里写死更稳).
# JS 胶水与 .wasm 二进制同名同源, 基名从 build_wasm 取, 避免两处各写一份.
WASM_RELATIVE = build_wasm.WASM_DIR.relative_to(build_wasm.ROOT)
ARTIFACTS = (
    WASM_RELATIVE / f"{build_wasm.WASM_OUT_NAME}.js",
    WASM_RELATIVE / f"{build_wasm.WASM_OUT_NAME}_bg.wasm",
)


def run_check():
    for artifact in ARTIFACTS:
        if not (kit.PROJECT_ROOT / artifact).exists():
            raise kit.BuildError(
                f"缺少 {artifact}",
                "生成它: npm run build:wasm(需要 cargo / rustc / wasm32-unknown-unknown)",
            )
    return kit.EXIT_OK


def main(argv):
    if argv:
        LOG.err(f"unexpected argument(s): {' '.join(argv)} (this script takes none)")
        return kit.EXIT_USAGE
    return kit.run_cli(LOG, run_check)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
