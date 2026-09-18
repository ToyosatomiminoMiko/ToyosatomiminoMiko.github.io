/*
2026.09.09
APP: #ieee754 (主站 tab)
IEEE 754 浮点可视化:单精度(float32) / 双精度(float64)
========================================================================
[职责]
  把用户输入的"十进制小数"或"二进制位串"转成 IEEE 754 的三段
  (符号 S / 指数 E / 尾数 M)二进制视图,并生成 KaTeX 递等公式.

[数据流(单向)]
  十进制输入框 -> [转换按钮] -> 二进制框(位图) -> KaTeX 公式.
  只有点按"转换"按钮才把输入框的内容喂给二进制框(输入框本身不随键入转换);
  一切以二进制框(位图)为准:点按位,粘贴位串,切换精度,特殊值载入都只更新
  二进制框并重算 KaTeX,绝不回写输入框,避免"输入与二进制打架".

[行为契约]
  - float64 直接按 JS number(本身即 double)取位;float32 先经
    Float32Array 舍入到单精度再取位,保证位图与真机一致.
  - 分类(classification)严格按 IEEE 754:指数域全 0 且尾数全 0 = 零;
    指数域全 0 且尾数非 0 = 非规格化(subnormal);指数域全 1 且尾数全 0 =
    ±∞;指数域全 1 且尾数非 0 = NaN;其余为规格化(normal).
  - 规格化外显"隐含前导 1"(即 1.FFFF...),非规格化外显"0.FFFF...";
    指数一律用"E - bias"给出真值,不硬编码绝对值.
  - 无效输入(空串,不可解析)显示错误,不抛异常;NaN / ±∞ / ±0 均按
    分类正常展示.
  - KaTeX 渲染统一走 katex.render(throwOnError:false),绝不注入
    未转义 HTML 到 innerHTML.
  - KaTeX 递等链(有限值)为三行,自左向右单向递推:
        公式(带入二进制值)
      = 公式(十进制)
      = 计算后的十进制结果(精确)
    其中第 1 行把二进制位代入公式,第 2 行把尾数的二进制展开换算成十进制,
    第 3 行为完全以位域推算的精确十进制;三行各占一行,超长值靠容器横向滚动,
    不做换行分包.

[编码注意]
  - 取位用 TypedArray(Float32Array/Float64Array + Uint32Array/BigUint64Array),
    不要用纯数学移位去"猜"double 的 64 位--那会因 JS number 无 64 位整数而
    丢失精度.
  - BigInt 仅在 64 位取位/拼位时使用(target ES2020 已原生支持),普通位运算
    不影响.
  - 借用了项目已有的 katex 依赖(复用,不重建);DOM 挂载风格与 clock/rbt/oled
    一致(mount* 函数,在 main.ts 的 DOMContentLoaded 里调用).
  - 纯逻辑(computeIEEE754 / buildIEEE754 / reconstructIEEE754 / ieee754Latex
    / exactValueLatex / exactValueDecimal)已抽成无 DOM 依赖,便于 vitest 回归测试.
*/
import katex from 'katex';
import 'katex/dist/katex.min.css';
import type { IEEE754Class, IEEE754Format, IEEE754Value } from './ieee754.types';
import {
    FLOAT32,
    FLOAT32_KEY,
    FLOAT64,
    FLOAT64_KEY,
    F32_EXPONENT_MASK,
    F32_EXPONENT_SHIFT,
    F32_FRACTION_MASK,
    F32_SIGN_SHIFT,
    F64_EXPONENT_MASK,
    F64_EXPONENT_SHIFT,
    F64_FRACTION_MASK,
    F64_SIGN_MASK,
    F64_SIGN_SHIFT,
    IEEE754_BINARY_RADIX,
    IEEE754_BIT_GROUP_SIZE,
    IEEE754_BITS_CLASS,
    IEEE754_BITSTRING_PATTERN,
    IEEE754_BIT_CLASS,
    IEEE754_BIT_GROUP_CLASS,
    IEEE754_DOM,
    IEEE754_DOM_MISSING_MESSAGE,
    IEEE754_ERROR_UI_PREFIX,
    IEEE754_ERR_EMPTY_INPUT,
    IEEE754_ERR_UNPARSABLE_PREFIX,
    IEEE754_ERR_UNPARSABLE_SUFFIX,
    IEEE754_EXPONENT_START,
    IEEE754_EXP_CLASS,
    IEEE754_FORMATS,
    IEEE754_FRAC_CLASS,
    IEEE754_GAP_CLASS,
    IEEE754_KATEX_OPTIONS,
    IEEE754_MUTED_CLASS,
    IEEE754_NAN_TEXT,
    IEEE754_ON_CLASS,
    IEEE754_SIGN_CLASS,
    IEEE754_SIGN_MASK,
    IEEE754_SIGN_START,
    IEEE754_SPECIAL_ROW_TITLE,
    IEEE754_SPECIAL_TABLE_CLASS,
    IEEE754_SPECIAL_TABLE_HEADERS,
    IEEE754_SPECIAL_VALUES,
    IEEE754_ZERO_FIELD,
} from './ieee754.config';

