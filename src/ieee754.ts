/*
2026.09.09
APP: #ieee754 (主站 tab)
IEEE 754 浮点可视化:单精度(float32) / 双精度(float64)
========================================================================
【职责】
  把用户输入的"十进制小数"或"二进制位串"转成 IEEE 754 的三段
  (符号 S / 指数 E / 尾数 M)二进制视图,并生成 KaTeX 公式;支持三处
  双向换算:① 数字输入 -> 位; ② 点按位 -> 数字; ③ 纯位串 -> 数字.

【行为契约】
  - float64 直接按 JS number(本身即 double)取位;float32 先经
    Float32Array 舍入到单精度再取位,保证位图与真机一致.
  - 分类(classification)严格按 IEEE 754:指数域全 0 且尾数全 0 = 零;
    指数域全 0 且尾数非 0 = 非规格化(subnormal);指数域全 1 且尾数全 0 =
    ±∞;指数域全 1 且尾数非 0 = NaN;其余为规格化(normal).
  - 规格化外显"隐含前导 1"(即 1.FFFF…),非规格化外显"0.FFFF…";
    指数一律用"E - bias"给出真值,不硬编码绝对值.
  - 无效输入(空串,不可解析)显示错误,不抛异常;NaN / ±∞ / ±0 均按
    分类正常展示.
  - KaTeX 渲染统一走 katex.render(throwOnError:false),绝不注入
    未转义 HTML 到 innerHTML.

【编码注意】
  - 取位用 TypedArray(Float32Array/Float64Array + Uint32Array/BigUint64Array),
    不要用纯数学移位去"猜"double 的 64 位--那会因 JS number 无 64 位整数而
    丢失精度.
  - BigInt 仅在 64 位取位/拼位时使用(target ES2020 已原生支持),普通位运算
    不影响.
  - 借用了项目已有的 katex 依赖(复用,不重建);DOM 挂载风格与 clock/rbt/oled
    一致(mount* 函数,在 main.ts 的 DOMContentLoaded 里调用).
  - 纯逻辑(computeIEEE754 / buildIEEE754 / reconstructIEEE754 / ieee754Latex)
    已抽成无 DOM 依赖,便于 vitest 回归测试.
*/
import katex from 'katex';
import 'katex/dist/katex.min.css';

// ============================================================
// 常量与类型
// ============================================================

export type IEEE754Class = 'zero' | 'subnormal' | 'normal' | 'infinity' | 'nan';

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

export const FLOAT32: IEEE754Format = {
    name: '单精度 float32',
    totalBits: 32,
    exponentBits: 8,
    fractionBits: 23,
    bias: 127,
};

export const FLOAT64: IEEE754Format = {
    name: '双精度 float64',
    totalBits: 64,
    exponentBits: 11,
    fractionBits: 52,
    bias: 1023,
};

export const IEEE754_FORMATS: Record<'f32' | 'f64', IEEE754Format> = {
    f32: FLOAT32,
    f64: FLOAT64,
};

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

// ============================================================
// 纯逻辑层(无 DOM)--可被 vitest 直接测试
// ============================================================

/** 由符号/指数域/尾数域直接构造 IEEE754Value(不经过 JS number). */
export function buildIEEE754(
    sign: number,
    exponentField: number,
    fraction: number,
    format: IEEE754Format,
): IEEE754Value {
    const exponentBits = exponentField
        .toString(2)
        .padStart(format.exponentBits, '0');
    const fractionBits = fraction.toString(2).padStart(format.fractionBits, '0');
    const bits = `${sign}${exponentBits}${fractionBits}`;

    const expMax = (1 << format.exponentBits) - 1;
    let classification: IEEE754Class;
    if (exponentField === 0 && fraction === 0) {
        classification = 'zero';
    } else if (exponentField === 0) {
        classification = 'subnormal';
    } else if (exponentField === expMax && fraction === 0) {
        classification = 'infinity';
    } else if (exponentField === expMax) {
        classification = 'nan';
    } else {
        classification = 'normal';
    }

    const value = reconstructIEEE754(sign, exponentField, fraction, format);
    return {
        format,
        sign,
        exponentField,
        fraction,
        classification,
        value,
        exponentBits,
        fractionBits,
        bits,
    };
}

