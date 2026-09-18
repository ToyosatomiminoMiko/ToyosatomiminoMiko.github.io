// 检查 wasm 产物是否存在,缺了就用一句能直接照做的话报错.
//
// 为什么要单独一步:web/pkg/ 是 wasm-bindgen 的生成物(已 gitignore),
// 而 metro_window/web/src 里的 TS 是**静态 import** 它的.少了这层检查,
// 用户拿到的会是 Vite 或 tsc 的 "Failed to resolve import ..." --
// 说得没错,但没告诉他该跑什么.
import { existsSync } from 'node:fs';

const artifact = 'metro_window/web/pkg/metro_window.js';

if (!existsSync(artifact)) {
    console.error(`[CHECK] 缺少 ${artifact}`);
    console.error('[CHECK] 生成它:npm run build:wasm(需要 cargo / rustc / wasm32-unknown-unknown)');
    process.exit(1);
}
