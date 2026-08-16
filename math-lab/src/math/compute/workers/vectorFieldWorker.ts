import { parse } from 'mathjs';
import { sampleVectorField } from '../../objects/VectorField';
import type { Coefficient } from '../../../compiler/ir/types';

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

workerScope.onmessage = (event: MessageEvent<VectorFieldWorkerRequest>) => {
    const req = event.data;

    try {
        const nodes = {
            P: parse(req.pExpr),
            Q: parse(req.qExpr),
            R: parse(req.rExpr),
        };
        const coefficients: Coefficient[] = req.coeffNames.map((name, index) => ({
            name,
            value: req.coeffValues[index] ?? 0,
            min: -10,
            max: 10,
            step: 0.1,
        }));

        const vectors = sampleVectorField(nodes, coefficients, req.range, req.gridSize);
        workerScope.postMessage({ id: req.id, vectors }, [vectors.buffer]);
    } catch (error) {
        workerScope.postMessage({
            id: req.id,
            vectors: new Float32Array(0),
            error: error instanceof Error ? error.message : String(error),
        });
    }
};
