import init, { sample_and_process_surface } from '../../../wasm/ml_wasm';

// ================================================================
// surfaceWorker — 曲面采样 Worker
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
    colors: Float32Array;
    normals: Float32Array;
    validIndices: Uint32Array;
    zMin: number;
    zMax: number;
    error?: string;
};

// 只初始化一次,所有后续请求共享同一个 WASM 实例
const wasmReady = init();

// 在 Worker 环境中 self 的类型与 DOM Window 不同,这里收窄为需要的接口
const workerScope = self as unknown as {
    onmessage: ((event: MessageEvent<SurfaceWorkerRequest>) => void) | null;
    postMessage(message: SurfaceWorkerResponse, transfer?: Transferable[]): void;
};

workerScope.onmessage = async (event: MessageEvent<SurfaceWorkerRequest>) => {
    const req = event.data;

    try {
        await wasmReady;

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
        const colors = result.colors;
        const normals = result.normals;
        const validIndices = result.valid_indices;
        const zMin = result.z_min;
        const zMax = result.z_max;
        result.free();

        const response: SurfaceWorkerResponse = {
            id: req.id,
            positions,
            colors,
            normals,
            validIndices,
            zMin,
            zMax,
        };

        // 用 Transferable 传回主线程,避免结构化克隆再复制一遍大数组
        workerScope.postMessage(response, [
            positions.buffer,
            colors.buffer,
            normals.buffer,
            validIndices.buffer,
        ]);
    } catch (error) {
        workerScope.postMessage({
            id: req.id,
            positions: new Float32Array(0),
            colors: new Float32Array(0),
            normals: new Float32Array(0),
            validIndices: new Uint32Array(0),
            zMin: 0,
            zMax: 0,
            error: (error as Error).message,
        });
    }
};
