import type { Range1D } from '../../compiler/ir/types';
import { ComputeWorkerClient } from './workers/ComputeWorkerClient';
import { LatestRequestExecutor } from './workers/LatestRequestExecutor';

type Method =
    | 'trapz1d' | 'simpson1d' | 'riemann1d_left' | 'riemann1d_right' | 'riemann1d_mid' | 'lebesgue1d'
    | 'trapz2d' | 'simpson2d' | 'riemann2d_left' | 'lebesgue2d';

type Request = {
    id: number;
    method: Method;
    expr: string;
    coeffs: Record<string, number>;
    a?: number;
    b?: number;
    n?: number;
    layers?: number;
    sampleN?: number;
    xa?: number;
    xb?: number;
    ya?: number;
    yb?: number;
    m?: number;
};

type Response = {
    id: number;
    value?: number;
    error?: string;
    samples?: Float64Array;
    sampleShape?: '1d-grid' | '1d-mid' | '2d-grid' | '2d-corner';
    n?: number;
    m?: number;
};

export type IntegralSampleShape = NonNullable<Response['sampleShape']>;

export type IntegralResult = {
    value: number;
    samples?: Float64Array;
    sampleShape?: IntegralSampleShape;
    n?: number;
    m?: number;
};

// ---------- Worker 管理 ----------
/**
 * @cache
 * 缓存目的:积分计算复用同一个 Worker client 和 latest-only 调度器.
 * 键/失效策略:模块级单例;应用销毁时由 disposeIntegralWorker 显式释放.
 * 生命周期:模块级,随页面存活.
 */
const integralClient = new ComputeWorkerClient<Request, Response>(() => new Worker(
    new URL('./workers/IntegralWorker.ts', import.meta.url),
    { type: 'module' },
));

// 积分请求也走 latest-only.滑块高频刷新时,旧请求不会再无意义地堆积;
// 每个时刻最多只有一个积分请求真正交给 Worker.
/**
 * @cache
 * 缓存目的:保证积分请求 latest-only,避免高频刷新堆积旧任务.
 * 键/失效策略:单飞队列;新请求取代 pending 请求.
 * 生命周期:模块级,随页面存活.
 */
const integralExecutor = new LatestRequestExecutor<Request, Response>(integralClient);

/**
 * @cache-access
 * 通过 latest-only executor 调用积分 Worker.
 */
function callWasm(
    method: Method,
    expr: string,
    coeffs: Record<string, number>,
    params: Record<string, number>,
): Promise<IntegralResult> {
    return integralExecutor
        .request({ method, expr, coeffs, ...params })
        .then((response) => ({
            value: response.value!,
            samples: response.samples,
            sampleShape: response.sampleShape,
            n: response.n,
            m: response.m,
        }));
}

/**
 * 应用级释放积分计算资源.
 * 先停掉 LatestRequestExecutor 的逻辑调度,再 terminate 共享 Worker.
 */
/**
 * @cache-access
 * 释放积分 latest-only 调度器和共享 Worker.
 */
export function disposeIntegralWorker(): void {
    integralExecutor.dispose();
    integralClient.dispose();
}

// ---------- 公共 API ----------

export function trapz1d(
    expr: string,
    coeffs: Record<string, number>,
    a: number,
    b: number,
    n: number,
): Promise<IntegralResult> {
    return callWasm('trapz1d', expr, coeffs, { a, b, n });
}

export function simpson1d(
    expr: string,
    coeffs: Record<string, number>,
    a: number,
    b: number,
    n: number,
): Promise<IntegralResult> {
    return callWasm('simpson1d', expr, coeffs, { a, b, n });
}

export function riemann1dLeft(
    expr: string,
    coeffs: Record<string, number>,
    a: number,
    b: number,
    n: number,
): Promise<IntegralResult> {
    return callWasm('riemann1d_left', expr, coeffs, { a, b, n });
}

// 预留数值方法:右侧/中点黎曼的 Rust 实现已经存在,但 DSL 的 method
// 映射当前只使用左黎曼(riemann1dLeft).保留导出以便未来在 DSL/UI 增加
// right/mid 选项时直接暴露;若确认不再需要,应连同 Rust 导出一起删除.
export function riemann1dRight(
    expr: string,
    coeffs: Record<string, number>,
    a: number,
    b: number,
    n: number,
): Promise<IntegralResult> {
    return callWasm('riemann1d_right', expr, coeffs, { a, b, n });
}

// 预留数值方法:同 riemann1dRight,当前无 DSL 入口,仅有测试/直接调用可触达.
export function riemann1dMid(
    expr: string,
    coeffs: Record<string, number>,
    a: number,
    b: number,
    n: number,
): Promise<IntegralResult> {
    return callWasm('riemann1d_mid', expr, coeffs, { a, b, n });
}

export function lebesgue1d(
    expr: string,
    coeffs: Record<string, number>,
    a: number,
    b: number,
    layers: number,
    sampleN: number,
): Promise<IntegralResult> {
    return callWasm('lebesgue1d', expr, coeffs, { a, b, layers, sampleN });
}

export function trapz2d(
    expr: string,
    coeffs: Record<string, number>,
    xRange: Range1D,
    yRange: Range1D,
    n: number,
    m: number,
): Promise<IntegralResult> {
    return callWasm('trapz2d', expr, coeffs, {
        xa: xRange[0],
        xb: xRange[1],
        ya: yRange[0],
        yb: yRange[1],
        n,
        m,
    });
}

export function simpson2d(
    expr: string,
    coeffs: Record<string, number>,
    xRange: Range1D,
    yRange: Range1D,
    n: number,
    m: number,
): Promise<IntegralResult> {
    return callWasm('simpson2d', expr, coeffs, {
        xa: xRange[0],
        xb: xRange[1],
        ya: yRange[0],
        yb: yRange[1],
        n,
        m,
    });
}

export function riemann2dLeft(
    expr: string,
    coeffs: Record<string, number>,
    xRange: Range1D,
    yRange: Range1D,
    n: number,
    m: number,
): Promise<IntegralResult> {
    return callWasm('riemann2d_left', expr, coeffs, {
        xa: xRange[0],
        xb: xRange[1],
        ya: yRange[0],
        yb: yRange[1],
        n,
        m,
    });
}

export function lebesgue2d(
    expr: string,
    coeffs: Record<string, number>,
    xRange: Range1D,
    yRange: Range1D,
    layers: number,
    sampleN: number,
): Promise<IntegralResult> {
    return callWasm('lebesgue2d', expr, coeffs, {
        xa: xRange[0],
        xb: xRange[1],
        ya: yRange[0],
        yb: yRange[1],
        layers,
        sampleN,
    });
}
