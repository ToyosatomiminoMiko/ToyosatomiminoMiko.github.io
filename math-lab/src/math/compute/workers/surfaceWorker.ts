import init, { sample_and_process_surface } from '../../../wasm/render_rs/render_rs';
import { createWasmWorker } from './wasmWorkerRuntime';

// ================================================================
// surfaceWorker - 曲面采样 Worker
//
// 架构流程:
//   DOM slider input
//     -> rAF dirty draw
//     -> SurfaceRenderer.draw()
//     -> SurfaceMesh.requestUpdate()
//     -> SurfaceComputeClient
//     -> surfaceWorker (本文件)
//     -> Rust/WASM sample_and_process_surface
//     -> Transferable 数组
//     -> SurfaceMesh.applyResult()
//     -> Three.js BufferGeometry
//
// 注意:顶点配色(HSL 伪彩色)已从 CPU 侧移除,改由渲染侧的顶点
// 着色器依据 position.z 与 zMin/zMax 实时计算,因此这里不再传递 colors.
// ================================================================

export type SurfaceWorkerRequest = {
    /** 请求序号,由主线程递增,用来丢弃过期结果 */
    id: number;
    expr: string;
    coeffNames: string[];
    coeffValues: number[];
    xMin: number;
    xMax: number;
    yMin: number;
    yMax: number;
    cols: number;
    rows: number;
};

export type SurfaceWorkerResponse = {
    id: number;
    positions: Float32Array;
    normals: Float32Array;
    validIndices: Uint32Array;
    zMin: number;
    zMax: number;
    error?: string;
};

/**
 * @cache
 * 缓存目的:Worker 内只初始化一次 render_rs WASM 实例,后续请求复用.
 * 键/失效策略:模块级 Promise;永不失效.
 * 生命周期:随 Worker 实例存活.
 */
const wasmReady = init();

createWasmWorker<SurfaceWorkerRequest, SurfaceWorkerResponse>(
    wasmReady,
    (req, post) => {
        // Worker 收到的普通数组先转成 WASM 期望的 Float64Array
        const coeffValues = new Float64Array(req.coeffValues);
        const result = sample_and_process_surface(
            req.expr,
            req.coeffNames,
            coeffValues,
            req.xMin,
            req.xMax,
            req.yMin,
            req.yMax,
            req.cols,
            req.rows,
        );

        // 先取出所有副本,再释放 WASM 端对象
        const positions = result.positions;
        const normals = result.normals;
        const validIndices = result.valid_indices;
        const zMin = result.z_min;
        const zMax = result.z_max;
        result.free();

        const response: SurfaceWorkerResponse = {
            id: req.id,
            positions,
            normals,
            validIndices,
            zMin,
            zMax,
        };

        // 用 Transferable 传回主线程,避免结构化克隆再复制一遍大数组
        post(response, [
            positions.buffer,
            normals.buffer,
            validIndices.buffer,
        ]);
    },
);