// ============================================================
// 常量(集中定义见 ./ieee754.config)
// ============================================================

/**
 * 由配置里的 [S, E, M] 原始位域构造特殊值,并补上展示用的 name.
 * 位域 -> IEEE754Value 的换算属逻辑层,故映射留在本模块(配置只声明数据).
 */
const SPECIAL_VALUES = IEEE754_SPECIAL_VALUES.map(spec => ({
    name: spec.name,
    make: (format: IEEE754Format): IEEE754Value => {
        const b = spec.bits(format);
        return buildIEEE754(b.sign, b.exponentField, b.fraction, format);
    },
}));

// ============================================================
// 纯逻辑层(无 DOM)--可被 vitest 直接测试
// ============================================================

/**
 * 把一个 bigint 尾数 m 与整指数 e 表示的 m×2^e 归一到"奇数尾数"形式.
 * 去掉 2 的公因子,让尾数为奇数(更紧凑,更标准的精确形式).
 */
function reducePow2(m: bigint, e: bigint): { m: bigint; e: bigint } {
    while (m !== 0n && (m & 1n) === 0n) {
        m >>= 1n;
        e += 1n;
    }
    return { m, e };
}

/**
 * 把非负 bigint m 与整指数 e 表示的 m×2^e 渲染为精确十进制字符串(不丢精度).
 * e<0 时整体右移 k=-e 位,即 m×5^k 后把小数点左移 k 位(分母 10^k,必可终止).
 */
function pow2Decimal(m: bigint, e: bigint): string {
    if (m === 0n) return '0';
    const r = reducePow2(m, e);
    m = r.m;
    e = r.e;
    if (e >= 0n) {
        return (m << e).toString();
    }
    const k = Number(-e);
    const n = m * (5n ** BigInt(k));
    const ns = n.toString();
    if (ns.length > k) {
        return `${ns.slice(0, ns.length - k)}.${ns.slice(ns.length - k)}`;
    }
    return `0.${'0'.repeat(k - ns.length)}${ns}`;
}

/** 由位域推导"奇数尾数 m × 2^e"的精确表示(严格对齐位图,不依赖 JS 舍入). */
function valueMantissaExponent(v: IEEE754Value): { m: bigint; e: bigint } {
    const fb = v.format.fractionBits;
    let m: bigint;
    let e: bigint;
    // 规格化:整数有效数字含隐含前导 1,即 2^fb + fraction;
    // 次正规:整数有效数字就是尾数域本身.
    if (v.classification === 'normal') {
        m = (1n << BigInt(fb)) | BigInt(v.fraction);
        e = BigInt(v.exponentField - v.format.bias) - BigInt(fb);
    } else {
        m = BigInt(v.fraction);
        e = BigInt(1 - v.format.bias) - BigInt(fb);
    }
    return reducePow2(m, e);
}

/**
 * 由位域计算该二进制串的精确真值,并输出为"整数尾数 × 2^exp"形式(已把尾数
 * 归一为奇数,去掉公因子 2).完全以位域(sign / exponentField / fraction)为准,
 * 不依赖 JS number 的舍入字符串,因此对任何不可精确表示的值(如 0.1)都能给出
 * 与二进制位图严格一致的精确值.±0 / ±∞ / NaN 用符号表达.
 *
 * 例:float64 的 0.1 -> "3602879701896397 \\times 2^{-55}";1.0 -> "1";
 *    Number.MIN_VALUE -> "1 \\times 2^{-1074}".
 */
