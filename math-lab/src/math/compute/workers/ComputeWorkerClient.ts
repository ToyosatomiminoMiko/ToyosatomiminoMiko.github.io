/**
 * 通用 Worker 客户端.
 * 负责 pending map、请求 id、Worker 创建/销毁和错误传播,
 * 供 Surface、VectorField、Integral 等计算 Worker 复用.
 */
type PendingRequest<TResponse> = {
    resolve: (response: TResponse) => void;
    reject: (error: Error) => void;
};

export type ComputeWorkerMessage<TResponse> = TResponse & {
    id: number;
    error?: string;
};

export class ComputeWorkerClient<
    TRequest extends { id: number },
    TResponse extends { error?: string },
> {
    private _worker: Worker | null = null;
    private readonly _pending = new Map<number, PendingRequest<TResponse>>();
    private _nextId = 0;

    constructor(private readonly workerFactory: () => Worker) {}

    request(request: Omit<TRequest, 'id'>): Promise<TResponse> {
        const id = ++this._nextId;
        return new Promise<TResponse>((resolve, reject) => {
            this._pending.set(id, { resolve, reject });
            this._getWorker().postMessage({ ...request, id });
        });
    }

    dispose(): void {
        this._worker?.terminate();
        this._worker = null;

        const error = new Error('Compute worker disposed');
        for (const pending of this._pending.values()) {
            pending.reject(error);
        }
        this._pending.clear();
    }

    private _getWorker(): Worker {
        if (this._worker) return this._worker;

        this._worker = this.workerFactory();
        this._worker.onmessage = (event: MessageEvent<ComputeWorkerMessage<TResponse>>) => {
            this._handleMessage(event.data);
        };
        this._worker.onerror = (event: ErrorEvent) => {
            const error = new Error(event.message || 'Compute worker failed');
            for (const pending of this._pending.values()) {
                pending.reject(error);
            }
            this._pending.clear();

            this._worker?.terminate();
            this._worker = null;
        };

        return this._worker;
    }

    private _handleMessage(response: ComputeWorkerMessage<TResponse>): void {
        const pending = this._pending.get(response.id);
        if (!pending) return;

        this._pending.delete(response.id);
        if (response.error) {
            pending.reject(new Error(response.error));
            return;
        }
        pending.resolve(response);
    }
}
