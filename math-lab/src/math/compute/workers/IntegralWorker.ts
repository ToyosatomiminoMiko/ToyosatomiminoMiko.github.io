/**
 * 积分计算 Worker.
 * 采样/求值与积分值计算全部由 Rust/WASM 完成,不再使用外部 JS 数学库.
 */
import init, {
    integrate1d,
    integrate2d,
} from "../../../wasm/math_rs/math_rs";
import type { IntegralMethod } from '../../../compiler/ir/types';
import { recordToCoefficientArgs } from '../../coefficientUtils';
import { createWasmWorker } from './wasmWorkerRuntime';

export type IntegralWorkerRequest = {
    id: number;
    /**
     * 语义方法名,与 IR `IntegralMethod`(`compiler/ir/types`)及 Rust
     * `math_rs/src/lib.rs` 的 parse 名单保持一致;维度由 `dim` 显式给出,
     * 不再用 "trapz1d"/"trapz2d" 这类带维度的别名串间接表达.
     */
    method: IntegralMethod;
    /** 决定调用 Rust 的 `integrate1d` 还是 `integrate2d` 入口. */
    dim: '1d' | '2d';
    expr: string;
    coeffs: Record<string, number>;
    a?: number;
    b?: number;
    xa?: number;
    xb?: number;
    ya?: number;
    yb?: number;
    /** 网格采样分段(lebesgue 之外的方法使用). */
    n?: number;
    m?: number;
    /** lebesgue 专用. */
    layers?: number;
    /** lebesgue 超采样数(由主线程按 oversample 倍数换算后传入). */
    sampleN?: number;
};

export type IntegralWorkerResponse = {
    id: number;
    value?: number;
    error?: string;
    samples?: Float64Array;
    sampleShape?: '1d-grid' | '1d-mid' | '2d-grid' | '2d-corner';
    n?: number;
    m?: number;
};

/**
 * @cache
 * 缓存目的:Worker 内只初始化一次 math_rs WASM 实例,后续请求复用.
 * 键/失效策略:模块级 Promise;永不失效.
 * 生命周期:随 Worker 实例存活.
 */
const wasmInit = init();

type IntegralComputed = {
    value: number;
    samples: Float64Array;
    sampleShape: '1d-grid' | '1d-mid' | '2d-grid' | '2d-corner';
    n: number;
    m?: number;
};

createWasmWorker<IntegralWorkerRequest, IntegralWorkerResponse>(
    wasmInit,
    (req, post) => {
        const { names: coeffNames, values: coeffValues } =
            recordToCoefficientArgs(req.coeffs);
        const result = compute(req, coeffNames, coeffValues);
        const resp: IntegralWorkerResponse = {
            id: req.id,
            value: result.value,
            samples: Float64Array.from(result.samples),
            sampleShape: result.sampleShape,
            n: result.n,
            m: result.m || undefined,
        };
        post(resp, [resp.samples!.buffer]);
    },
);

function compute(
    req: IntegralWorkerRequest,
    coeffNames: string[],
    coeffValues: Float64Array,
): IntegralComputed {
    const isLebesgue = req.method === 'lebesgue';

    if (req.dim === '1d') {
        const sampleN = isLebesgue ? req.sampleN! : req.n!;
        const layers = isLebesgue ? req.layers! : req.n!;
        const result = integrate1d(
            req.expr,
            coeffNames,
            coeffValues,
            req.a!,
            req.b!,
            sampleN,
            layers,
            req.method,
        );
        return {
            value: result.value,
            samples: Float64Array.from(result.samples),
            sampleShape: result.sample_shape as '1d-grid' | '1d-mid',
            n: result.n,
        };
    }

    const n = isLebesgue ? req.sampleN! : req.n!;
    const m = isLebesgue ? req.sampleN! : (req.m ?? req.n!);
    const layers = isLebesgue ? req.layers! : req.n!;
    const result = integrate2d(
        req.expr,
        coeffNames,
        coeffValues,
        req.xa!,
        req.xb!,
        req.ya!,
        req.yb!,
        n,
        m,
        layers,
        req.method,
    );
    return {
        value: result.value,
        samples: Float64Array.from(result.samples),
        sampleShape: result.sample_shape as '2d-grid' | '2d-corner',
        n: result.n,
        m: result.m,
    };
}
