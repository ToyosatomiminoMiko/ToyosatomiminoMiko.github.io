/**
 * 曲面采样 Worker 的主线程客户端。
 * 复用通用 ComputeWorkerClient，避免重复 pending/error/dispose 逻辑。
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
