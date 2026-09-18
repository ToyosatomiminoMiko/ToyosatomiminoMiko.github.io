/**
 * 固定步长时钟 -- 纯逻辑,不碰 DOM,可以直接单测.
 *
 * 把不稳定的帧间隔换算成"本帧该跑几个固定步": dt 序列恒定,
 * 120Hz 屏和 60Hz 屏看到的余烬速度一致,不会因为高刷屏跑得飞快.
 */
import { FIXED_DT, MAX_FRAME_DELTA, MAX_STEPS_PER_FRAME, MS_PER_SECOND } from './config';

export class FixedStepClock {
    private accumulator = 0;
    private lastFrameTime = 0;
    private elapsedTime = 0;

    constructor(
        private readonly step: number = FIXED_DT,
        private readonly maxSteps: number = MAX_STEPS_PER_FRAME,
        private readonly maxFrameDelta: number = MAX_FRAME_DELTA
    ) {}

    /** 累计仿真时间(秒),即着色器里的 time uniform */
    get time(): number {
        return this.elapsedTime;
    }

    /** 起表;同时清掉上一轮攒下的余量 */
    reset(nowMs: number): void {
        this.lastFrameTime = nowMs;
        this.accumulator = 0;
    }

    /**
     * 推进到 nowMs,返回本帧应该执行的固定步数.
     * 返回 0 表示帧间隔不足一步 -- 调用方仍应合成一帧,让拖尾继续衰减.
     */
    advance(nowMs: number): number {
        const delta = Math.min(Math.max(nowMs - this.lastFrameTime, 0) / MS_PER_SECOND, this.maxFrameDelta);
        this.lastFrameTime = nowMs;

        // 余量上限 = 一帧最多补的步数,防止长时间挂起后一次性补爆
        this.accumulator = Math.min(this.accumulator + delta, this.step * this.maxSteps);

        let steps = 0;
        while (this.accumulator >= this.step && steps < this.maxSteps) {
            this.accumulator -= this.step;
            this.elapsedTime += this.step;
            steps += 1;
        }
        return steps;
    }
}
