/**
 * GPU 侧打点 -- 用 timestamp-query 量三条 pass 各自真正花在 GPU 上的时间.
 *
 * 441 的帧是 rAF 驱动的, GPU 工作是异步的: 主线程再空转, 也不能说明 GPU 不忙.
 * 所以"主线程 ScriptDuration 只有 18ms"这种结论根本回答不了"机箱为什么烫".
 * 这里补上 GPU 侧的那一半观测.
 *
 * 只有适配器支持 'timestamp-query' 时才建得起来(软件适配器 / 部分驱动没有),
 * 因此整块是可选的: 不支持就返回 null, 调用方不需要额外分支.
 *
 * 每帧打 4 个点 = 3 段:
 *   t0 计算之前 -> t1 计算之后 -> t2 粒子绘制之后 -> t3 合成之后
 */
import type { GpuPassTimings } from './stats';
import {
    BYTES_PER_TIMESTAMP,
    MARKS_PER_FRAME,
    NS_PER_MS,
    SLOT_COUNT,
    TIMESTAMP_BUFFER_SIZE,
    TIMESTAMP_QUERY_LABEL,
    TIMESTAMP_READ_LABEL,
    TIMESTAMP_RESOLVE_LABEL,
    ZERO_READS_BEFORE_GIVING_UP,
} from './gpu_timing.config';

export function isGpuTimingSupported(device: GPUDevice): boolean {
    return device.features.has('timestamp-query');
}

export function createGpuTimer(device: GPUDevice): GpuTimer | null {
    return isGpuTimingSupported(device) ? new GpuTimer(device) : null;
}

export class GpuTimer {
    private readonly querySet: GPUQuerySet;
    private readonly resolveBuffer: GPUBuffer;
    private readonly readBuffer: GPUBuffer;
    private frameIndex = 0;
    private reading = false;
    private zeroReads = 0;
    private gaveUp = false;
    private last: GpuPassTimings | null = null;

    constructor(device: GPUDevice) {
        this.querySet = device.createQuerySet({
            label: TIMESTAMP_QUERY_LABEL,
            type: 'timestamp',
            count: SLOT_COUNT,
        });
        this.resolveBuffer = device.createBuffer({
            label: TIMESTAMP_RESOLVE_LABEL,
            size: TIMESTAMP_BUFFER_SIZE,
            usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
        });
        this.readBuffer = device.createBuffer({
            label: TIMESTAMP_READ_LABEL,
            size: TIMESTAMP_BUFFER_SIZE,
            usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
        });
    }

    /** 最近一次成功读回的耗时; 还没读到过 (或后端只会返回 0) 就是 null */
    get timings(): GpuPassTimings | null {
        return this.last;
    }

    /** 是否已经判定"这个后端测不出 GPU 时间" */
    get unavailable(): boolean {
        return this.gaveUp;
    }

    /** 一帧开始时取号, 返回本帧 4 个时间戳的起始槽位 */
    beginFrame(): number {
        const base = (this.frameIndex % 2) * MARKS_PER_FRAME;
        this.frameIndex += 1;
        return base;
    }

    /** 在录制命令时打一个点; 已经判定测不出来之后就完全不碰 querySet 了 */
    mark(encoder: GPUCommandEncoder, slot: number): void {
        if (this.gaveUp) return;
        encoder.writeTimestamp(this.querySet, slot);
    }

    /**
     * 录制收尾: 把本帧 4 个点解析出来并异步读回.
     * 上一帧还没读完就跳过本帧的读回 -- 统计永远不能拖住提交.
     */
    endFrame(encoder: GPUCommandEncoder, base: number): void {
        if (this.gaveUp) return;

        encoder.resolveQuerySet(this.querySet, base, MARKS_PER_FRAME, this.resolveBuffer, 0);
        encoder.copyBufferToBuffer(
            this.resolveBuffer,
            0,
            this.readBuffer,
            base * BYTES_PER_TIMESTAMP,
            MARKS_PER_FRAME * BYTES_PER_TIMESTAMP
        );

        if (this.reading) return;
        this.reading = true;
        const offset = base * BYTES_PER_TIMESTAMP;
        this.readBuffer
            .mapAsync(GPUMapMode.READ, offset, MARKS_PER_FRAME * BYTES_PER_TIMESTAMP)
            .then(() => {
                const view = new BigUint64Array(
                    this.readBuffer.getMappedRange(offset, MARKS_PER_FRAME * BYTES_PER_TIMESTAMP)
                );
                const t0 = view[0] ?? 0n;
                const t1 = view[1] ?? 0n;
                const t2 = view[2] ?? 0n;
                const t3 = view[3] ?? 0n;
                const ms = (a: bigint, b: bigint): number => Number(b - a) / NS_PER_MS;
                const total = ms(t0, t3);
                // 软件适配器(swiftshader / lavapipe)常常交回全 0 的时间戳.
                // 与其把"0.00ms"当成"不花钱", 不如承认测不到.
                if (total <= 0) {
                    this.zeroReads += 1;
                    if (this.zeroReads >= ZERO_READS_BEFORE_GIVING_UP) {
                        this.last = null;
                        this.gaveUp = true;
                    }
                    return;
                }
                this.zeroReads = 0;
                this.last = {
                    compute: ms(t0, t1),
                    particle: ms(t1, t2),
                    composite: ms(t2, t3),
                    total,
                };
            })
            .catch(() => {
                /* 设备丢失 / 读回失败: 统计不是关键路径, 直接放弃这一帧 */
            })
            .finally(() => {
                try {
                    this.readBuffer.unmap();
                } catch {
                    /* 已经丢失的设备上 unmap 可能抛错 */
                }
                this.reading = false;
            });
    }

    destroy(): void {
        this.gaveUp = true;
        // 可能还有一次 mapAsync 挂在半路, 销毁失败不该影响页面收尾
        try {
            this.querySet.destroy();
            this.resolveBuffer.destroy();
            this.readBuffer.destroy();
        } catch {
            /* 设备已丢失时 destroy 可能抛错 */
        }
        this.last = null;
    }
}
