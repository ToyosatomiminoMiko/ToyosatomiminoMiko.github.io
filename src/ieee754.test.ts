import { describe, expect, it } from 'vitest';
import {
    FLOAT32,
    FLOAT64,
    buildIEEE754,
    computeIEEE754,
    exactValueLatex,
    ieee754Latex,
    reconstructIEEE754,
    unbiasedExponent,
} from './ieee754';

describe('IEEE754 computeIEEE754', () => {
    it('float64 1.0 为规格化数, 指数域=1023(bias), 尾数=0', () => {
        const v = computeIEEE754(1, FLOAT64);
        expect(v.sign).toBe(0);
        expect(v.exponentField).toBe(1023);
        expect(v.fraction).toBe(0);
        expect(v.classification).toBe('normal');
        expect(v.value).toBe(1);
        expect(v.bits).toHaveLength(64);
    });

    it('float32 1.0 的完整位串为 0 01111111 000...0', () => {
        const v = computeIEEE754(1, FLOAT32);
        expect(v.exponentField).toBe(127);
        expect(v.fraction).toBe(0);
        expect(v.bits).toBe('0' + '01111111' + '0'.repeat(23));
        expect(v.bits).toHaveLength(32);
    });

    it('float64 0.5 的指数域为 1022(2^-1)', () => {
        const v = computeIEEE754(0.5, FLOAT64);
        expect(v.exponentField).toBe(1022);
        expect(v.fraction).toBe(0);
        expect(v.classification).toBe('normal');
    });

    it('负零保留符号位, 分类为零', () => {
        const v = computeIEEE754(-0, FLOAT64);
        expect(v.sign).toBe(1);
        expect(v.classification).toBe('zero');
        expect(Object.is(v.value, -0)).toBe(true);
    });

    it('Infinity / NaN 分类正确', () => {
        const inf = computeIEEE754(Infinity, FLOAT64);
        expect(inf.classification).toBe('infinity');
        expect(inf.value).toBe(Infinity);

        const nan = computeIEEE754(NaN, FLOAT64);
        expect(nan.classification).toBe('nan');
        expect(Number.isNaN(nan.value)).toBe(true);
    });

    it('float64 最小次正规数与最小规格化的边界', () => {
        // Number.MIN_VALUE ≈ 2^-1074:最小的次正规数(尾数域=1)
        const minSub = computeIEEE754(Number.MIN_VALUE, FLOAT64);
        expect(minSub.classification).toBe('subnormal');
        expect(minSub.fraction).toBe(1);
        expect(minSub.value).toBe(Number.MIN_VALUE);

        // 2^-1022:最小的正规格化数(指数域=1, 尾数=0)
        const minNormal = computeIEEE754(2 ** -1022, FLOAT64);
        expect(minNormal.classification).toBe('normal');
        expect(minNormal.exponentField).toBe(1);
        expect(minNormal.fraction).toBe(0);
    });

    it('float32 最小规格化/次正规化边界', () => {
        const minNormal32 = computeIEEE754(2 ** -126, FLOAT32);
        expect(minNormal32.classification).toBe('normal');
        expect(minNormal32.exponentField).toBe(1);
        expect(minNormal32.fraction).toBe(0);

        // float32 最小次正规数 = 2^-149(尾数域=1)
        const minSub32 = computeIEEE754(2 ** -149, FLOAT32);
        expect(minSub32.classification).toBe('subnormal');
        expect(minSub32.fraction).toBe(1);
        expect(minSub32.value).toBe(2 ** -149);
    });
});

describe('IEEE754 reconstructIEEE754 (往返一致)', () => {
    it.each([
        [1, FLOAT64],
        [-1.5, FLOAT64],
        [3.14, FLOAT64],
        [0.1, FLOAT64],
        [1e308, FLOAT64],
        [1, FLOAT32],
        [-2.5, FLOAT32],
        [3.14, FLOAT32],
        [0.1, FLOAT32],
    ])('值 %s 经 %s 取位-还原后仍一致', (value, format) => {
        const v = computeIEEE754(value as number, format as typeof FLOAT64);
        const rebuilt = reconstructIEEE754(v.sign, v.exponentField, v.fraction, v.format);
        expect(rebuilt).toBe(v.value);
    });

    it('float32 会舍入到单精度(与 Float32Array 一致)', () => {
        const v = computeIEEE754(3.14, FLOAT32);
        expect(v.value).toBe(new Float32Array([3.14])[0]);
    });
});

describe('IEEE754 buildIEEE754 / unbiasedExponent / latex', () => {
    it('buildIEEE754 直接从位图构造, 与 computeIEEE754 一致', () => {
        const fromValue = computeIEEE754(3.14, FLOAT64);
        const fromBits = buildIEEE754(
            fromValue.sign,
            fromValue.exponentField,
            fromValue.fraction,
            FLOAT64,
        );
        expect(fromBits.value).toBe(fromValue.value);
        expect(fromBits.classification).toBe(fromValue.classification);
        expect(fromBits.bits).toBe(fromValue.bits);
    });

    it('unbiasedExponent: 规格化 = E-bias; 次正规 = 1-bias', () => {
        expect(unbiasedExponent(computeIEEE754(3.14, FLOAT64))).toBe(1); // 3.14 ∈ [2^1, 2^2)
        expect(unbiasedExponent(computeIEEE754(Number.MIN_VALUE, FLOAT64))).toBe(-1022);
        expect(unbiasedExponent(computeIEEE754(Infinity, FLOAT64))).toBe(0);
    });

    it('latex: 规格化数给出 2^{E-bias} 并带隐含前导 1', () => {
        const latex = ieee754Latex(computeIEEE754(1, FLOAT64));
        expect(latex).toContain('2^{1023-1023}');
        expect(latex).toContain('1.');
        expect(latex).toContain('= 1');
    });

    it('latex: 负零 / 无穷 / NaN 的符号表达', () => {
        expect(ieee754Latex(computeIEEE754(-0, FLOAT64))).toContain('-0');
        expect(ieee754Latex(computeIEEE754(Infinity, FLOAT64))).toContain('+\\infty');
        expect(ieee754Latex(computeIEEE754(NaN, FLOAT64))).toBe('\\mathrm{NaN}');
    });

    it('latex: 次正规数用 0.FFFF 前导并给 2^{1-bias}', () => {
        const latex = ieee754Latex(computeIEEE754(Number.MIN_VALUE, FLOAT64));
        expect(latex).toContain('2^{-1022}');
        expect(latex).toContain('0.');
    });
});

