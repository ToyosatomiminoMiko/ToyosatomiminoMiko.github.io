/*
IEEE 754 配置里"全 1 位域"三个阈值函数的回归网.

原有的一处隐患是:这三个函数用 `(1 << n) - 1` 求"n 位全 1".JS 的移位量按 mod 32
取,float64 的尾数是 52 位,`1 << 52` 会退化成 `1 << 20`,于是配置里"最大有限值"
那一行算出 1048575(20 个 1)而不是 4503599627370495(52 个 1),特殊值参考表就会
把 8.98e307 当成 Number.MAX_VALUE 展示并允许点击载入 -- 全链路不报错.

原测试没抓到,是因为 ieee754.test.ts 自己用 Math.pow(2, 52) - 1 构造最大有限值,
绕开了 config.所以这里专门钉两条:

  1. 阈值函数本身对 f32 / f64 都返回真正的 2^n - 1;
  2. 配置里每一行的位域都落在该精度的合法范围内,且"最大有限值"经 buildIEEE754
     换算回来就是 Number.MAX_VALUE(而不是它的某个零头).

第 2 条走的是"config 声明 -> 逻辑层换算"的真实路径,是这次漏网的地方.
*/
import { describe, expect, it } from 'vitest';

import {
    FLOAT32,
    FLOAT64,
    IEEE754_SPECIAL_VALUES,
    exponentFieldAllOnes,
    exponentFieldMaxFinite,
    fractionFieldAllOnes,
} from './config';
import { buildIEEE754 } from './ieee754';

/** 取特殊值表里的一行(按展示名),缺了就直接失败 */
function specialSpec(name: string) {
    const spec = IEEE754_SPECIAL_VALUES.find((row) => row.name === name);
    expect(spec, name).toBeDefined();
    return spec as (typeof IEEE754_SPECIAL_VALUES)[number];
}

describe('IEEE754:全 1 位域阈值', () => {
    it('尾数域全 1:float64 是 52 个 1,不是移位退化后的 20 个 1', () => {
        // 2^52 - 1,必须严格等于 4503599627370495
        expect(fractionFieldAllOnes(FLOAT64)).toBe(2 ** 52 - 1);
        expect(fractionFieldAllOnes(FLOAT64)).toBe(4503599627370495);
        // 位宽 52 < 53,所以这个值在 number 里仍精确(仍是安全整数)
        expect(fractionFieldAllOnes(FLOAT64)).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER);

        expect(fractionFieldAllOnes(FLOAT32)).toBe(2 ** 23 - 1);
        expect(fractionFieldAllOnes(FLOAT32)).toBe(8388607);
    });

    it('指数域全 1 / 全 1 减 1:float32 为 255 / 254,float64 为 2047 / 2046', () => {
        expect(exponentFieldAllOnes(FLOAT32)).toBe(255);
        expect(exponentFieldMaxFinite(FLOAT32)).toBe(254);
        expect(exponentFieldAllOnes(FLOAT64)).toBe(2047);
        expect(exponentFieldMaxFinite(FLOAT64)).toBe(2046);
    });
});

describe('IEEE754:特殊值表的位域自洽', () => {
    it('每一行的指数域 / 尾数域都在本精度的位宽内', () => {
        for (const format of [FLOAT32, FLOAT64]) {
            for (const spec of IEEE754_SPECIAL_VALUES) {
                const b = spec.bits(format);
                const where = `${format.name} / ${spec.name}`;
                expect(b.sign, where).toBeGreaterThanOrEqual(0);
                expect(b.sign, where).toBeLessThanOrEqual(1);
                expect(b.exponentField, where).toBeLessThanOrEqual(exponentFieldAllOnes(format));
                expect(b.fraction, where).toBeLessThanOrEqual(fractionFieldAllOnes(format));
            }
        }
    });

    it('float64「最大有限值」换算回来就是 Number.MAX_VALUE,且尾数域 52 位全 1', () => {
        const b = specialSpec('最大有限值').bits(FLOAT64);
        expect(b).toEqual({ sign: 0, exponentField: 2046, fraction: 2 ** 52 - 1 });

        const v = buildIEEE754(b.sign, b.exponentField, b.fraction, FLOAT64);
        expect(v.classification).toBe('normal');
        expect(v.value).toBe(Number.MAX_VALUE);
        // 位串末 52 位全是 1(移位 bug 时这里会是 32 个 0 + 20 个 1)
        expect(v.bits.slice(-FLOAT64.fractionBits)).toBe('1'.repeat(FLOAT64.fractionBits));
    });

    it('float32「最大有限值」换算回来是 (2^24-1)×2^104,即单精度真最大值', () => {
        const b = specialSpec('最大有限值').bits(FLOAT32);
        expect(b).toEqual({ sign: 0, exponentField: 254, fraction: 2 ** 23 - 1 });

        const v = buildIEEE754(b.sign, b.exponentField, b.fraction, FLOAT32);
        expect(v.classification).toBe('normal');
        expect(v.value).toBe((2 ** 24 - 1) * 2 ** 104);
    });

    it('float64「最小正规格化数」与「最小正次规格化数」仍在边界上', () => {
        const minNormal = specialSpec('最小正规格化数').bits(FLOAT64);
        expect(buildIEEE754(minNormal.sign, minNormal.exponentField, minNormal.fraction, FLOAT64).value)
            .toBe(2 ** -1022);

        const minSub = specialSpec('最小正次规格化数').bits(FLOAT64);
        expect(buildIEEE754(minSub.sign, minSub.exponentField, minSub.fraction, FLOAT64).value)
            .toBe(Number.MIN_VALUE);
    });
});
