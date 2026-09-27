#!/usr/bin/env python3
"""
检查 wasm 产物是否存在, 缺了就用一句能直接照做的话报错.

为什么要单独一步: src/metro_window/wasm/ 是 wasm-bindgen 的生成物(已 gitignore),
而 src/metro_window/src 里的 TS 是**静态 import** 它的. 少了这层检查,
用户拿到的会是 Vite 或 tsc 的 "Failed to resolve import ..." --
说得没错, 但没告诉他该跑什么.

日志口径与重构前那个 mjs 版相同(缺产物时两行提示), 只是前缀并入了
buildlib 的分阶段格式: `[CHECK][ERROR][<时间>] ...`.
"""

from __future__ import annotations

import sys

import buildlib as kit

LOG = kit.Logger("CHECK")

# 相对仓库根, 不依赖调用方的 cwd(npm run 本来就在仓库根, 这里写死更稳).
ARTIFACT = "src/metro_window/wasm/metro_window.js"


def run_check():
    if not (kit.PROJECT_ROOT / ARTIFACT).exists():
        raise kit.BuildError(
            f"缺少 {ARTIFACT}",
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
