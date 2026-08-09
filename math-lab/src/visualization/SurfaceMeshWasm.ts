import init, { filter_nan_triangles as wasm_filter_nan_triangles } from '../wasm/ml_wasm';

// 立即触发初始化,后续调用者共享同一个 Promise
const wasmReady = init();

/**
 * 安全版本:确保 WASM 初始化完成后才调用 filter_nan_triangles
 * 注意:这个函数是同步的,但要求调用前 WASM 必须已就绪
 *       如果还没就绪,会抛出一个可捕获的错误
 */
let ready = false;
wasmReady.then(() => { ready = true; });

export function filter_nan_triangles(full_indices: Uint32Array, z_values: Float64Array): number[] {
    if (!ready) {
        throw new Error('WASM 模块尚未初始化完成,请在应用启动时触发 SurfaceMeshWasm.init()');
    }
    return Array.from(wasm_filter_nan_triangles(full_indices, z_values));
}

/**
 * 返回 WASM 初始化 Promise,main.ts 中可 await 它再开始初始绘制
 */
export const ensureReady = (): Promise<unknown> => wasmReady;
