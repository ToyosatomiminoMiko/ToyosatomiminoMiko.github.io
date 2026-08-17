/**
 * 曲线采样 Worker 的主线程客户端.
 * 曲线采样原先直接在主线程调用 WASM,这里改为与其他计算一致的 Worker 路径.
 */
import { ComputeWorkerClient } from './ComputeWorkerClient';
import type {
    CurveWorkerRequest,
    CurveWorkerResponse,
} from './curveWorker';

export class CurveComputeClient {
    private readonly client = new ComputeWorkerClient<
        CurveWorkerRequest,
        CurveWorkerResponse
    >(() => new Worker(
        new URL('./curveWorker.ts', import.meta.url),
        { type: 'module' },
    ));

    request(
        request: Omit<CurveWorkerRequest, 'id'>,
    ): Promise<Float32Array> {
        return this.client.request(request).then((response) => response.points);
    }

    dispose(): void {
        this.client.dispose();
    }
}

export const curveComputeClient = new CurveComputeClient();

/**
 * 应用级释放入口.
 * 单个 CurveRenderer 的 dispose 不应调用这里；只有确认整个应用不再需要
 * 曲线采样时才允许 terminate 这个共享 worker.
 */
export function disposeCurveComputeClient(): void {
    curveComputeClient.dispose();
}
