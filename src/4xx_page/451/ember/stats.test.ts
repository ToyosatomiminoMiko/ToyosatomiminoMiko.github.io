import { describe, expect, it } from 'vitest';
import { FrameStats } from './stats';

describe('FrameStats', () => {
    it('首帧(interval <= 0)不入窗口', () => {
        const stats = new FrameStats(8);
        stats.record({ interval: 0, cpu: 1, steps: 1 });
        expect(stats.snapshot().frames).toBe(0);
    });

    it('按帧间隔算平均帧率', () => {
        const stats = new FrameStats(8);
        for (let i = 0; i < 4; i++) stats.record({ interval: 16.6667, cpu: 0.5, steps: 1 });
        const snap = stats.snapshot();
        expect(snap.frames).toBe(4);
        expect(snap.fps).toBeCloseTo(60, 1);
        expect(snap.interval.p50).toBeCloseTo(16.67, 2);
    });

    it('cpuShare 反映主线程在帧里占多少 -- 瓶颈判据', () => {
        const stats = new FrameStats(8);
        // 帧长 100ms, 主线程只用 1ms: 说明锅不在 JS
        for (let i = 0; i < 4; i++) stats.record({ interval: 100, cpu: 1, steps: 2 });
        const snap = stats.snapshot();
        expect(snap.cpuShare).toBeCloseTo(0.01, 4);
        expect(snap.steps.avg).toBe(2);
        // 每帧都补步(> 1) -> catchUp 比例为 1
        expect(snap.steps.catchUp).toBe(1);
    });

    it('p95 会暴露尾部尖刺, 不会被中位数掩盖', () => {
        const stats = new FrameStats(10);
        // 9 帧 10ms + 1 帧 1000ms 的卡顿
        for (let i = 0; i < 9; i++) stats.record({ interval: 10, cpu: 1, steps: 1 });
        stats.record({ interval: 1000, cpu: 1, steps: 1 });
        const snap = stats.snapshot();
        expect(snap.interval.p50).toBe(10);
        expect(snap.interval.p95).toBe(1000);
        expect(snap.interval.max).toBe(1000);
    });

    it('环形缓冲写满后只保留最近 capacity 帧', () => {
        const stats = new FrameStats(4);
        for (let i = 0; i < 10; i++) stats.record({ interval: 10 + i, cpu: 1, steps: 1 });
        const snap = stats.snapshot();
        expect(snap.frames).toBe(4);
        // 留下的应该是 16/17/18/19; p50 用最近秩: 第 ceil(0.5*4)=2 小的样本
        expect(snap.interval.p50).toBe(17);
        expect(snap.interval.max).toBe(19);
    });

    it('保留最近一次 GPU 耗时, reset 后清空', () => {
        const stats = new FrameStats(4);
        stats.record({
            interval: 16,
            cpu: 1,
            steps: 1,
            gpu: { compute: 0.1, particle: 0.2, composite: 0.3, total: 0.6 },
        });
        expect(stats.snapshot().gpu?.total).toBeCloseTo(0.6, 3);

        stats.reset();
        const snap = stats.snapshot();
        expect(snap.frames).toBe(0);
        expect(snap.gpu).toBeNull();
        expect(snap.fps).toBe(0);
    });

    it('format() 在无 GPU 计时时也不抛', () => {
        const stats = new FrameStats(4);
        stats.record({ interval: 16, cpu: 1, steps: 1 });
        expect(stats.format()).toContain('fps');
        expect(stats.format()).toContain('timestamp-query');
    });

    it('负的 cpu(时钟回退)按 0 处理', () => {
        const stats = new FrameStats(4);
        stats.record({ interval: 16, cpu: -5, steps: 1 });
        expect(stats.snapshot().cpu.max).toBe(0);
    });
});