/** 由 [S, E, M] 位图拼装回某精度的 number(仅依赖位图,不依赖输入值). */
export function reconstructIEEE754(
    sign: number,
    exponentField: number,
    fraction: number,
    format: IEEE754Format,
): number {
    if (format === FLOAT32) {
        const u = new Uint32Array(1);
        u[0] =
            ((sign & 1) << 31) |
            ((exponentField & 0xff) << 23) |
            (fraction & 0x7fffff);
        return new Float32Array(u.buffer)[0];
    }
    const u = new BigUint64Array(1);
    u[0] =
        (BigInt(sign & 1) << 63n) |
        (BigInt(exponentField & 0x7ff) << 52n) |
        (BigInt(fraction) & 0xfffffffffffffn);
    return new Float64Array(u.buffer)[0];
}

/** 由 JS number 提取成 IEEE754Value;float32 会先舍入到单精度. */
export function computeIEEE754(value: number, format: IEEE754Format): IEEE754Value {
    let sign: number;
    let exponentField: number;
    let fraction: number;

    if (format === FLOAT32) {
        const f32 = new Float32Array(1);
        f32[0] = value;
        const bits = new Uint32Array(f32.buffer)[0];
        sign = (bits >>> 31) & 1;
        exponentField = (bits >>> 23) & 0xff;
        fraction = bits & 0x7fffff;
    } else {
        const f64 = new Float64Array(1);
        f64[0] = value;
        const bits = new BigUint64Array(f64.buffer)[0];
        sign = Number((bits >> 63n) & 1n);
        exponentField = Number((bits >> 52n) & 0x7ffn);
        fraction = Number(bits & 0xfffffffffffffn);
    }

    return buildIEEE754(sign, exponentField, fraction, format);
}

/** 无偏指数(真值):规格化 = E - bias;次正规 = 1 - bias;其余无意义返回 0. */
export function unbiasedExponent(v: IEEE754Value): number {
    if (v.classification === 'subnormal') return 1 - v.format.bias;
    if (v.classification === 'normal') return v.exponentField - v.format.bias;
    return 0;
}

/** 数值部分的 LaTeX(±∞ / ±0 / NaN 用符号表达). */
function valueLatex(v: IEEE754Value): string {
    switch (v.classification) {
        case 'nan':
            return '\\mathrm{NaN}';
        case 'infinity':
            return v.sign ? '-\\infty' : '+\\infty';
        case 'zero':
            return v.sign ? '-0' : '0';
        default:
            return String(v.value);
    }
}

/** 生成该值对应的 KaTeX 公式(按分类给出不同的展开式). */
export function ieee754Latex(v: IEEE754Value): string {
    const val = valueLatex(v);
    const s = v.sign;
    switch (v.classification) {
        case 'nan':
            return '\\mathrm{NaN}';
        case 'infinity':
            return `(-1)^{${s}} \\times \\infty = ${val}`;
        case 'zero':
            return `(-1)^{${s}} \\times 0 = ${val}`;
        case 'subnormal':
            return `(-1)^{${s}} \\times 2^{${1 - v.format.bias}} \\times ` +
                `\\left(0.${v.fractionBits}\\right)_{2} = ${val}`;
        default:
            return `(-1)^{${s}} \\times 2^{${v.exponentField}-${v.format.bias}} \\times ` +
                `\\left(1.${v.fractionBits}\\right)_{2} = ${val}`;
    }
}

// ============================================================
// DOM / UI 层
// ============================================================

function renderLatex(latex: string, element: HTMLElement): void {
    katex.render(latex, element, {
        displayMode: true,
        throwOnError: false,
        trust: false,
    });
}

