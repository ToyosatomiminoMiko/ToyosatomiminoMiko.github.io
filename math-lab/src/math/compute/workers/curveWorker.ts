import init, { sample_curve } from '../../../wasm/math_rs/math_rs';

export type CurveWorkerRequest = {
    id: number;
    expr: string;
    coeffNames: string[];
    coeffValues: number[];
    range: [number, number];
    segments: number;
};

export type CurveWorkerResponse = {
    id: number;
    points: Float32Array;
    error?: string;
};

const workerScope = self as unknown as {
    onmessage: ((event: MessageEvent<CurveWorkerRequest>) => void) | null;
    postMessage(message: CurveWorkerResponse, transfer?: Transferable[]): void;
};

const wasmInit = init();

workerScope.onmessage = async (event: MessageEvent<CurveWorkerRequest>) => {
    const req = event.data;

    try {
        await wasmInit;
        const points = sample_curve(
            req.expr,
            req.coeffNames,
            new Float64Array(req.coeffValues),
            req.range[0],
            req.range[1],
            req.segments,
        );
        workerScope.postMessage({ id: req.id, points }, [points.buffer]);
    } catch (error) {
        workerScope.postMessage({
            id: req.id,
            points: new Float32Array(0),
            error: error instanceof Error ? error.message : String(error),
        });
    }
};
