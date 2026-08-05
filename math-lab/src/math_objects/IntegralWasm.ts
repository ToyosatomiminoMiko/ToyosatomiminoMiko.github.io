import type { Integral1DFn, Integral2DFn, Range1D } from './types';

// wasm 模块引用 路径请根据实际部署调整
// wasm-pack build --target web 会生成 ml_wasm.js
import init, {
    trapz1d as wasm_trapz1d,
    simpson1d as wasm_simpson1d,
    riemann1d_left as wasm_riemann1d_left,
    riemann1d_right as wasm_riemann1d_right,
    riemann1d_mid as wasm_riemann1d_mid,
    lebesgue1d as wasm_lebesgue1d,
    trapz2d as wasm_trapz2d,
    simpson2d as wasm_simpson2d,
    riemann2d_left as wasm_riemann2d_left,
    lebesgue2d as wasm_lebesgue2d,
} from '../wasm/ml_wasm.js';

// ---------- 初始化管理 ----------

let wasmReady = false;
const initPromise = init().then(() => { wasmReady = true; });

async function ensureWasm(): Promise<void> {
    if (!wasmReady) await initPromise;
}

// ---------- 一维辅助：包装 JS 函数为 accepted by wasm ----------
// (wasm-bindgen 的 &js_sys::Function 可以直接接收 JS 函数)

// ---------- 一维积分 ----------

/** 一维复合梯形法  */
export async function trapz1d(
    f: Integral1DFn,
    a: number,
    b: number,
    N: number,
): Promise<number> {
    await ensureWasm();
    return wasm_trapz1d(f, a, b, N);
}

/** 一维复合辛普森法  */
export async function simpson1d(
    f: Integral1DFn,
    a: number,
    b: number,
    N: number,
): Promise<number> {
    await ensureWasm();
    return wasm_simpson1d(f, a, b, N);
}

/** 一维黎曼和 左端点 */
export async function riemann1dLeft(
    f: Integral1DFn,
    a: number,
    b: number,
    N: number,
): Promise<number> {
    await ensureWasm();
    return wasm_riemann1d_left(f, a, b, N);
}

/** 一维黎曼和 右端点 */
export async function riemann1dRight(
    f: Integral1DFn,
    a: number,
    b: number,
    N: number,
): Promise<number> {
    await ensureWasm();
    return wasm_riemann1d_right(f, a, b, N);
}

/** 一维黎曼和 中点 */
export async function riemann1dMid(
    f: Integral1DFn,
    a: number,
    b: number,
    N: number,
): Promise<number> {
    await ensureWasm();
    return wasm_riemann1d_mid(f, a, b, N);
}

/** 一维勒贝格积分  */
export async function lebesgue1d(
    f: Integral1DFn,
    a: number,
    b: number,
    layers: number,
    sampleN: number,
): Promise<number> {
    await ensureWasm();
    return wasm_lebesgue1d(f, a, b, layers, sampleN);
}

// ---------- 二维积分 ----------

/** 二维复合梯形法  */
export async function trapz2d(
    f: Integral2DFn,
    xRange: Range1D,
    yRange: Range1D,
    N: number,
    M: number,
): Promise<number> {
    await ensureWasm();
    const [xa, xb] = xRange;
    const [ya, yb] = yRange;
    return wasm_trapz2d(f, xa, xb, ya, yb, N, M);
}

/** 二维复合辛普森法  */
export async function simpson2d(
    f: Integral2DFn,
    xRange: Range1D,
    yRange: Range1D,
    N: number,
    M: number,
): Promise<number> {
    await ensureWasm();
    const [xa, xb] = xRange;
    const [ya, yb] = yRange;
    return wasm_simpson2d(f, xa, xb, ya, yb, N, M);
}

/** 二维黎曼和 左下方角 */
export async function riemann2dLeft(
    f: Integral2DFn,
    xRange: Range1D,
    yRange: Range1D,
    N: number,
    M: number,
): Promise<number> {
    await ensureWasm();
    const [xa, xb] = xRange;
    const [ya, yb] = yRange;
    return wasm_riemann2d_left(f, xa, xb, ya, yb, N, M);
}

/** 二维勒贝格积分  */
export async function lebesgue2d(
    f: Integral2DFn,
    xRange: Range1D,
    yRange: Range1D,
    layers: number,
    sampleN: number,
): Promise<number> {
    await ensureWasm();
    const [xa, xb] = xRange;
    const [ya, yb] = yRange;
    return wasm_lebesgue2d(f, xa, xb, ya, yb, layers, sampleN);
}