export function exactValueLatex(v: IEEE754Value): string {
    switch (v.classification) {
        case 'zero':
            return v.sign ? '-0' : '0';
        case 'infinity':
            return v.sign ? '-\\infty' : '+\\infty';
        case 'nan':
            return '\\mathrm{NaN}';
        default:
            break;
    }

    const s = v.sign ? '-' : '';
    const { m, e } = valueMantissaExponent(v);
    const mStr = m.toString();
    return e === 0n ? `${s}${mStr}` : `${s}${mStr} \\times 2^{${e}}`;
}

/**
 * 由位域计算该二进制串的完整精确十进制值(可终止小数或整数,带符号).
 * 与 exactValueLatex 同源,都是从位域推导,不经 JS 舍入;±0 / ±∞ / NaN 用符号表达.
 *
 * 例:float64 的 0.1 -> "0.1000000000000000055511151231257827021181583404541015625";
 *    Number.MIN_VALUE -> 完整 1074 位小数;最大有限值 -> 完整 309 位整数.
 */
export function exactValueDecimal(v: IEEE754Value): string {
    switch (v.classification) {
        case 'zero':
            return v.sign ? '-0' : '0';
        case 'infinity':
            return v.sign ? '-Infinity' : 'Infinity';
        case 'nan':
            return 'NaN';
        default:
            break;
    }

    const s = v.sign ? '-' : '';
    const { m, e } = valueMantissaExponent(v);
    return `${s}${pow2Decimal(m, e)}`;
}

/** 尾数(1.M 或 0.M)换算成十进制字符串,供递等链第 2 行使用. */
function mantissaDecimal(v: IEEE754Value): string {
    const fb = v.format.fractionBits;
    const m = v.classification === 'normal'
        ? (1n << BigInt(fb)) | BigInt(v.fraction)
        : BigInt(v.fraction);
    return pow2Decimal(m, BigInt(-fb));
}

/** 由符号/指数域/尾数域直接构造 IEEE754Value(不经过 JS number). */
export function buildIEEE754(
    sign: number,
    exponentField: number,
    fraction: number,
    format: IEEE754Format,
): IEEE754Value {
    const exponentBits = exponentField
        .toString(IEEE754_BINARY_RADIX)
        .padStart(format.exponentBits, '0');
    const fractionBits = fraction.toString(IEEE754_BINARY_RADIX).padStart(format.fractionBits, '0');
    const bits = `${sign}${exponentBits}${fractionBits}`;

    const expMax = (1 << format.exponentBits) - 1;
    let classification: IEEE754Class;
    if (exponentField === IEEE754_ZERO_FIELD && fraction === IEEE754_ZERO_FIELD) {
        classification = 'zero';
    } else if (exponentField === IEEE754_ZERO_FIELD) {
        classification = 'subnormal';
    } else if (exponentField === expMax && fraction === IEEE754_ZERO_FIELD) {
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
            ((sign & IEEE754_SIGN_MASK) << F32_SIGN_SHIFT) |
            ((exponentField & F32_EXPONENT_MASK) << F32_EXPONENT_SHIFT) |
            (fraction & F32_FRACTION_MASK);
        return new Float32Array(u.buffer)[0];
    }
    const u = new BigUint64Array(1);
    u[0] =
        (BigInt(sign & Number(F64_SIGN_MASK)) << F64_SIGN_SHIFT) |
        (BigInt(exponentField & Number(F64_EXPONENT_MASK)) << F64_EXPONENT_SHIFT) |
        (BigInt(fraction) & F64_FRACTION_MASK);
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
        sign = (bits >>> F32_SIGN_SHIFT) & IEEE754_SIGN_MASK;
        exponentField = (bits >>> F32_EXPONENT_SHIFT) & F32_EXPONENT_MASK;
        fraction = bits & F32_FRACTION_MASK;
    } else {
        const f64 = new Float64Array(1);
        f64[0] = value;
        const bits = new BigUint64Array(f64.buffer)[0];
        sign = Number((bits >> F64_SIGN_SHIFT) & 1n);
        exponentField = Number((bits >> F64_EXPONENT_SHIFT) & F64_EXPONENT_MASK);
        fraction = Number(bits & F64_FRACTION_MASK);
    }

    return buildIEEE754(sign, exponentField, fraction, format);
}

/** 无偏指数(真值):规格化 = E - bias;次正规 = 1 - bias;其余无意义返回 0. */
export function unbiasedExponent(v: IEEE754Value): number {
    if (v.classification === 'subnormal') return 1 - v.format.bias;
    if (v.classification === 'normal') return v.exponentField - v.format.bias;
    return 0;
}

