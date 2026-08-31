import initCompiler from '../wasm/compiler_rs/compiler_rs';
import initMath from '../wasm/math_rs/math_rs';
import initRender from '../wasm/render_rs/render_rs';

/**
 * @cache
 * 缓存目的:主线程只初始化一次 compiler/math/render 三个 WASM 模块.
 * 键/失效策略:模块级单例;首次调用时创建 Promise,之后复用,永不失效.
 * 生命周期:随页面模块存活,应用销毁时无需显式释放.
 */
let wasmReady: Promise<void> | null = null;

/**
 * @cache-access
 * 主线程共享的 WASM 初始化入口,保证 parser 和 compiler 不会重复初始化.
 */
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
