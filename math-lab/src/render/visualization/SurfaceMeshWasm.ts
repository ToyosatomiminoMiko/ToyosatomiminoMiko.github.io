import {
    sample_and_process_surface as wasm_sample_and_process,
    generate_full_indices as wasm_generate_full_indices,
} from '../../wasm/render_rs/render_rs';
import { ensureWasmReady } from '../../runtime/wasmRuntime';

/**
 * @cache
 * 缓存目的:保留主线程直接调用 render_rs 曲面后处理的 WASM 初始化状态.
 * 键/失效策略:模块级单例;立即初始化，永不失效.
 * 生命周期:随模块存活.
 *
 * 说明:当前运行路径已经改走 surfaceWorker + SurfaceMesh，这个文件暂未
 *       被主运行路径使用;保留它是为了后续桌面端或主线程直算功能复用，
 *       不要仅因为“未使用”就删除.
 */
const wasmReady = ensureWasmReady();
let ready = false;
void wasmReady.then(() => { ready = true; });

/**
 * Rust 端一步完成采样 + 后处理
 * 替代 MathEvaluator.computeGrid
 */
export function sample_and_process(
    expr: string,
    coeffNames: string[],
    coeffValues: Float64Array,
    xMin: number, xMax: number,
    yMin: number, yMax: number,
    cols: number, rows: number,
) {
    if (!ready) {
        throw new Error('WASM 模块尚未初始化完成');
    }
    return wasm_sample_and_process(
        expr,
        coeffNames,
        coeffValues,
        xMin, xMax,
        yMin, yMax,
        cols, rows,
    );
}

/**
 * 生成完整三角索引数组,供构造函数初始化几何体
 */
export function generate_full_indices(cols: number, rows: number): number[] {
    if (!ready) {
        throw new Error('WASM 模块尚未初始化完成');
    }
    return Array.from(wasm_generate_full_indices(cols, rows));
}

/**
 * 返回 WASM 初始化 Promise,main.ts 中可 await 它再开始初始绘制
 */
export const ensureReady = (): Promise<void> => wasmReady;