// ============================================================
// KaTeX 递等链生成(有限值)
// ============================================================

/**
 * 有限值(规格化/次正规)的 KaTeX 递等链:
 *   公式(带入二进制值)
 * = 公式(十进制)
 * = 计算后的十进制结果(精确)
 * 三行各占一行(不换行分包,超长值由容器横向滚动);符号(-)只在链首出现一次;
 * ±0 / ±∞ / NaN 由 ieee754Latex 单独处理.
 */
function finiteLatex(v: IEEE754Value): string {
    const sign = v.sign ? '-' : '';
    const leading = v.classification === 'subnormal' ? '0' : '1';
    const expFormula = v.classification === 'subnormal'
        ? `${1}-${v.format.bias}`
        : `${v.exponentField}-${v.format.bias}`;

    const binaryMantissa = `\\left(${leading}.${v.fractionBits}\\right)_{2}`;

    const rows: string[] = [
        `& ${sign}2^{${expFormula}} \\times ${binaryMantissa}`,
        `& = ${sign}2^{${expFormula}} \\times ${mantissaDecimal(v)}`,
        `& = ${exactValueDecimal(v)}`,
    ];

    return `\\begin{aligned}\n${rows.join(' \\\\\n')}\n\\end{aligned}`;
}

/**
 * 生成该值对应的 KaTeX 公式(按分类给出不同展开式).
 * 有限值(规格化/次正规)统一为递等链,符号在链首单次出现;
 * ±0 / ±∞ / NaN 用符号直接表达,不适用递等链.
 */
export function ieee754Latex(v: IEEE754Value): string {
    switch (v.classification) {
        case 'nan':
            return '\\mathrm{NaN}';
        case 'infinity':
            return `(-1)^{${v.sign}} \\times \\infty = ${exactValueLatex(v)}`;
        case 'zero':
            return `(-1)^{${v.sign}} \\times 0 = ${exactValueLatex(v)}`;
        default:
            return finiteLatex(v);
    }
}

// ============================================================
// DOM / UI 层
// ============================================================

function renderLatex(latex: string, element: HTMLElement): void {
    katex.render(latex, element, IEEE754_KATEX_OPTIONS);
}

/** 把完整位串按 S / E / M 三段切好,给 UI 分组展示用. */
function splitBits(v: IEEE754Value): { sign: string; exponent: string; fraction: string } {
    const expStart = IEEE754_EXPONENT_START;
    const fracStart = IEEE754_EXPONENT_START + v.format.exponentBits;
    return {
        sign: v.bits.slice(IEEE754_SIGN_START, IEEE754_EXPONENT_START),
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
        `<div>指数 E = <b>${v.exponentField}</b> <span class="${IEEE754_MUTED_CLASS}">(` +
        `${v.exponentBits})</span> - ${expInfo}</div>`,
        `<div>尾数 M = <b>${mantissaHead}.${fraction}</b><sub>2</sub> ` +
        `(${v.format.fractionBits} bit)</div>`,
    ].join('');
}

// ============================================================
// 特殊值参考表(数据在 ./ieee754.config,构造在本模块;渲染在 UI 层)
// ============================================================

/**
 * 把某值写成可展示的字符串(供特殊值参考表的"数值"列使用).
 * 保留 -0 / ±∞ / NaN 语义(String(v.value) 会把 -0 变成 "0",这里补回符号).
 * 说明:数据流单向,该函数只用于展示,绝不回写输入框.
 */
function valueDisplayText(v: IEEE754Value): string {
    switch (v.classification) {
        case 'zero':
            return v.sign ? '-0' : '0';
        case 'infinity':
            return v.sign ? '-Infinity' : 'Infinity';
        case 'nan':
            return 'NaN';
        default:
            return String(v.value);
    }
}

/**
 * 渲染特殊值参考表(随当前精度重生成).点击一行调用 onPick 载入该值.
 * 所有单元格用 textContent 写入,不拼接 HTML.
 */
