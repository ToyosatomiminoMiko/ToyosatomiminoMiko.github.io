/**
 * 参数取值域归一化单测(循环类系数的唯一回绕点).
 *
 * 循环参数在编译期与参数面板共用这一份实现,这里锁定三件事:
 * 普通参数仍夹取,循环参数回绕到半开区间 [min, max),非法值报错.
 */
import { describe, expect, it } from 'vitest';
import { normalizeParamValue } from './paramValue';

const ordinary = { name: 'a', min: -2, max: 2 };
const cyclic = { name: 'phi', min: -3.14159, max: 3.14159, cyclic: true };

describe('normalizeParamValue', () => {
    it('普通参数夹到 [min, max]', () => {
        expect(normalizeParamValue(0, ordinary)).toBe(0);
        expect(normalizeParamValue(5, ordinary)).toBe(2);
        expect(normalizeParamValue(-5, ordinary)).toBe(-2);
    });

    it('循环参数回绕到 [min, max)', () => {
        // 球坐标方位角:超出 ±π 的等价角回到主值区间.
        expect(normalizeParamValue(0, cyclic)).toBe(0);
        expect(normalizeParamValue(4, cyclic)).toBeCloseTo(4 - 2 * 3.14159, 9);
        expect(normalizeParamValue(-4, cyclic)).toBeCloseTo(-4 + 2 * 3.14159, 9);
        expect(normalizeParamValue(2 * 3.14159, cyclic)).toBeCloseTo(0, 9);
        expect(normalizeParamValue(-2 * 3.14159, cyclic)).toBeCloseTo(0, 9);
    });

    it('min 与 max 是同一点:端点回绕到 min 一侧', () => {
        // 半开区间 [min, max):φ = max 与 φ = min 等价,归到 min,
        // 否则滑块两端会出现两个不同位置的同一个角.
        expect(normalizeParamValue(3.14159, cyclic)).toBeCloseTo(-3.14159, 9);
        expect(normalizeParamValue(-3.14159, cyclic)).toBeCloseTo(-3.14159, 9);
    });

    it('区间内的值原样保留', () => {
        expect(normalizeParamValue(1.5, cyclic)).toBe(1.5);
        expect(normalizeParamValue(-1.5, cyclic)).toBe(-1.5);
    });

    it('非有限值报错而不是静默产出 NaN', () => {
        expect(() => normalizeParamValue(NaN, cyclic)).toThrow(/有限数/);
        expect(() => normalizeParamValue(Infinity, ordinary)).toThrow(/有限数/);
    });
});
