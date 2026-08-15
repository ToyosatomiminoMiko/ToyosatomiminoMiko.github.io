import init from '../wasm/ml_wasm';

let wasmReady: Promise<void> | null = null;

/** 主线程共享的 WASM 初始化入口，保证 parser 和 compiler 不会重复初始化。 */
export function ensureWasmReady(): Promise<void> {
    if (!wasmReady) {
        wasmReady = init().then(() => undefined);
    }
    return wasmReady;
}