/** 把完整位串按 S / E / M 三段切好,给 UI 分组展示用. */
function splitBits(v: IEEE754Value): { sign: string; exponent: string; fraction: string } {
    const expStart = 1;
    const fracStart = 1 + v.format.exponentBits;
    return {
        sign: v.bits.slice(0, 1),
        exponent: v.bits.slice(expStart, fracStart),
        fraction: v.bits.slice(fracStart),
    };
}

function breakdownHtml(v: IEEE754Value): string {
    const s = v.sign ? '负 (-1)' : '正 (+)';
    const { fraction } = splitBits(v);

    let expInfo: string;
    switch (v.classification) {
        case 'zero':
            expInfo = '零 (E=0, M=0)';
            break;
        case 'infinity':
            expInfo = '±∞ (E 全 1, M=0)';
            break;
        case 'nan':
            expInfo = 'NaN (E 全 1, M≠0)';
            break;
        case 'subnormal':
            expInfo = `非规格化, 指数 = 2<sup>${1 - v.format.bias}</sup>`;
            break;
        default:
            expInfo = `规格化, 指数 = 2<sup>${v.exponentField - v.format.bias}</sup> ` +
                `(E=${v.exponentField}, bias=${v.format.bias})`;
            break;
    }

    const mantissaHead = v.classification === 'subnormal' ? '0' : '1';
    return [
        `<div>符号 S = <b>${v.sign}</b> (${s})</div>`,
        `<div>指数 E = <b>${v.exponentField}</b> <span class="ieee-muted">(` +
        `${v.exponentBits})</span> - ${expInfo}</div>`,
        `<div>尾数 M = <b>${mantissaHead}.${fraction}</b><sub>2</sub> ` +
        `(${v.format.fractionBits} 位)</div>`,
    ].join('');
}

