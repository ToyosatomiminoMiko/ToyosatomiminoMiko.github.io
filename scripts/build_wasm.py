#!/usr/bin/env python3
"""
Rust -> wasm32-unknown-unknown, 再用 wasm-bindgen 生成 src/metro_window/wasm/.

归属: 脚本本体在仓库的 scripts/ 目录下, **由仓库根目录的 package.json 调用**
(`npm run build:wasm` -> `python3 scripts/build_wasm.py`). 这样做是为了保住
"构建步骤序列只有 package.json 一处事实源"这条约定: 根 build.sh 仍然只负责
装依赖 + 调 `npm run build:all`, 不在里面另排一遍步骤.

为什么这几步不直接写进 package.json:
  - 编译前要探测并补装 wasm32 target;
  - wasm-bindgen CLI 必须与 Cargo.lock 里的 crate 版本逐位一致,
    版本得从 Cargo.lock 解析; 版本不符时装到本子项目的 .cargo-tools/,
    不污染全局, 也不需要手工维护版本常量.

为什么是 Python 而不是 shell(与 miko_graphcalc 同一条口径): 这里的代码几乎都在
"读命令输出 -> 判断 -> 决定下一步"上, 而这些正是 shell 最容易写错的部分;
日志前缀与退出码语义由 buildlib 统一, 与 build.py / dev_ui_link.py 一致.

cargo 侧: workspace 根在仓库根(根 Cargo.toml 的 [workspace] 收录
src/metro_window/rust), 所以 Cargo.lock 与 target/ 都在仓库根,
这里从仓库根用 --package metro-window 指定要编的成员.

涉及的目录:
  src/metro_window/rust/   Rust crate(Cargo.toml / src/ / examples/), 编译目标
  src/metro_window/src/    前端源码(TS/CSS)
  src/metro_window/wasm/   生成物: wasm-bindgen 输出(gitignore)
  src/metro_window/.cargo-tools/  版本对齐用的 wasm-bindgen CLI 安装位置
  target/                  workspace 共用的 cargo 构建缓存(仓库根, gitignore)

单独运行(只改了 Rust/WGSL 时):
  python3 scripts/build_wasm.py
等价于在仓库根跑:
  npm run build:wasm
"""

from __future__ import annotations

import os
import re
import shutil
import sys
from pathlib import Path

import buildlib as kit

LOG = kit.Logger("WASM")
ROOT = kit.PROJECT_ROOT
METRO_ROOT = ROOT / "src" / "metro_window"
WASM_DIR = METRO_ROOT / "wasm"
# workspace 的 target/ 在根 manifest 旁边, 不随成员 crate 走
TARGET_DIR = ROOT / "target"
TOOLS_DIR = METRO_ROOT / ".cargo-tools"

TARGET = "wasm32-unknown-unknown"
# Cargo.lock 里解析出来的版本必须是三段数字: 解析不到就别往下走,
# 否则下面会把一个空版本拼进 `cargo install --version =`, 报错更难懂.
VERSION_RE = re.compile(r"^\d+\.\d+\.\d+")


def resolve_wasm_bindgen_version():
    """从 Cargo.lock 解析 wasm-bindgen 的版本(cargo pkgid).

    CLI 与 crate 版本不一致时 wasm-bindgen 会在运行时报错, 所以版本认 Cargo.lock,
    不手工维护常量.
    """
    output = kit.run_capture(["cargo", "pkgid", "wasm-bindgen"], cwd=ROOT)
    if output is None:
        raise kit.BuildError("cannot resolve wasm-bindgen from Cargo.lock (cargo pkgid failed)")
    # `path+file:///...#wasm-bindgen@0.2.100` / `registry+https://...#wasm-bindgen@0.2.100`
    line = next((item.strip() for item in output.splitlines() if item.strip()), "")
    marker = "#wasm-bindgen@"
    version = line.split(marker, 1)[1] if marker in line else line
    if not VERSION_RE.match(version):
        raise kit.BuildError(
            f"无法从 Cargo.lock 解析 wasm-bindgen 版本(got: '{version}')"
        )
    return version


def tool_version(path):
    """某个候选 wasm-bindgen 的 `--version` 输出; 不可执行 / 跑不动时返回 None."""
    output = kit.run_capture([path, "--version"])
    return output.strip() if output is not None else None


def find_wasm_bindgen(version):
    """候选顺序: 显式指定的 WASM_BINDGEN_BIN -> PATH 中的 -> 项目本地安装的."""
    candidates = (
        os.environ.get("WASM_BINDGEN_BIN", ""),
        shutil.which("wasm-bindgen") or "",
        str(TOOLS_DIR / "bin" / "wasm-bindgen"),
    )
    for candidate in candidates:
        if not candidate or not os.access(candidate, os.X_OK):
            continue
        if tool_version(candidate) == f"wasm-bindgen {version}":
            return candidate
    return None


def run_build():
    kit.require_command("cargo")
    kit.require_command("rustc")

    # rustup 工具链缺少 wasm32 target 时自动补装
    if shutil.which("rustup") is not None:
        installed = kit.run_capture(["rustup", "target", "list", "--installed"])
        targets = installed.splitlines() if installed else []
        if TARGET not in [item.strip() for item in targets]:
            LOG.log(f"安装 {TARGET} target")
            kit.run(["rustup", "target", "add", TARGET], cwd=ROOT)

    LOG.log(f"编译 Rust({TARGET})")
    kit.run(
        ["cargo", "build", "--release", "--target", TARGET, "--package", "metro-window"],
        cwd=ROOT,
    )

    version = resolve_wasm_bindgen_version()

    binary = find_wasm_bindgen(version)
    if binary is None:
        LOG.log(f"安装 wasm-bindgen-cli={version} 到 .cargo-tools/")
        kit.run(
            [
                "cargo", "install", "wasm-bindgen-cli",
                "--version", f"={version}", "--root", str(TOOLS_DIR),
            ],
            cwd=ROOT,
        )
        binary = str(TOOLS_DIR / "bin" / "wasm-bindgen")

    # 最终只校验一次: 走到这里 binary 必须是可执行且版本一致的 CLI
    if not os.access(binary, os.X_OK) or tool_version(binary) != f"wasm-bindgen {version}":
        actual = tool_version(binary) or "不可执行"
        raise kit.BuildError(f"wasm-bindgen 版本不匹配: 需要 {version}, 实际 {actual}")
    LOG.log(f"wasm-bindgen {version} ({binary})")

    # wasm/ 先清空再生成: 改了 --out-name 后不会残留旧文件
    # (build:all 里的 clean 已经删过一次, 这里保证单独执行也干净)
    kit.remove_path(WASM_DIR)
    WASM_DIR.mkdir(parents=True, exist_ok=True)
    LOG.log("生成 src/metro_window/wasm/(wasm-bindgen --target web)")
    kit.run(
        [
            binary, "--target", "web",
            "--out-dir", str(WASM_DIR),
            "--out-name", "metro_window",
            str(TARGET_DIR / TARGET / "release" / "metro_window.wasm"),
        ],
        cwd=ROOT,
    )

    LOG.log(f"wasm 产物: {WASM_DIR}")
    return kit.EXIT_OK


def main(argv):
    if argv:
        # 这个脚本没有参数; 有参数多半是把旧 shell 入口的写法带过来了.
        LOG.err(f"unexpected argument(s): {' '.join(argv)} (this script takes none)")
        return kit.EXIT_USAGE
    return kit.run_cli(LOG, run_build)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
