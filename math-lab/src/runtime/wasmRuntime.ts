import initCompiler from '../wasm/compiler_rs/compiler_rs';
import initMath from '../wasm/math_rs/math_rs';
import initRender from '../wasm/render_rs/render_rs';

let wasmReady: Promise<void> | null = null;

/** 主线程共享的 WASM 初始化入口，保证 parser 和 compiler 不会重复初始化。 */
export function ensureWasmReady(): Promise<void> {
    if (!wasmReady) {
        wasmReady = Promise.all([
            initCompiler(),
            initMath(),
            initRender(),
        ]).then(() => undefined);
    }
    return wasmReady;
}
