import { describe, expect, it } from 'vitest';
import { computeViewport, isSameViewport, type ViewportLimits } from './viewport';

const LIMITS: ViewportLimits = { maxDpr: 1.5, maxPixels: 2_600_000 };
const FALLBACK = { width: 1280, height: 720 };

describe('computeViewport', () => {
    it('按元素逻辑尺寸 × dpr 得到物理尺寸', () => {
        const vp = computeViewport({ clientWidth: 800, clientHeight: 600 }, FALLBACK, 1, LIMITS);
        expect(vp).toEqual({ cssWidth: 800, cssHeight: 600, physWidth: 800, physHeight: 600, dpr: 1 });
    });

    it('像素比被 maxDpr 截断(高 DPI 屏省填充率)', () => {
        const vp = computeViewport({ clientWidth: 800, clientHeight: 600 }, FALLBACK, 3, LIMITS);
        expect(vp.dpr).toBe(1.5);
        expect(vp.physWidth).toBe(1200);
        expect(vp.physHeight).toBe(900);
    });

    it('元素量不到尺寸时回退到视口尺寸', () => {
        const vp = computeViewport({ clientWidth: 0, clientHeight: 0 }, FALLBACK, 1, LIMITS);
        expect(vp.cssWidth).toBe(1280);
        expect(vp.cssHeight).toBe(720);
    });

    it('尺寸永远不小于 1', () => {
        const vp = computeViewport({ clientWidth: 0, clientHeight: 0 }, { width: 0, height: 0 }, 0, LIMITS);
        expect(vp.cssWidth).toBe(1);
        expect(vp.cssHeight).toBe(1);
        expect(vp.dpr).toBe(1);
    });

    it('超过像素上限时等比缩小,长宽比不变', () => {
        const limits: ViewportLimits = { maxDpr: 4, maxPixels: 1_000_000 };
        const vp = computeViewport({ clientWidth: 4000, clientHeight: 3000 }, FALLBACK, 2, limits);

        // 取整会带来千分之几的误差,所以是"约等于上限"而不是"不超过上限"
        const pixels = vp.physWidth * vp.physHeight;
        expect(pixels).toBeLessThanOrEqual(1_000_000 * 1.01);
        expect(pixels).toBeGreaterThan(1_000_000 * 0.99);

        expect(vp.physWidth / vp.physHeight).toBeCloseTo(4000 / 3000, 2);
        // dpr 同步被缩小,着色器里的换算才不会错位
        expect(vp.physWidth).toBe(Math.round(4000 * vp.dpr));
        expect(vp.dpr).toBeLessThan(2);
    });

    it('缩小后物理尺寸至少为 1', () => {
        const limits: ViewportLimits = { maxDpr: 1, maxPixels: 1 };
        const vp = computeViewport({ clientWidth: 4000, clientHeight: 3000 }, FALLBACK, 1, limits);
        expect(vp.physWidth).toBeGreaterThanOrEqual(1);
        expect(vp.physHeight).toBeGreaterThanOrEqual(1);
    });
});

describe('isSameViewport', () => {
    const base: ReturnType<typeof computeViewport> = {
        cssWidth: 800,
        cssHeight: 600,
        physWidth: 800,
        physHeight: 600,
        dpr: 1,
    };

    it('首次(没有上一帧)一定视为变化', () => {
        expect(isSameViewport(null, base)).toBe(false);
    });

    it('完全相同时不变', () => {
        expect(isSameViewport(base, { ...base })).toBe(true);
    });

    it('小于 2px / 0.01 dpr 的抖动忽略(移动端地址栏收放)', () => {
        expect(isSameViewport(base, { ...base, cssWidth: 801, cssHeight: 600.5 })).toBe(true);
        expect(isSameViewport(base, { ...base, dpr: 1.005 })).toBe(true);
    });

    it('超过容差就要重建', () => {
        expect(isSameViewport(base, { ...base, cssWidth: 803 })).toBe(false);
        expect(isSameViewport(base, { ...base, dpr: 1.2 })).toBe(false);
    });
});