export function mountIEEE754(): void {
    const formatSel = document.getElementById('ieee-format') as HTMLSelectElement | null;
    const input = document.getElementById('ieee-input') as HTMLInputElement | null;
    const bitsEl = document.getElementById('ieee-bits');
    const bitstringEl = document.getElementById('ieee-bitstring');
    const breakdownEl = document.getElementById('ieee-breakdown');
    const formulaEl = document.getElementById('ieee-formula');
    const errorEl = document.getElementById('ieee-error');
    const expBitsLabel = document.querySelector('[data-role="exp-bits"]');
    const fracBitsLabel = document.querySelector('[data-role="frac-bits"]');

    if (
        !formatSel || !input || !bitsEl || !bitstringEl ||
        !breakdownEl || !formulaEl || !errorEl
    ) {
        console.warn('[IEEE754] 找不到 #ieee-format/#ieee-input/#ieee-bits 等 DOM 元素');
        return;
    }

    let current: IEEE754Value | null = null;

    /** 渲染某一比特位为可点击方块. */
    const makeBit = (bitVal: string, globalIndex: number, css: string): HTMLElement => {
        const el = document.createElement('span');
        el.className = `ieee-bit ${css}${bitVal === '1' ? ' on' : ''}`;
        el.textContent = bitVal;
        el.title = `bit ${globalIndex}`;
        el.addEventListener('click', () => toggleBit(globalIndex));
        return el;
    };

    /** 重绘整段位图(S / E / M 分组,每组内每 4 位一间距). */
    const renderBits = (v: IEEE754Value): void => {
        bitsEl.replaceChildren();

        const addGroup = (css: string, start: number, end: number): void => {
            const g = document.createElement('div');
            g.className = `ieee-bit-group ${css}`;
            for (let i = start; i < end; i++) {
                if (i !== start && (i - start) % 4 === 0) {
                    const gap = document.createElement('span');
                    gap.className = 'ieee-gap';
                    g.appendChild(gap);
                }
                g.appendChild(makeBit(v.bits[i], i, css));
            }
            bitsEl.appendChild(g);
        };

        const expStart = 1;
        const fracStart = 1 + v.format.exponentBits;
        addGroup('ieee-sign', 0, 1);
        addGroup('ieee-exp', expStart, expStart + v.format.exponentBits);
        addGroup('ieee-frac', fracStart, fracStart + v.format.fractionBits);

        const { sign, exponent, fraction } = splitBits(v);
        bitstringEl.textContent = `S=${sign}  E=${exponent}  M=${fraction}`;
    };

    /** 由位图切换当前值,并刷新所有控件. */
    const toggleBit = (globalIndex: number): void => {
        if (!current) return;
        const bits = current.bits.split('');
        bits[globalIndex] = bits[globalIndex] === '0' ? '1' : '0';
        const expStart = 1;
        const fracStart = 1 + current.format.exponentBits;
        const sign = Number(bits[0]);
        const exponentField = parseInt(bits.slice(expStart, fracStart).join(''), 2);
        const fraction = parseInt(bits.slice(fracStart).join(''), 2);
        current = buildIEEE754(sign, exponentField, fraction, current.format);
        renderAll(current);
    };

    const showError = (msg: string): void => {
        errorEl.textContent = `⚠️ ${msg}`;
        errorEl.hidden = false;
    };

    const clearError = (): void => {
        errorEl.hidden = true;
    };

    /** 用当前值刷新全部展示(数字输入 / 位图 / 位串 / 分解 / 公式). */
    const renderAll = (v: IEEE754Value): void => {
        clearError();
        // 程序化赋值不会触发 'input' 事件,故不会回环
        input.value = String(v.value);
        renderBits(v);
        breakdownEl.innerHTML = breakdownHtml(v);
        renderLatex(ieee754Latex(v), formulaEl);
    };

    /** 解析输入:先按长度匹配的 [01]+ 位串,否则按十进制. */
    const applyInput = (text: string): void => {
        const t = text.trim();
        if (t === '') {
            showError('请输入数值或位串.');
            return;
        }

        // 纯位串,且长度匹配某精度 -> 按位串解释
        if (/^[01]+$/.test(t) && (t.length === FLOAT32.totalBits || t.length === FLOAT64.totalBits)) {
            const fmt = t.length === FLOAT32.totalBits ? FLOAT32 : FLOAT64;
            const bits = t.split('');
            const expStart = 1;
            const fracStart = 1 + fmt.exponentBits;
            const sign = Number(bits[0]);
            const exponentField = parseInt(bits.slice(expStart, fracStart).join(''), 2);
            const fraction = parseInt(bits.slice(fracStart).join(''), 2);
            formatSel.value = fmt === FLOAT32 ? 'f32' : 'f64';
            refreshLabels(fmt);
            current = buildIEEE754(sign, exponentField, fraction, fmt);
            renderAll(current);
            return;
        }

        // 十进制
        const num = Number(t);
        if (Number.isNaN(num) && t.toLowerCase() !== 'nan') {
            showError(`无法解析的数值: "${t}"`);
            return;
        }
        const fmt = formatSel.value === 'f32' ? FLOAT32 : FLOAT64;
        current = computeIEEE754(num, fmt);
        renderAll(current);
    };

    formatSel.addEventListener('change', () => {
        // 切换精度:用当前数值值重算(位图随之重排)
        if (!current) return;
        const fmt = IEEE754_FORMATS[formatSel.value as 'f32' | 'f64'];
        refreshLabels(fmt);
        current = computeIEEE754(current.value, fmt);
        renderAll(current);
    });

    input.addEventListener('input', () => applyInput(input.value));

    // 更新图例中的位数提示
    const refreshLabels = (fmt: IEEE754Format): void => {
        if (expBitsLabel) expBitsLabel.textContent = String(fmt.exponentBits);
        if (fracBitsLabel) fracBitsLabel.textContent = String(fmt.fractionBits);
    };
    refreshLabels(FLOAT64);

    // 初始渲染
    applyInput(input.value);
}
