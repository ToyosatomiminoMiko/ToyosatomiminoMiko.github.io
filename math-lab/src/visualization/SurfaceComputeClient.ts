import type {
    SurfaceWorkerRequest,
    SurfaceWorkerResponse,
} from './surfaceWorker';

// ================================================================
// SurfaceComputeClient — 主线程与曲面采样 Worker 之间的桥
//
// 架构流程:
//   SurfaceMesh.requestUpdate()
//     -> SurfaceComputeClient.request()
//     -> Worker.postMessage(request)
//     -> Worker 计算并 postMessage(Transferable response)
//     -> SurfaceComputeClient 按 id resolve
//     -> SurfaceMesh.applyResult()
//
// 说明:
// - 全局共享一个 Worker,避免每个曲面都创建一个 Worker
// - request id 由客户端递增,主线程在 SurfaceMesh 中只认最新 id
// ================================================================

type PendingRequest = {
    resolve: (response: SurfaceWorkerResponse) => void;
    reject: (error: Error) => void;
};

export class SurfaceComputeClient {
    private _worker: Worker | null = null;
    private _pending = new Map<number, PendingRequest>();
    private _nextId = 0;

    /**
     * 请求一次曲面采样
     *
     * @param request 除 id 之外的采样参数
     */
    request(
        request: Omit<SurfaceWorkerRequest, 'id'>,
    ): Promise<SurfaceWorkerResponse> {
        const id = ++this._nextId;

        return new Promise<SurfaceWorkerResponse>((resolve, reject) => {
            this._pending.set(id, { resolve, reject });

            const worker = this._getWorker();
            worker.postMessage({ ...request, id });
        });
    }

    /** 页面关闭或应用销毁时终止 Worker */
    dispose(): void {
        this._worker?.terminate();
        this._worker = null;

        const error = new Error('Surface compute worker disposed');
        for (const pending of this._pending.values()) {
            pending.reject(error);
        }
        this._pending.clear();
    }

    private _getWorker(): Worker {
        if (this._worker) return this._worker;

        // Vite 支持用 new URL(..., import.meta.url) 显式打包 Worker 入口
        this._worker = new Worker(
            new URL('./surfaceWorker.ts', import.meta.url),
            { type: 'module' },
        );

        this._worker.onmessage = (
            event: MessageEvent<SurfaceWorkerResponse>,
        ) => {
            this._handleMessage(event.data);
        };

        this._worker.onerror = (event: ErrorEvent) => {
            const error = new Error(
                event.message || 'Surface worker failed',
            );
            for (const pending of this._pending.values()) {
                pending.reject(error);
            }
            this._pending.clear();

            // 终止坏掉的 Worker,下一次请求会重新创建
            if (this._worker) {
                this._worker.terminate();
                this._worker = null;
            }
        };

        return this._worker;
    }

    private _handleMessage(response: SurfaceWorkerResponse): void {
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

/** 全局共享客户端,所有 SurfaceMesh 实例复用一个 Worker */
export const surfaceComputeClient = new SurfaceComputeClient();
