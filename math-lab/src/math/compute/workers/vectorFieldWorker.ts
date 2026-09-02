import init, { sample_vector_field } from '../../../wasm/math_rs/math_rs';
import { createWasmWorker } from './wasmWorkerRuntime';

export type VectorFieldWorkerRequest = {
    id: number;
    pExpr: string;
    qExpr: string;
    rExpr: string;
    coeffNames: string[];
    coeffValues: number[];
    range: {
        x: [number, number];
        y: [number, number];
        z: [number, number];
    };
    gridSize: [number, number, number];
};

export type VectorFieldWorkerResponse = {
    id: number;
    vectors: Float32Array;
    error?: string;
};

/**
 * @cache
 * 缓存目的:Worker 内只初始化一次 math_rs WASM 实例,后续请求复用.
 * 键/失效策略:模块级 Promise;永不失效.
 * 生命周期:随 Worker 实例存活.
 */
const wasmInit = init();

createWasmWorker<VectorFieldWorkerRequest, VectorFieldWorkerResponse>(
    wasmInit,
    (req, post) => {
        const vectors = sample_vector_field(
            req.pExpr,
            req.qExpr,
            req.rExpr,
            req.coeffNames,
            new Float64Array(req.coeffValues),
            req.range.x[0],
            req.range.x[1],
            req.range.y[0],
            req.range.y[1],
            req.range.z[0],
            req.range.z[1],
            req.gridSize[0],
            req.gridSize[1],
            req.gridSize[2],
        );
        post({ id: req.id, vectors }, [vectors.buffer]);
    },
);
