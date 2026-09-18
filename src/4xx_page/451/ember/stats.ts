/**
 * 帧统计 -- 纯逻辑, 不碰 DOM/GPU, 因此可以直接单测.
 *
 * 451 的性能症状是"机箱起飞"而不是"画面卡": 主线程几乎没有活干, 帧却出不来.
 * 所以这里刻意同时记两件事, 好把责任分清楚:
 *
 *   interval -- 两次 rAF 的间隔.它被拉长说明瓶颈在 合成 / 光栅 / GPU, 而不在 JS.
 *   cpu      -- 本帧真正花在 JS 里的时间(写 uniform + 录制 + 提交).
 *
 * 两者之比 cpuShare 一眼就能看出"主线程到底占多少": 接近 0 就说明再怎么优化
 * JS 也没用, 该去动填充率,CSS 特效和帧率上限.
 */
import { MS_PER_SECOND } from './config';
import {
    STATS_CAPACITY,
    STATS_CATCHUP_DIGITS,
    STATS_CPU_SHARE_DIGITS,
    STATS_CPU_SHARE_PERCENT_DIGITS,
    STATS_DISTRIBUTION_DIGITS,
    STATS_FPS_DIGITS,
    STATS_PERCENTILE_P50,
    STATS_PERCENTILE_P95,
    STATS_STEPS_DIGITS,
} from './stats.config';

export interface FrameSample {
    /** 距上一帧的 rAF 间隔(ms); 首帧(<= 0)会被忽略 */
    interval: number;
    /** 本帧主线程耗时(ms) */
    cpu: number;
    /** 本帧执行的固定仿真步数 */
    steps: number;
    /** 本帧三条 pass 的 GPU 耗时(ms); 适配器不支持 timestamp-query 时为 undefined */
    gpu?: GpuPassTimings;
}

/** 三条 pass 的 GPU 耗时(ms) */
export interface GpuPassTimings {
    compute: number;
    particle: number;
    composite: number;
    total: number;
}

export interface Distribution {
    avg: number;
    p50: number;
    p95: number;
    max: number;
}

export interface FrameStatsSnapshot {
    /** 参与统计的帧数 */
    frames: number;
    /** 统计窗口内的平均帧率 */
    fps: number;
    interval: Distribution;
    cpu: Distribution;
    /** 平均每帧仿真步数, 以及需要补步(> 1)的帧占比 */
    steps: { avg: number; catchUp: number };
    /** 主线程耗时 / 帧间隔, 越接近 0 越说明瓶颈不在 JS */
    cpuShare: number;
    /** 最近一次拿到的 GPU pass 耗时 */
    gpu: GpuPassTimings | null;
}

/**
 * 最近秩(nearest-rank)分位: 返回"第 ceil(q * n) 小"的样本.
 * 样本量小的时候它比插值更贴近"实际发生过的最坏帧", 正合打点的用途.
 */
function percentile(sorted: Float64Array, count: number, q: number): number {
    if (count === 0) return 0;
    const index = Math.min(count - 1, Math.max(0, Math.ceil(q * count) - 1));
    return sorted[index] ?? 0;
}

function round(value: number, digits = STATS_DISTRIBUTION_DIGITS): number {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
}

function summarize(values: Float64Array, count: number): Distribution {
    if (count === 0) return { avg: 0, p50: 0, p95: 0, max: 0 };
    let sum = 0;
    let max = 0;
    for (let i = 0; i < count; i++) {
        sum += values[i] ?? 0;
        if ((values[i] ?? 0) > max) max = values[i] ?? 0;
    }
    const sorted = values.slice(0, count).sort();
    return {
        avg: round(sum / count),
        p50: round(percentile(sorted, count, STATS_PERCENTILE_P50)),
        p95: round(percentile(sorted, count, STATS_PERCENTILE_P95)),
        max: round(max),
    };
}

export class FrameStats {
    private readonly interval: Float64Array;
    private readonly cpu: Float64Array;
    private count = 0;
    private cursor = 0;
    private stepSum = 0;
    private catchUpFrames = 0;
    private lastGpu: GpuPassTimings | null = null;

    constructor(private readonly capacity: number = STATS_CAPACITY) {
        this.interval = new Float64Array(capacity);
        this.cpu = new Float64Array(capacity);
    }

    record(sample: FrameSample): void {
        // 首帧没有"上一帧", interval 由调用方给 0
        if (!(sample.interval > 0)) return;

        this.interval[this.cursor] = sample.interval;
        this.cpu[this.cursor] = Math.max(0, sample.cpu);
        this.cursor = (this.cursor + 1) % this.capacity;
        if (this.count < this.capacity) this.count += 1;
        this.stepSum += sample.steps;
        if (sample.steps > 1) this.catchUpFrames += 1;
        if (sample.gpu) this.lastGpu = sample.gpu;
    }

    reset(): void {
        this.count = 0;
        this.cursor = 0;
        this.stepSum = 0;
        this.catchUpFrames = 0;
        this.lastGpu = null;
    }

    snapshot(): FrameStatsSnapshot {
        const interval = summarize(this.interval, this.count);
        const cpu = summarize(this.cpu, this.count);
        const frames = this.count;
        return {
            frames,
            fps: interval.avg > 0 ? round(MS_PER_SECOND / interval.avg, STATS_FPS_DIGITS) : 0,
            interval,
            cpu,
            steps: {
                avg: frames ? round(this.stepSum / frames, STATS_STEPS_DIGITS) : 0,
                catchUp: frames ? round(this.catchUpFrames / frames, STATS_CATCHUP_DIGITS) : 0,
            },
            cpuShare: interval.avg > 0 ? round(cpu.avg / interval.avg, STATS_CPU_SHARE_DIGITS) : 0,
            gpu: this.lastGpu,
        };
    }

    /** 一行摘要, 控制台和屏幕 HUD 共用 */
    format(): string {
        const s = this.snapshot();
        const gpu = s.gpu
            ? ` | GPU compute ${s.gpu.compute.toFixed(STATS_DISTRIBUTION_DIGITS)} / particle ${s.gpu.particle.toFixed(STATS_DISTRIBUTION_DIGITS)} / composite ${s.gpu.composite.toFixed(STATS_DISTRIBUTION_DIGITS)} ms`
            : ' | GPU 时间不可测(适配器无 timestamp-query, 或后端只返回 0)';
        return (
            `${s.fps.toFixed(STATS_FPS_DIGITS)} fps (帧间隔 p50 ${s.interval.p50} / p95 ${s.interval.p95} ms)` +
            ` | 主线程 ${s.cpu.avg} ms/帧, 占 ${(s.cpuShare * 100).toFixed(STATS_CPU_SHARE_PERCENT_DIGITS)}%` +
            ` | 步数 ${s.steps.avg}${gpu}`
        );
    }
}
