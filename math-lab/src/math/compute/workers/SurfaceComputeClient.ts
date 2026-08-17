/**
 * 曲面采样 Worker 的主线程客户端.
 * 复用通用 ComputeWorkerClient,避免重复 pending/error/dispose 逻辑.
 */
import { ComputeWorkerClient } from './ComputeWorkerClient';
import type {
    SurfaceWorkerRequest,
    SurfaceWorkerResponse,
} from './surfaceWorker';

export class SurfaceComputeClient {
    private readonly client = new ComputeWorkerClient<
        SurfaceWorkerRequest,
        SurfaceWorkerResponse
    >(() => new Worker(
        new URL('./surfaceWorker.ts', import.meta.url),
        { type: 'module' },
    ));

    request(
        request: Omit<SurfaceWorkerRequest, 'id'>,
    ): Promise<SurfaceWorkerResponse> {
        return this.client.request(request);
    }

    dispose(): void {
        this.client.dispose();
    }
}

export const surfaceComputeClient = new SurfaceComputeClient();

/**
 * 应用级释放入口.
 * 单个 SurfaceMesh 的 dispose 不应调用这里；只有确认整个应用不再需要
 * 曲面计算时才允许 terminate 这个共享 worker.
 */
export function disposeSurfaceComputeClient(): void {
    surfaceComputeClient.dispose();
}