function renderSpecialTable(
    container: HTMLElement,
    format: IEEE754Format,
    onPick: (v: IEEE754Value) => void,
): void {
    container.replaceChildren();
    const table = document.createElement('table');
    table.className = IEEE754_SPECIAL_TABLE_CLASS;

    const thead = document.createElement('thead');
    const headTr = document.createElement('tr');
    for (const label of IEEE754_SPECIAL_TABLE_HEADERS) {
        const th = document.createElement('th');
        th.textContent = label;
        headTr.appendChild(th);
    }
    thead.appendChild(headTr);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (const row of SPECIAL_VALUES) {
        const v = row.make(format);
        const tr = document.createElement('tr');
        tr.title = IEEE754_SPECIAL_ROW_TITLE;

        const tdName = document.createElement('td');
        tdName.textContent = row.name;

        const { sign, exponent, fraction } = splitBits(v);
        const tdBits = document.createElement('td');
        tdBits.className = IEEE754_BITS_CLASS;
        tdBits.textContent = `S=${sign} E=${exponent} M=${fraction}`;

        const tdVal = document.createElement('td');
        tdVal.textContent = valueDisplayText(v);

        tr.appendChild(tdName);
        tr.appendChild(tdBits);
        tr.appendChild(tdVal);
        tr.addEventListener('click', () => onPick(v));
        tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    container.appendChild(table);
}

export function mountIEEE754(): void {
    const formatSel = document.getElementById(IEEE754_DOM.formatId) as HTMLSelectElement | null;
    const input = document.getElementById(IEEE754_DOM.inputId) as HTMLInputElement | null;
    const convertBtn = document.getElementById(IEEE754_DOM.convertId) as HTMLButtonElement | null;
    const bitsEl = document.getElementById(IEEE754_DOM.bitsId);
    const bitstringEl = document.getElementById(IEEE754_DOM.bitstringId);
    const breakdownEl = document.getElementById(IEEE754_DOM.breakdownId);
    const formulaEl = document.getElementById(IEEE754_DOM.formulaId);
    const errorEl = document.getElementById(IEEE754_DOM.errorId);
    const specialEl = document.getElementById(IEEE754_DOM.specialId);
    const expBitsLabel = document.querySelector(IEEE754_DOM.expBitsSelector);
    const fracBitsLabel = document.querySelector(IEEE754_DOM.fracBitsSelector);

    if (
        !formatSel || !input || !bitsEl || !bitstringEl ||
        !breakdownEl || !formulaEl || !errorEl
    ) {
        console.warn(IEEE754_DOM_MISSING_MESSAGE);
        return;
    }

    let current: IEEE754Value | null = null;

    /** 渲染某一比特位为可点击方块. */
    const makeBit = (bitVal: string, globalIndex: number, css: string): HTMLElement => {
        const el = document.createElement('span');
        el.className = `${IEEE754_BIT_CLASS} ${css}${bitVal === '1' ? ` ${IEEE754_ON_CLASS}` : ''}`;
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
            g.className = `${IEEE754_BIT_GROUP_CLASS} ${css}`;
            for (let i = start; i < end; i++) {
                if (i !== start && (i - start) % IEEE754_BIT_GROUP_SIZE === 0) {
                    const gap = document.createElement('span');
                    gap.className = IEEE754_GAP_CLASS;
                    g.appendChild(gap);
                }
                g.appendChild(makeBit(v.bits[i], i, css));
            }
            bitsEl.appendChild(g);
        };

        const expStart = IEEE754_EXPONENT_START;
        const fracStart = IEEE754_EXPONENT_START + v.format.exponentBits;
        addGroup(IEEE754_SIGN_CLASS, IEEE754_SIGN_START, IEEE754_EXPONENT_START);
        addGroup(IEEE754_EXP_CLASS, expStart, expStart + v.format.exponentBits);
        addGroup(IEEE754_FRAC_CLASS, fracStart, fracStart + v.format.fractionBits);

        const { sign, exponent, fraction } = splitBits(v);
        bitstringEl.textContent = `S=${sign}  E=${exponent}  M=${fraction}`;
    };

    /** 由位图切换当前值,并刷新所有控件. */
    const toggleBit = (globalIndex: number): void => {
        if (!current) return;
        const bits = current.bits.split('');
        bits[globalIndex] = bits[globalIndex] === '0' ? '1' : '0';
        const expStart = IEEE754_EXPONENT_START;
        const fracStart = IEEE754_EXPONENT_START + current.format.exponentBits;
        const sign = Number(bits[IEEE754_SIGN_START]);
        const exponentField = parseInt(bits.slice(expStart, fracStart).join(''), IEEE754_BINARY_RADIX);
        const fraction = parseInt(bits.slice(fracStart).join(''), IEEE754_BINARY_RADIX);
        current = buildIEEE754(sign, exponentField, fraction, current.format);
        renderAll(current);
    };

    const showError = (msg: string): void => {
        errorEl.textContent = `${IEEE754_ERROR_UI_PREFIX}${msg}`;
        errorEl.hidden = false;
    };

    const clearError = (): void => {
        errorEl.hidden = true;
    };

    /**
     * 用当前值刷新全部展示(位图 / 位串 / 分解 / 公式).
     * 数据流单向:输入框($input)只作为入口喂数据,这里绝不回写输入框;
     * 一切以位图($current)为准.
     */
    const renderAll = (v: IEEE754Value): void => {
        clearError();
        renderBits(v);
        breakdownEl.innerHTML = breakdownHtml(v);
        renderLatex(ieee754Latex(v), formulaEl);
    };

    /** 解析输入:先按长度匹配的 [01]+ 位串,否则按十进制. 仅在点按"转换"时调用. */
    const applyInput = (text: string): void => {
        const t = text.trim();
        if (t === '') {
            showError(IEEE754_ERR_EMPTY_INPUT);
            return;
        }

        // 纯位串,且长度匹配某精度 -> 按位串解释
        if (IEEE754_BITSTRING_PATTERN.test(t) && (t.length === FLOAT32.totalBits || t.length === FLOAT64.totalBits)) {
            const fmt = t.length === FLOAT32.totalBits ? FLOAT32 : FLOAT64;
            const bits = t.split('');
            const expStart = IEEE754_EXPONENT_START;
            const fracStart = IEEE754_EXPONENT_START + fmt.exponentBits;
            const sign = Number(bits[IEEE754_SIGN_START]);
            const exponentField = parseInt(bits.slice(expStart, fracStart).join(''), IEEE754_BINARY_RADIX);
            const fraction = parseInt(bits.slice(fracStart).join(''), IEEE754_BINARY_RADIX);
            formatSel.value = fmt === FLOAT32 ? FLOAT32_KEY : FLOAT64_KEY;
            refreshLabels(fmt);
            refreshSpecial(fmt);
            current = buildIEEE754(sign, exponentField, fraction, fmt);
            renderAll(current);
            return;
        }

        // 十进制
        const num = Number(t);
        if (Number.isNaN(num) && t.toLowerCase() !== IEEE754_NAN_TEXT) {
            showError(`${IEEE754_ERR_UNPARSABLE_PREFIX}${t}${IEEE754_ERR_UNPARSABLE_SUFFIX}`);
            return;
        }
        const fmt = formatSel.value === FLOAT32_KEY ? FLOAT32 : FLOAT64;
        current = computeIEEE754(num, fmt);
        renderAll(current);
    };

    formatSel.addEventListener('change', () => {
        // 切换精度:用当前位图重算(位图随之重排),并刷新特殊值表
        if (!current) return;
        const fmt = IEEE754_FORMATS[formatSel.value as 'f32' | 'f64'];
        refreshLabels(fmt);
        refreshSpecial(fmt);
        current = computeIEEE754(current.value, fmt);
        renderAll(current);
    });

    // 只有点按"转换"按钮(或输入框内回车)才把输入框内容喂给二进制框,
    // 键入本身不触发转换,避免"输入与二进制打架".
    const commitInput = (): void => applyInput(input.value);
    convertBtn?.addEventListener('click', commitInput);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            commitInput();
        }
    });

    // 更新图例中的位数提示
    const refreshLabels = (fmt: IEEE754Format): void => {
        if (expBitsLabel) expBitsLabel.textContent = String(fmt.exponentBits);
        if (fracBitsLabel) fracBitsLabel.textContent = String(fmt.fractionBits);
    };

    // 特殊值参考表:点击某一行即把该值载入(仅更新位图,不回写输入框)
    const onPickSpecial = (v: IEEE754Value): void => {
        current = v;
        renderAll(current);
    };
    const refreshSpecial = (fmt: IEEE754Format): void => {
        if (specialEl) renderSpecialTable(specialEl, fmt, onPickSpecial);
    };

    refreshLabels(FLOAT64);
    refreshSpecial(FLOAT64);

    // 初始渲染:用默认值(3.14)作一次种子生成,后续用户键入一律由"转换"按钮触发.
    applyInput(input.value);
}
