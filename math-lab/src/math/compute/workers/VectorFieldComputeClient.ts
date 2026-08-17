/**
 * 向量场采样 Worker 的主线程客户端.
 * 复用通用 ComputeWorkerClient,避免重复 pending/error/dispose 逻辑.
 */
import { ComputeWorkerClient } from './ComputeWorkerClient';
import type {
    VectorFieldWorkerRequest,
    VectorFieldWorkerResponse,
} from './vectorFieldWorker';

export class VectorFieldComputeClient {
    private readonly client = new ComputeWorkerClient<
        VectorFieldWorkerRequest,
        VectorFieldWorkerResponse
    >(() => new Worker(
        new URL('./vectorFieldWorker.ts', import.meta.url),
        { type: 'module' },
    ));

    request(
        request: Omit<VectorFieldWorkerRequest, 'id'>,
    ): Promise<Float32Array> {
        return this.client.request(request).then((response) => response.vectors);
    }

    dispose(): void {
        this.client.dispose();
    }
}

export const vectorFieldComputeClient = new VectorFieldComputeClient();

/**
 * 应用级释放入口.
 * 单个 VectorFieldRenderer 的 dispose 不应调用这里；只有确认整个应用不再
 * 需要向量场计算时才允许 terminate 这个共享 worker.
 */
export function disposeVectorFieldComputeClient(): void {
    vectorFieldComputeClient.dispose();
}
