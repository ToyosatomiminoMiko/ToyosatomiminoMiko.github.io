/**
 * 积分计算 Worker.
 * 采样/求值与积分值计算全部由 Rust/WASM 完成,不再使用外部 JS 数学库.
 *
 * 维度语义:请求带显式 `dim`('1d'|'2d'|'3d')与 `domainKind`
 * (interval/rectangle/region/solid),按域路由到 Rust 的
 * integrate1d/integrate2d/integrate_region/integrate_solid 入口;
 * 不再用 range 长度推断维度.
 */
import init, {
    integrate1d,
    integrate2d,
    integrate_region,
    integrate_solid,
} from "../../../wasm/math_rs/math_rs";
import type { IntegralDomainKind, IntegralMethod } from '../../../compiler/ir/types';
import { recordToCoefficientArgs } from '../../coefficientUtils';
import { createWasmWorker } from './wasmWorkerRuntime';

export type IntegralBoundaryDesc = {
    expr: string;
    coeffs: Record<string, number>;
};

export type IntegralSolidDesc = {
    kind: 'sphere' | 'box' | 'conic';
    params: number[];
    matrix: number[];
    inverse: number[];
};

export type IntegralWorkerRequest = {
    id: number;
    /**
     * 语义方法名,与 IR `IntegralMethod` 及 Rust parse 名单保持一致;
     * 维度/域由 `dim` 与 `domainKind` 显式给出.
     */
    method: IntegralMethod;
    dim: '1d' | '2d' | '3d';
    domainKind: IntegralDomainKind;
    /** 被积函数(世界坐标变量). */
    integrandExpr: string;
    integrandCoeffs: Record<string, number>;
    /** interval 域. */
    a?: number;
    b?: number;
    /** rectangle / region 域(region 只用 x 分量). */
    xa?: number;
    xb?: number;
    ya?: number;
    yb?: number;
    /** region 域的两条边界曲线. */
    boundaryA?: IntegralBoundaryDesc;
    boundaryB?: IntegralBoundaryDesc;
    /** solid 域描述符. */
    solid?: IntegralSolidDesc;
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
    sampleShape?:
        | '1d-grid'
        | '1d-mid'
        | '2d-grid'
        | '2d-corner'
        | '2d-corner-right'
        | '2d-mid2'
        | '2d-cell'
        | '3d-cells'
        | '3d-skip';
    n?: number;
    m?: number;
    /** 采样外接范围(Rust 回传;region 的 y 区间/solid 的 AABB). */
    xa?: number;
    xb?: number;
    ya?: number;
    yb?: number;
    za?: number;
    zb?: number;
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
    sampleShape: NonNullable<IntegralWorkerResponse['sampleShape']>;
    n: number;
    m?: number;
    xa?: number;
    xb?: number;
    ya?: number;
    yb?: number;
    za?: number;
    zb?: number;
};

createWasmWorker<IntegralWorkerRequest, IntegralWorkerResponse>(
    wasmInit,
    (req, post) => {
        const { names: integrandNames, values: integrandValues } =
            recordToCoefficientArgs(req.integrandCoeffs);
        const result = compute(req, integrandNames, integrandValues);
        const resp: IntegralWorkerResponse = {
            id: req.id,
            value: result.value,
            samples: Float64Array.from(result.samples),
            sampleShape: result.sampleShape,
            n: result.n,
            m: result.m || undefined,
            xa: result.xa,
            xb: result.xb,
            ya: result.ya,
            yb: result.yb,
            za: result.za,
            zb: result.zb,
        };
        post(resp, [resp.samples!.buffer]);
    },
);

function compute(
    req: IntegralWorkerRequest,
    integrandNames: string[],
    integrandValues: Float64Array,
): IntegralComputed {
    const isLebesgue = req.method === 'lebesgue';

    if (req.domainKind === 'interval') {
        const sampleN = isLebesgue ? req.sampleN! : req.n!;
        const layers = isLebesgue ? req.layers! : req.n!;
        const result = integrate1d(
            req.integrandExpr,
            integrandNames,
            integrandValues,
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
            xa: result.xa,
            xb: result.xb,
        };
    }

    if (req.domainKind === 'rectangle') {
        const n = isLebesgue ? req.sampleN! : req.n!;
        const m = isLebesgue ? req.sampleN! : (req.m ?? req.n!);
        const layers = isLebesgue ? req.layers! : req.n!;
        const result = integrate2d(
            req.integrandExpr,
            integrandNames,
            integrandValues,
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
            sampleShape: result.sample_shape as
                | '2d-grid'
                | '2d-corner'
                | '2d-corner-right'
                | '2d-mid2',
            n: result.n,
            m: result.m,
            xa: result.xa,
            xb: result.xb,
            ya: result.ya,
            yb: result.yb,
        };
    }

    if (req.domainKind === 'region') {
        const n = isLebesgue ? req.sampleN! : req.n!;
        const layers = isLebesgue ? req.layers! : req.n!;
        const a = recordToCoefficientArgs(req.boundaryA!.coeffs);
        const b = recordToCoefficientArgs(req.boundaryB!.coeffs);
        const result = integrate_region(
            req.method,
            req.integrandExpr,
            integrandNames,
            integrandValues,
            req.boundaryA!.expr,
            a.names,
            a.values,
            req.boundaryB!.expr,
            b.names,
            b.values,
            req.xa!,
            req.xb!,
            n,
            layers,
        );
        return {
            value: result.value,
            samples: Float64Array.from(result.samples),
            sampleShape: '2d-cell',
            n: result.n,
            m: result.m,
            xa: result.xa,
            xb: result.xb,
            ya: result.ya,
            yb: result.yb,
        };
    }

    // solid
    const n = isLebesgue ? req.sampleN! : req.n!;
    const layers = isLebesgue ? req.layers! : req.n!;
    const solid = req.solid!;
    const result = integrate_solid(
        req.method,
        solid.kind,
        new Float64Array(solid.params),
        new Float64Array(solid.matrix),
        new Float64Array(solid.inverse),
        req.integrandExpr,
        integrandNames,
        integrandValues,
        n,
        layers,
    );
    return {
        value: result.value,
        samples: Float64Array.from(result.samples),
        sampleShape: result.sample_shape as '3d-cells' | '3d-skip',
        n: result.n,
        m: result.m,
        xa: result.xa,
        xb: result.xb,
        ya: result.ya,
        yb: result.yb,
        za: result.za,
        zb: result.zb,
    };
}
