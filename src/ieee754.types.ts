// ================================================================
// IEEE 754 浮点可视化 全部类型定义
// ================================================================

/** 数值分类:零 / 非规格化 / 规格化 / ±∞ / NaN */
export type IEEE754Class = 'zero' | 'subnormal' | 'normal' | 'infinity' | 'nan';

/** IEEE 754 精度格式描述(单精度 float32 / 双精度 float64) */
export interface IEEE754Format {
    /** 精度名(展示用) */
    readonly name: string;
    /** 总位数:32 或 64 */
    readonly totalBits: number;
    /** 指数(阶码)位数 */
    readonly exponentBits: number;
    /** 尾数(小数)位数 */
    readonly fractionBits: number;
    /** 指数偏置 bias */
    readonly bias: number;
}

/** 某一个数按 IEEE 754 拆分后的完整视图 */
export interface IEEE754Value {
    readonly format: IEEE754Format;
    /** 符号位:0(正) 或 1(负) */
    readonly sign: number;
    /** 指数域原始值(未减 bias) */
    readonly exponentField: number;
    /** 尾数域原始值(不含隐含位) */
    readonly fraction: number;
    readonly classification: IEEE754Class;
    /** 数值结果(可能为 ±0 / ±Infinity / NaN,与位图严格一致) */
    readonly value: number;
    /** 指数域二进制串(定长 exponentBits 位) */
    readonly exponentBits: string;
    /** 尾数域二进制串(定长 fractionBits 位) */
    readonly fractionBits: string;
    /** 完整二进制串:S + E + M */
    readonly bits: string;
}
