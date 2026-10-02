/**
 * GPU 侧打点 -- 用 timestamp-query 量三条 pass 各自真正花在 GPU 上的时间.
 *
 * 451 的帧是 rAF 驱动的, GPU 工作是异步的: 主线程再空转, 也不能说明 GPU 不忙.
 * 所以"主线程 ScriptDuration 只有 18ms"这种结论根本回答不了"机箱为什么烫".
 * 这里补上 GPU 侧的那一半观测.
 *
 * 是否启用由调用方决定: acquireGpuContext() 已经把"设备有没有 timestamp-query"
 * 算成 GpuContext.timestampQuery 带出来了, 这里只负责在支持时把计时器建起来,
 * 不再自己 probe 一遍设备特性.
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

/** 前提: 设备已带上 timestamp-query(调用方按 GpuContext.timestampQuery 判断) */
export function createGpuTimer(device: GPUDevice): GpuTimer {
    return new GpuTimer(device);
}

export class GpuTimer {
    private readonly querySet: GPUQuerySet;
    private readonly resolveBuffer: GPUBuffer;
    private readonly readBuffer: GPUBuffer;
    private frameIndex = 0;
    private reading = false;
    /** 已录进命令缓冲,等提交后读回的偏移;null = 这一帧没有待读的拷贝 */
    private pendingReadOffset: number | null = null;
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
     * 录制收尾: resolve 本帧 4 个点, 并把它们拷进读回缓冲.
     *
     * **不在这里 mapAsync**: mapAsync 要在命令缓冲**提交之后**调用(见 afterSubmit).
     * 反过来的话, 这次拷贝还没提交, mapAsync 立刻就能把缓冲 map 上, 紧接着的
     * submit 就会撞上 GPU 校验错误 `[Buffer "..."] used in submit while mapped`.
     *
     * 上一帧的读回还没结束(reading)时整帧跳过:读回缓冲此刻仍是 mapped, 再录一次
     * 写它的拷贝同样非法; 那一帧的读数本来也交不回来.
     */
    endFrame(encoder: GPUCommandEncoder, base: number): void {
        if (this.gaveUp) return;
        if (this.reading) return;

        encoder.resolveQuerySet(this.querySet, base, MARKS_PER_FRAME, this.resolveBuffer, 0);
        const offset = base * BYTES_PER_TIMESTAMP;
        encoder.copyBufferToBuffer(
            this.resolveBuffer,
            0,
            this.readBuffer,
            offset,
            MARKS_PER_FRAME * BYTES_PER_TIMESTAMP
        );
        this.pendingReadOffset = offset;
    }

    /**
     * 命令缓冲提交之后调:把刚拷进读回缓冲的 4 个点读回 CPU.
     *
     * 时机是硬约束, 不是风格问题 -- 见 endFrame 的说明.
     */
    afterSubmit(): void {
        const offset = this.pendingReadOffset;
        this.pendingReadOffset = null;
        if (this.gaveUp || this.reading || offset === null) return;

        this.reading = true;
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
