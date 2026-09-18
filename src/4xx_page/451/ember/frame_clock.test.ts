import { describe, expect, it } from 'vitest';
import { FixedStepClock } from './frame_clock';

const STEP = 1 / 60;

/**
 * 注意: 下面的时间戳都刻意留了零点几毫秒的余量.
 * 正好卡在 1000/60 这类边界上时,浮点误差会让 `accumulator >= step` 落到另一侧,
 * 那是测量方式的问题,不是时钟的问题;这里要断言的是行为,不是浮点.
 */
const FRAME_60 = 1000 / 60;
const FRAME_120 = 1000 / 120;

describe('FixedStepClock', () => {
    it('步长与 60Hz 帧间隔对齐时,每帧恰好推进一步', () => {
        const clock = new FixedStepClock();
        clock.reset(0);

        expect(clock.advance(FRAME_60 + 0.5)).toBe(1);
        expect(clock.advance(2 * FRAME_60 + 1)).toBe(1);
        expect(clock.time).toBeCloseTo(STEP * 2, 6);
    });

    it('120Hz 屏上两帧才推进一步,仿真速度与 60Hz 一致', () => {
        const clock = new FixedStepClock();
        clock.reset(0);

        // 两帧 1/120s 才凑够一帧 1/60s
        expect(clock.advance(FRAME_120 + 0.3)).toBe(0);
        expect(clock.advance(2 * FRAME_120 + 0.6)).toBe(1);
        expect(clock.time).toBeCloseTo(STEP, 6);
    });

    it('帧间隔不足一步时返回 0,余量留到下一帧', () => {
        const clock = new FixedStepClock();
        clock.reset(0);

        expect(clock.advance(5)).toBe(0);
        expect(clock.advance(10)).toBe(0);
        // 累计到 20ms,已经超过一个 16.67ms 的步长
        expect(clock.advance(20)).toBe(1);
        expect(clock.time).toBeCloseTo(STEP, 6);
    });

    it('掉帧时最多只补两步,不会雪崩', () => {
        const clock = new FixedStepClock();
        clock.reset(0);

        // 卡了 2 秒: 只当作 maxFrameDelta(0.25s),再被夹到 2 步
        expect(clock.advance(2000)).toBe(2);
        // 又卡了 2 秒: 依然最多 2 步
        expect(clock.advance(4000)).toBe(2);
        expect(clock.time / STEP).toBeCloseTo(4, 6);
    });

    it('单帧推进时间被 maxFrameDelta 截断', () => {
        const clock = new FixedStepClock(STEP, 2, 0.25);
        clock.reset(0);
        // 就算传进来 1 小时也只当 0.25s 处理,时间不会飞到天上
        expect(clock.advance(3_600_000)).toBe(2);
        expect(clock.time / STEP).toBeCloseTo(2, 6);
    });

    it('reset 清掉上一轮攒下的余量', () => {
        const clock = new FixedStepClock();
        clock.reset(0);

        // 先攒下 16ms(不足一步)的余量
        expect(clock.advance(16)).toBe(0);

        clock.reset(1000);
        // 余量已清空: 只过 5ms 不会因为上一轮的 16ms 而补出一步
        expect(clock.advance(1005)).toBe(0);
    });

    it('时间不会倒流(now 回退时按 0 处理)', () => {
        const clock = new FixedStepClock();
        clock.reset(1000);

        expect(clock.advance(900)).toBe(0);
        expect(clock.time).toBe(0);

        // 基准点已经跟到 900,之后正常推进
        expect(clock.advance(900 + FRAME_60 + 0.5)).toBe(1);
    });
});
