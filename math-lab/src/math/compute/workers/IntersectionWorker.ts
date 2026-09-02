/**
 * 求交计算 Worker.
 *
 * 接收已经由 TS 适配层序列化好的对象描述符,在 Worker 内调用 Rust
 * `intersect_pair`;表达式只在 Rust 侧编译一次,后续网格/二分都复用上下文.
 */
import init, { intersect_pair } from '../../../wasm/math_rs/math_rs';
import type { IntersectionComputeSide } from '../../intersection/IntersectionMath';
import { createWasmWorker } from './wasmWorkerRuntime';

export type IntersectionWorkerRequest = {
    id: number;
    a: IntersectionComputeSide;
    b: IntersectionComputeSide;
    segments: number;
};

export type IntersectionWorkerResponse = {
    id: number;
    points?: Float64Array;
    curvePoints?: Float64Array;
    curveOffsets?: Uint32Array;
    error?: string;
};

/**
 * @cache
 * 缓存目的:Worker 内只初始化一次 math_rs WASM 实例,后续请求复用.
 * 键/失效策略:模块级 Promise;永不失效.
 * 生命周期:随 Worker 实例存活.
 */
const wasmInit = init();

function sideArgs(side: IntersectionComputeSide): [
    string,
    string,
    string[],
    Float64Array,
    Float64Array,
    Float64Array,
    Float64Array,
] {
    return [
        side.kind,
        side.expr,
        side.coefficientNames,
        new Float64Array(side.coefficientValues),
        new Float64Array(side.params),
        new Float64Array(side.matrix),
        new Float64Array(side.inverse),
    ];
}

createWasmWorker<IntersectionWorkerRequest, IntersectionWorkerResponse>(
    wasmInit,
    (request, post) => {
        const [kindA, exprA, namesA, valuesA, paramsA, matrixA, inverseA] =
            sideArgs(request.a);
        const [kindB, exprB, namesB, valuesB, paramsB, matrixB, inverseB] =
            sideArgs(request.b);
        const output = intersect_pair(
            kindA,
            exprA,
            namesA,
            valuesA,
            paramsA,
            matrixA,
            inverseA,
            kindB,
            exprB,
            namesB,
            valuesB,
            paramsB,
            matrixB,
            inverseB,
            request.segments,
        );
        const points = output.points;
        const curvePoints = output.curve_points;
        const curveOffsets = output.curve_offsets;
        post(
            {
                id: request.id,
                points,
                curvePoints,
                curveOffsets,
            },
            [points.buffer, curvePoints.buffer, curveOffsets.buffer],
        );
    },
);
