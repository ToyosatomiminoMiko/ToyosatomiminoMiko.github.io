/**
 * 积分计算的 Worker 门面.
 *
 * 入口只保留一个 `integrate(spec)`:
 * - 方法名直接用 IR 语义名(`IntegralMethod`),与 Worker/Rust parse 同一套
 *   词汇,不再有 trapz1d/trapz2d 这类带维度别名串在主线程各处拼写;
 * - 一维/二维由 `range` 长度区分,`n`/`m`/`layers`/lebesgue 超采样等
 *   参数在此处一次归一化,取代原先十个几乎一样的透传函数;
 * - 调度(Worker 复用,latest-only,dispose)保持原样.
 */
import type { IntegralMethod } from '../../compiler/ir/types';
import { NUMERIC_CONFIG } from '../../config/numericConfig';
import { ComputeWorkerClient } from './workers/ComputeWorkerClient';
import { LatestRequestExecutor } from './workers/LatestRequestExecutor';
import type {
    IntegralWorkerRequest,
    IntegralWorkerResponse,
} from './workers/IntegralWorker';

export type IntegralSampleShape = NonNullable<IntegralWorkerResponse['sampleShape']>;

export type IntegralResult = {
    value: number;
    samples?: Float64Array;
    sampleShape?: IntegralSampleShape;
    n?: number;
    m?: number;
};

/** 一次积分请求的完整描述. */
export type IntegralSpec = {
    method: IntegralMethod;
    expr: string;
    coeffs: Record<string, number>;
    /** 一维为 `[a, b]`;二维为 `[xMin, xMax, yMin, yMax]`. */
    range: [number, number] | [number, number, number, number];
    /** 分段数;lebesgue 作为超采样前的基准采样数. */
    segments: number;
    /** lebesgue 专用层数;其他方法忽略. */
    layers?: number;
};

// ---------- Worker 管理 ----------
/**
 * @cache
 * 缓存目的:积分计算复用同一个 Worker client 和 latest-only 调度器.
 * 键/失效策略:模块级单例;应用销毁时由 disposeIntegralWorker 显式释放.
 * 生命周期:模块级,随页面存活.
 */
const integralClient = new ComputeWorkerClient<IntegralWorkerRequest, IntegralWorkerResponse>(() => new Worker(
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
const integralExecutor = new LatestRequestExecutor<IntegralWorkerRequest, IntegralWorkerResponse>(
    integralClient,
);

/**
 * @cache-access
 * 通过 latest-only executor 调用积分 Worker.
 */
export function integrate(spec: IntegralSpec): Promise<IntegralResult> {
    return integralExecutor
        .request(buildRequest(spec))
        .then((response) => ({
            value: response.value!,
            samples: response.samples,
            sampleShape: response.sampleShape,
            n: response.n,
            m: response.m,
        }));
}

function buildRequest(spec: IntegralSpec): Omit<IntegralWorkerRequest, 'id'> {
    const base = {
        method: spec.method,
        expr: spec.expr,
        coeffs: spec.coeffs,
    };
    if (spec.range.length === 2) {
        const [a, b] = spec.range;
        if (spec.method === 'lebesgue') {
            return {
                ...base,
                dim: '1d' as const,
                a,
                b,
                layers: spec.layers ?? spec.segments,
                sampleN:
                    spec.segments * NUMERIC_CONFIG.integral.lebesgueOversample1D,
            };
        }
        return {
            ...base,
            dim: '1d' as const,
            a,
            b,
            n: spec.segments,
        };
    }

    const [xa, xb, ya, yb] = spec.range as [number, number, number, number];
    if (spec.method === 'lebesgue') {
        return {
            ...base,
            dim: '2d' as const,
            xa,
            xb,
            ya,
            yb,
            layers: spec.layers ?? spec.segments,
            sampleN:
                spec.segments * NUMERIC_CONFIG.integral.lebesgueOversample2D,
        };
    }
    return {
        ...base,
        dim: '2d' as const,
        xa,
        xb,
        ya,
        yb,
        n: spec.segments,
        m: spec.segments,
    };
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
