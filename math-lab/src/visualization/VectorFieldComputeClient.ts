import type {
    VectorFieldWorkerRequest,
    VectorFieldWorkerResponse,
} from './vectorFieldWorker';

type PendingRequest = {
    resolve: (vectors: Float32Array) => void;
    reject: (error: Error) => void;
};

/**
 * 向量场采样 Worker 的主线程客户端.
 *
 * 与曲面采样一样,全局共享一个 Worker,拖动参数时只发送采样参数,
 * 由 Worker 完成表达式求值,避免大网格卡住主线程.
 */
export class VectorFieldComputeClient {
    private _worker: Worker | null = null;
    private _pending = new Map<number, PendingRequest>();
    private _nextId = 0;

    request(
        request: Omit<VectorFieldWorkerRequest, 'id'>,
    ): Promise<Float32Array> {
        const id = ++this._nextId;

        return new Promise<Float32Array>((resolve, reject) => {
            this._pending.set(id, { resolve, reject });
            this._getWorker().postMessage({ ...request, id });
        });
    }

    dispose(): void {
        this._worker?.terminate();
        this._worker = null;

        const error = new Error('Vector field worker disposed');
        for (const pending of this._pending.values()) {
            pending.reject(error);
        }
        this._pending.clear();
    }

    private _getWorker(): Worker {
        if (this._worker) return this._worker;

        this._worker = new Worker(
            new URL('./vectorFieldWorker.ts', import.meta.url),
            { type: 'module' },
        );

        this._worker.onmessage = (
            event: MessageEvent<VectorFieldWorkerResponse>,
        ) => {
            this._handleMessage(event.data);
        };

        this._worker.onerror = (event: ErrorEvent) => {
            const error = new Error(event.message || 'Vector field worker failed');
            for (const pending of this._pending.values()) {
                pending.reject(error);
            }
            this._pending.clear();

            this._worker?.terminate();
            this._worker = null;
        };

        return this._worker;
    }

    private _handleMessage(response: VectorFieldWorkerResponse): void {
        const pending = this._pending.get(response.id);
        if (!pending) return;

        this._pending.delete(response.id);
        if (response.error) {
            pending.reject(new Error(response.error));
            return;
        }
        pending.resolve(response.vectors);
    }
}

export const vectorFieldComputeClient = new VectorFieldComputeClient();
