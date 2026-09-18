/*
后备缓冲尺寸计算的单测.

这里测的是**纯函数**(stage_size.ts):给定宿主尺寸与 dpr,算出应该开多大的画布.
它值得有测试,是因为"覆盖整个首屏"这件事完全压在这几个不变量上,而它在浏览器里
只表现为"画面糊不糊 / 场景有没有被拉伸",肉眼很难判断对错:

  - 比例恒为 16:9(城市层是按 uv 直接铺满画布的,比例一变整幅场景就被拉伸);
  - 两个方向都**至少**铺满宿主(否则边上会露出宿主背景);
  - dpr 参与且被夹在 [1, MAX_DEVICE_PIXEL_RATIO](不夹的话 4K + dpr2 就是 8K 宽);
  - 宿主不可见(0×0)时返回 null,而不是算出 1×1 把后备缓冲废掉.
*/
import { describe, expect, it } from 'vitest';

import {
    CANVAS_HEIGHT,
    CANVAS_WIDTH,
    MAX_DEVICE_PIXEL_RATIO,
    MIN_DEVICE_PIXEL_RATIO,
} from './config';
import { computeBackingSize } from './stage_size';

/** 画布标注比例(宽 / 高),也就是后备缓冲必须保持的比例 */
const RATIO = CANVAS_WIDTH / CANVAS_HEIGHT;

describe('首屏后备缓冲尺寸', () => {
    it('16:9 的宿主:正好铺满,不裁不拉', () => {
        const size = computeBackingSize(1920, 1080, 1);
        expect(size).toEqual({ width: 1920, height: 1080 });
    });

    it('比 16:9 更宽的宿主:按宽度铺满,高度溢出(上下裁)', () => {
        const size = computeBackingSize(2000, 800, 1);
        expect(size).not.toBeNull();
        expect(size!.width).toBe(2000);
        expect(size!.height).toBe(Math.round(2000 / RATIO));
        expect(size!.height).toBeGreaterThanOrEqual(800);
    });

    it('比 16:9 更窄的宿主(4:3 / 竖屏):按高度铺满,宽度溢出(左右裁)', () => {
        for (const [width, height] of [
            [1600, 1200],
            [390, 844],
        ] as const) {
            const size = computeBackingSize(width, height, 1);
            expect(size, `${width}x${height}`).not.toBeNull();
            expect(size!.height, `${width}x${height}`).toBe(height);
            expect(size!.width, `${width}x${height}`).toBe(Math.round(height * RATIO));
            expect(size!.width, `${width}x${height}`).toBeGreaterThanOrEqual(width);
        }
    });

    it('任何宿主尺寸下都同时满足"比例 16:9"与"两方向都不小于宿主"', () => {
        const viewports = [
            [1280, 800],
            [2560, 1440],
            [3440, 1440],
            [3840, 2160],
            [1024, 1366],
            [800, 1280],
        ] as const;
        for (const [width, height] of viewports) {
            for (const dpr of [1, 1.5, 2, 3]) {
                const label = `${width}x${height}@${dpr}`;
                const size = computeBackingSize(width, height, dpr);
                expect(size, label).not.toBeNull();
                // 比例:四舍五入后允许半个像素的误差
                expect(Math.abs(size!.width / size!.height - RATIO), label).toBeLessThan(0.01);
                // 覆盖:不小于宿主(按物理像素算)
                const effectiveDpr = Math.min(Math.max(dpr, MIN_DEVICE_PIXEL_RATIO), MAX_DEVICE_PIXEL_RATIO);
                expect(size!.width, label).toBeGreaterThanOrEqual(width * effectiveDpr - 1);
                expect(size!.height, label).toBeGreaterThanOrEqual(height * effectiveDpr - 1);
            }
        }
    });

    it('dpr 被夹在上限内:再高的像素密度也不会无限放大后备缓冲', () => {
        const a = computeBackingSize(1920, 1080, MAX_DEVICE_PIXEL_RATIO);
        const b = computeBackingSize(1920, 1080, MAX_DEVICE_PIXEL_RATIO + 2);
        expect(b).toEqual(a);
    });

    it('dpr 低于下限时按 1 处理(小于 1 只会把画面算糊)', () => {
        const low = computeBackingSize(1920, 1080, 0.5);
        const one = computeBackingSize(1920, 1080, MIN_DEVICE_PIXEL_RATIO);
        expect(low).toEqual(one);
    });

    it('宿主不可见(0×0)时返回 null:不能把后备缓冲算成 1×1', () => {
        expect(computeBackingSize(0, 0, 1)).toBeNull();
        expect(computeBackingSize(1920, 0, 1)).toBeNull();
        expect(computeBackingSize(0, 1080, 1)).toBeNull();
    });
});
