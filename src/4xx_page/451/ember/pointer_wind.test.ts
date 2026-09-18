import { describe, expect, it } from 'vitest';
import { PointerWind } from './pointer_wind';

/** 可控时钟,避免测试依赖真实时间 */
function fakeClock(start = 0) {
    let now = start;
    return { now: () => now, advance: (ms: number) => { now += ms; } };
}

describe('PointerWind', () => {
    it('初始无交互', () => {
        const wind = new PointerWind(fakeClock().now);
        expect(wind.strength).toBe(0);
        // 指针初始被放在屏幕外,避免一上来就吸粒子
        expect(wind.x).toBeLessThan(-1000);
        expect(wind.y).toBeLessThan(-1000);
    });

    it('指针移动后强度上升,并记录位置', () => {
        const clock = fakeClock();
        const wind = new PointerWind(clock.now);

        wind.moveTo(120, 340);
        expect(wind.x).toBe(120);
        expect(wind.y).toBe(340);

        for (let i = 0; i < 30; i++) wind.update(1 / 60);
        expect(wind.strength).toBeGreaterThan(0.9);
    });

    it('停手超过 idleAfterMs 后自然衰减回 0', () => {
        const clock = fakeClock();
        const wind = new PointerWind(clock.now);

        wind.moveTo(10, 10);
        wind.update(1 / 60);
        expect(wind.strength).toBeGreaterThan(0);

        clock.advance(200); // 超过 140ms 的空闲阈值
        for (let i = 0; i < 60; i++) wind.update(1 / 60);
        expect(wind.strength).toBeLessThan(0.01);
    });

    it('release 立刻开始衰减,不用等空闲阈值', () => {
        const clock = fakeClock();
        const wind = new PointerWind(clock.now);

        wind.moveTo(10, 10);
        for (let i = 0; i < 30; i++) wind.update(1 / 60);
        const peak = wind.strength;

        wind.release();
        wind.update(1 / 60);
        expect(wind.strength).toBeLessThan(peak);
    });

    it('dt 为 0 时仍有最小推进量,不会卡死', () => {
        const clock = fakeClock();
        const wind = new PointerWind(clock.now);

        wind.moveTo(10, 10);
        const before = wind.strength;
        wind.update(0);
        expect(wind.strength).toBeGreaterThan(before);
    });

    it('强度是平滑逼近,不会一步跳满', () => {
        const wind = new PointerWind(fakeClock().now);
        wind.moveTo(0, 0);
        wind.update(1 / 60);
        expect(wind.strength).toBeGreaterThan(0);
        expect(wind.strength).toBeLessThan(0.2);
    });
});
