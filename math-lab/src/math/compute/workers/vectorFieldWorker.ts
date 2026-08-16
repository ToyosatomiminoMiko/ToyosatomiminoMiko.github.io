import init, { sample_vector_field } from '../../../wasm/math_rs/math_rs';

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

const workerScope = self as unknown as {
    onmessage: ((event: MessageEvent<VectorFieldWorkerRequest>) => void) | null;
    postMessage(message: VectorFieldWorkerResponse, transfer?: Transferable[]): void;
};

const wasmInit = init();

workerScope.onmessage = async (event: MessageEvent<VectorFieldWorkerRequest>) => {
    const req = event.data;

    try {
        await wasmInit;
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
        workerScope.postMessage({ id: req.id, vectors }, [vectors.buffer]);
    } catch (error) {
        workerScope.postMessage({
            id: req.id,
            vectors: new Float32Array(0),
            error: error instanceof Error ? error.message : String(error),
        });
    }
};