describe('IEEE754 exactValueLatex (真实值, 以位域为准)', () => {
    it('规格化: 1.0 -> 1; 2.0 -> 1 × 2^{1}', () => {
        expect(exactValueLatex(computeIEEE754(1, FLOAT64))).toBe('1');
        expect(exactValueLatex(computeIEEE754(2, FLOAT64))).toBe('1 \\times 2^{1}');
    });

    it('float64 0.1 -> 3602879701896397 × 2^{-55} (奇数尾数)', () => {
        expect(exactValueLatex(computeIEEE754(0.1, FLOAT64)))
            .toBe('3602879701896397 \\times 2^{-55}');
    });

    it('次正规: 最小正次正规数 -> 1 × 2^{-1074}', () => {
        expect(exactValueLatex(computeIEEE754(Number.MIN_VALUE, FLOAT64)))
            .toBe('1 \\times 2^{-1074}');
    });

    it('最大有限值 -> 9007199254740991 × 2^{971}', () => {
        expect(exactValueLatex(buildIEEE754(0, 2046, Math.pow(2, 52) - 1, FLOAT64)))
            .toBe('9007199254740991 \\times 2^{971}');
    });

    it('float32 0.1 用舍入后位图的真实值', () => {
        const v = computeIEEE754(0.1, FLOAT32);
        // 0.1 舍入到单精度后精确为 13421773 × 2^-27
        expect(exactValueLatex(v)).toBe('13421773 \\times 2^{-27}');
        // 与直接用同一位域构造的值严格一致
        expect(exactValueLatex(v)).toBe(exactValueLatex(
            buildIEEE754(v.sign, v.exponentField, v.fraction, FLOAT32),
        ));
    });

    it('±0 / ±∞ / NaN 的符号表达', () => {
        expect(exactValueLatex(computeIEEE754(-0, FLOAT64))).toBe('-0');
        expect(exactValueLatex(computeIEEE754(0, FLOAT64))).toBe('0');
        expect(exactValueLatex(computeIEEE754(Infinity, FLOAT64))).toBe('+\\infty');
        expect(exactValueLatex(computeIEEE754(-Infinity, FLOAT64))).toBe('-\\infty');
        expect(exactValueLatex(computeIEEE754(NaN, FLOAT64))).toBe('\\mathrm{NaN}');
    });

    it('latex 公式的右端使用精确真实值(而不是 JS 舍入串)', () => {
        const latex = ieee754Latex(computeIEEE754(0.1, FLOAT64));
        expect(latex).toContain('3602879701896397 \\times 2^{-55}');
        expect(latex).not.toContain('= 0.1');
    });
});

describe('IEEE754 特殊值', () => {
    it('float64 最大有限值 / 最小正常数 / 最小次正规数', () => {
        const maxFinite = buildIEEE754(0, 2046, Math.pow(2, 52) - 1, FLOAT64);
        expect(maxFinite.classification).toBe('normal');
        expect(maxFinite.value).toBe(Number.MAX_VALUE);

        const minNormal = buildIEEE754(0, 1, 0, FLOAT64);
        expect(minNormal.value).toBe(2 ** -1022);
        expect(minNormal.classification).toBe('normal');

        const minSub = buildIEEE754(0, 0, 1, FLOAT64);
        expect(minSub.value).toBe(Number.MIN_VALUE);
        expect(minSub.classification).toBe('subnormal');
    });

    it('±∞ / ±0 / NaN 位图与数值', () => {
        const posInf = buildIEEE754(0, 2047, 0, FLOAT64);
        expect(posInf.value).toBe(Infinity);
        expect(posInf.classification).toBe('infinity');
        expect(posInf.bits).toBe('0' + '1'.repeat(11) + '0'.repeat(52));

        const negInf = buildIEEE754(1, 2047, 0, FLOAT64);
        expect(negInf.value).toBe(-Infinity);
        expect(negInf.sign).toBe(1);

        const negZero = buildIEEE754(1, 0, 0, FLOAT64);
        expect(negZero.classification).toBe('zero');
        expect(Object.is(negZero.value, -0)).toBe(true);

        const nan = buildIEEE754(0, 2047, 1, FLOAT64);
        expect(nan.classification).toBe('nan');
        expect(Number.isNaN(nan.value)).toBe(true);
    });

    it('float32 最大有限值的位域', () => {
        const maxFinite32 = buildIEEE754(0, 254, Math.pow(2, 23) - 1, FLOAT32);
        expect(maxFinite32.classification).toBe('normal');
        expect(maxFinite32.exponentField).toBe(254);

        // 该值回填后应与原值一致(不会溢出为无穷)
        const v = computeIEEE754(maxFinite32.value, FLOAT32);
        expect(v.classification).toBe('normal');
        expect(v.exponentField).toBe(254);
        expect(v.fraction).toBe(Math.pow(2, 23) - 1);
        expect(v.value).toBe(maxFinite32.value);
    });
});
