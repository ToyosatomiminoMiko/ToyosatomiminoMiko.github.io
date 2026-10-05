/*
2026.09.09
APP: #ieee754 (主站 tab)
IEEE 754 浮点可视化:单精度(float32) / 双精度(float64).
=======================================================================
[职责]
  把用户输入的十进制小数或二进制位串拆成 S / E / M 三段位域,渲染位图与 KaTeX 公式.

[数据流(单向)]
  十进制输入框 -> [转换按钮] -> 位图 -> KaTeX 公式.
  只有点按"转换"(或输入框内回车)才把输入喂给位图,键入本身不触发;点按位 / 粘贴位串 /
  切精度 / 载入特殊值都只改位图并重算公式,绝不回写输入框,否则输入与二进制会互相打架.

[行为契约]
  - float64 直接按 JS number(本身即 double)取位;float32 先经 Float32Array 舍入到
    单精度再取位,保证位图与真机一致.
  - 分类严格按 IEEE 754:指数域全 0 且尾数全 0 = 零;E 全 0 且 M≠0 = 非规格化;
    E 全 1 且 M=0 = ±∞;E 全 1 且 M≠0 = NaN;其余为规格化.
  - 规格化带隐含前导 1(1.FFFF...),非规格化前导 0(0.FFFF...);无偏指数一律写成
    E - bias(非规格化为 1 - bias),不硬编码绝对值.
  - 无效输入(空串,不可解析)只显示错误,不抛异常;NaN / ±∞ / ±0 按分类正常展示.
  - 有限值的公式是三行单向递等链:带入二进制值 = 十进制 = 精确十进制值;三行各占一行,
    超长值靠容器横向滚动,不换行分包.
  - 公式整颗走 UI 库 `miko_ui` 的 `createFormulaElement`(KaTeX 与它的样式表都由
    库自带,本站不再直接依赖 katex);唯一写 innerHTML 的地方是分解信息,
    拼进去的全是本模块算出的数字与 0/1 位串,其余文本一律 textContent.

[编码注意]
  - 取位必须用 TypedArray(Float32Array / Float64Array + Uint32Array / BigUint64Array),
    不能用纯数学移位去"猜"double 的 64 位:JS number 没有 64 位整数,会丢精度.
  - 精确十进制值由位域用 bigint 算出,不经 JS number 的舍入字符串,所以 0.1 这类不可
    精确表示的值也与位图严格一致.
  - 纯逻辑层(computeIEEE754 / buildIEEE754 / reconstructIEEE754 / unbiasedExponent /
    ieee754Latex / exactValueLatex / exactValueDecimal)不依赖 DOM,可被 vitest 直接测;
    DOM 入口 mountIEEE754 由 main.ts 调用.
*/
import { create_element, createFormulaElement } from 'miko_ui';
import type { IEEE754Class, IEEE754Format, IEEE754Value } from './types';
import { createIeee754Panel, setFormatTriggerText } from './ui/ieee754_panel';
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
    exponentFieldAllOnes,
    IEEE754_BINARY_RADIX,
    IEEE754_BIT_GROUP_SIZE,
    IEEE754_BITS_CLASS,
    IEEE754_BITSTRING_PATTERN,
    IEEE754_BIT_CLASS,
    IEEE754_BIT_GROUP_CLASS,
    IEEE754_DEFAULT_FORMAT,
    IEEE754_DEFAULT_FORMAT_VALUE,
    IEEE754_ERROR_UI_PREFIX,
    IEEE754_ERR_EMPTY_INPUT,
    IEEE754_ERR_UNPARSABLE_PREFIX,
    IEEE754_ERR_UNPARSABLE_SUFFIX,
    IEEE754_EXPONENT_START,
    IEEE754_EXP_CLASS,
    IEEE754_FORMATS,
    IEEE754_FRAC_CLASS,
    IEEE754_GAP_CLASS,
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
} from './config';
import type { IEEE754FormatKey } from './config';

/**
 * 特殊值参考表的行:展示名 + 按当前精度构造 IEEE754Value.
 * 位域 -> IEEE754Value 的换算属逻辑层,所以映射留在本模块(配置只声明原始位域).
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
 * 把一个 bigint 尾数 m 与整指数 e 表示的 m×2^e 归一到"奇数尾数"形式:
 * 去掉尾数里 2 的公因子,让精确值有一个唯一且更紧凑的写法.
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
 * e<0 时把 m×2^e 写成 m×5^k / 10^k:k=-e,小数点左移 k 位即可,分母是 10 的幂所以
 * 一定是有限小数.
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

/**
 * 位域对应的整数有效数字(把有效位当成整数,不含指数).
 * 规格化数含隐含前导 1(2^fractionBits + fraction),非规格化的有效数字就是尾数域本身.
 */
function mantissaInteger(v: IEEE754Value): bigint {
    const fb = v.format.fractionBits;
    return v.classification === 'normal'
        ? (1n << BigInt(fb)) | BigInt(v.fraction)
        : BigInt(v.fraction);
}

/** 由位域推导"奇数尾数 m × 2^e"的精确表示(只看位图,不依赖 JS 舍入). */
function valueMantissaExponent(v: IEEE754Value): { m: bigint; e: bigint } {
    const fb = v.format.fractionBits;
    const e = v.classification === 'normal'
        ? BigInt(v.exponentField - v.format.bias) - BigInt(fb)
        : BigInt(1 - v.format.bias) - BigInt(fb);
    return reducePow2(mantissaInteger(v), e);
}

/**
 * 由位域计算该二进制串的精确真值,输出为"整数尾数 × 2^exp"形式(尾数已归一为奇数).
 * 完全以 sign / exponentField / fraction 为准,不依赖 JS number 的舍入字符串,因此对
 * 任何不可精确表示的值(如 0.1)都能给出与位图严格一致的精确值.±0 / ±∞ / NaN 用符号表达.
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
    return pow2Decimal(mantissaInteger(v), BigInt(-v.format.fractionBits));
}

/** 由符号 / 指数域 / 尾数域直接构造 IEEE754Value(不经过 JS number). */
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

    const expMax = exponentFieldAllOnes(format);
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

/** 无偏指数的"代入二进制"算式(如 `1027-1023` / `1-1023`),供 Latex 递等链排版. */
function exponentSubstitution(v: IEEE754Value): string {
    return v.classification === 'subnormal'
        ? `${1}-${v.format.bias}`
        : `${v.exponentField}-${v.format.bias}`;
}

// ============================================================
// KaTeX 递等链生成(有限值)
// ============================================================

/**
 * 有限值(规格化 / 非规格化)的 KaTeX 递等链:
 *   公式(带入二进制值)
 * = 公式(十进制)
 * = 计算后的十进制结果(精确)
 * 符号(-)只在链首出现一次;±0 / ±∞ / NaN 由 ieee754Latex 单独处理.
 */
function finiteLatex(v: IEEE754Value): string {
    const sign = v.sign ? '-' : '';
    const leading = v.classification === 'subnormal' ? '0' : '1';
    // 指数位置写的是"代入二进制"的算式,数值真值由 unbiasedExponent 负责.
    const exponent = exponentSubstitution(v);

    const binaryMantissa = `\\left(${leading}.${v.fractionBits}\\right)_{2}`;

    const rows: string[] = [
        `& ${sign}2^{${exponent}} \\times ${binaryMantissa}`,
        `& = ${sign}2^{${exponent}} \\times ${mantissaDecimal(v)}`,
        `& = ${exactValueDecimal(v)}`,
    ];

    return `\\begin{aligned}\n${rows.join(' \\\\\n')}\n\\end{aligned}`;
}

/**
 * 生成该值对应的 KaTeX 公式(按分类给出不同展开式).
 * 有限值统一为递等链;±0 / ±∞ / NaN 用符号直接表达,不适用递等链.
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

/**
 * 把一段 LaTeX 排进公式容器:整颗走库的 `createFormulaElement`(它自带 KaTeX 与
 * `katex.min.css`,本站不再直接依赖 katex).
 *
 * 为什么是 replaceChildren 而不是像 `katex.render(el, ...)` 那样渲染进容器本身:
 * 库的产物是一颗**新的** `<span class="ui-formula">`(基线类归库,字号走库的
 * `--katex-font-size`),容器 `#ieee-formula` 仍归本站(它那圈 `overflow-x: auto`
 * 与 `padding` 是本站的排布口径).每次重绘换一颗子节点,库内部的模板缓存保证
 * 同一串 LaTeX 不会重新排版.
 *
 * `copyable = false`:这是只读展示,不是复制入口 -- 默认可复制会给它挂
 * `tabindex=0` / `role=button`,而复制要另配 `FormulaCopyController`,不配就是一个
 * 焦点可达,按了没反应的按钮.
 */
function renderLatex(latex: string, element: HTMLElement): void {
    element.replaceChildren(createFormulaElement(latex, undefined, false));
}

/** 完整位串里指数段与尾数段的起始下标(尾数段紧随指数段). */
function fieldStarts(format: IEEE754Format): { expStart: number; fracStart: number } {
    const expStart = IEEE754_EXPONENT_START;
    return { expStart, fracStart: expStart + format.exponentBits };
}

/** 把完整位串按 S / E / M 三段切好,给 UI 分组展示用. */
function splitBits(v: IEEE754Value): { sign: string; exponent: string; fraction: string } {
    const { expStart, fracStart } = fieldStarts(v.format);
    return {
        sign: v.bits.slice(IEEE754_SIGN_START, expStart),
        exponent: v.bits.slice(expStart, fracStart),
        fraction: v.bits.slice(fracStart),
    };
}

/** 把定长位串的三段解析成位域(点按位图与粘贴位串共用). */
function parseBits(
    bits: string,
    format: IEEE754Format,
): { sign: number; exponentField: number; fraction: number } {
    const { expStart, fracStart } = fieldStarts(format);
    return {
        sign: Number(bits[IEEE754_SIGN_START]),
        exponentField: parseInt(bits.slice(expStart, fracStart), IEEE754_BINARY_RADIX),
        fraction: parseInt(bits.slice(fracStart), IEEE754_BINARY_RADIX),
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
            expInfo = `非规格化, 指数 = 2<sup>${unbiasedExponent(v)}</sup>`;
            break;
        default:
            expInfo = `规格化, 指数 = 2<sup>${unbiasedExponent(v)}</sup> ` +
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
// 特殊值参考表(数据在 ./config,构造在本模块;渲染在 UI 层)
// ============================================================

/**
 * 把某值写成可展示的字符串(供特殊值参考表的"数值"列使用).
 * 不能用 String(v.value):它会把 -0 变成 "0",这里按分类补回符号语义.
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
 * 单元格内容用元素 / textContent 写入,不拼接 HTML.
 */
function renderSpecialTable(
    container: HTMLElement,
    format: IEEE754Format,
    onPick: (v: IEEE754Value) => void,
): void {
    container.replaceChildren();

    const headTr = create_element({ tag: 'tr' }, {},
        ...IEEE754_SPECIAL_TABLE_HEADERS.map((label) => create_element({ tag: 'th' }, {}, label)));
    const body = create_element({ tag: 'tbody' }, {}, ...SPECIAL_VALUES.map((row) => {
        const v = row.make(format);
        const { sign, exponent, fraction } = splitBits(v);
        const tr = create_element({ tag: 'tr' }, { title: IEEE754_SPECIAL_ROW_TITLE },
            create_element({ tag: 'td' }, {}, row.name),
            create_element({ tag: 'td' }, { class: IEEE754_BITS_CLASS },
                `S=${sign} E=${exponent} M=${fraction}`),
            create_element({ tag: 'td' }, {}, valueDisplayText(v)),
        );
        tr.addEventListener('click', () => onPick(v));
        return tr;
    }));

    container.appendChild(create_element({ tag: 'table' }, { class: IEEE754_SPECIAL_TABLE_CLASS },
        create_element({ tag: 'thead' }, {}, headTr),
        body,
    ));
}

/**
 * 把 IEEE754 面板挂到宿主里.
 *
 * @param host 面板的宿主(骨架里的 `.tab-pane#ieee754`):只提供空窗格,整块卡片由
 *             createIeee754Panel() 生成后插进去.宿主里的元素不由本文件去查,
 *             引用一律由组件交回.
 */
export function mountIEEE754(host: HTMLElement): void {
    const panel = createIeee754Panel();
    host.append(panel.root);

    const formatMenu = panel.formatMenu;
    const formatTrigger = panel.formatTrigger;
    const input = panel.input;
    const convertBtn = panel.convertButton;
    const bitsEl = panel.bits;
    const bitstringEl = panel.bitstring;
    const breakdownEl = panel.breakdown;
    const formulaEl = panel.formula;
    const errorEl = panel.error;
    const specialEl = panel.special;
    const expBitsLabel = panel.expBitsLabel;
    const fracBitsLabel = panel.fracBitsLabel;

    let current: IEEE754Value | null = null;

    /**
     * 当前精度(菜单项 value).
     *
     * 菜单件只认"哪一项高亮",不保存当前值(那是消费者的事),所以这里存一份:
     * 十进制转换与位串长度判别都读它,菜单选中与位串推断精度都写它.
     */
    let formatValue: string = IEEE754_DEFAULT_FORMAT_VALUE;

    /** 切当前精度:本地状态 / 菜单当前项 / 触发按钮文案三处一起改(唯一写入点) */
    const setFormat = (value: string): void => {
        formatValue = value;
        formatMenu.setActive(value);
        // 按钮里的文案是 `<code>标签</code>`(与菜单项同一套排法),包法在组件那边,
        // 这里不直接写 textContent -- 那样会把 `<code>` 冲掉,字体悄悄变回正文
        setFormatTriggerText(formatTrigger, value);
    };

    // 点浮层外部关闭的监听挂在 document.body 上:面板浮在卡片上,点在卡片外
    // (导航条 / 空白处)也该收起来.
    formatMenu.bind(document.body);

    /** 渲染某一比特位为可点击方块. */
    const makeBit = (bitVal: string, globalIndex: number, css: string): HTMLElement => {
        const el = create_element({ tag: 'span' }, {
            class: `${IEEE754_BIT_CLASS} ${css}${bitVal === '1' ? ` ${IEEE754_ON_CLASS}` : ''}`,
            title: `bit ${globalIndex}`,
        }, bitVal);
        el.addEventListener('click', () => toggleBit(globalIndex));
        return el;
    };

    /** 重绘整段位图(S / E / M 分组,每组内每 4 位一间距). */
    const renderBits = (v: IEEE754Value): void => {
        bitsEl.replaceChildren();

        const addGroup = (css: string, start: number, end: number): void => {
            const children: HTMLElement[] = [];
            for (let i = start; i < end; i++) {
                if (i !== start && (i - start) % IEEE754_BIT_GROUP_SIZE === 0) {
                    children.push(create_element({ tag: 'span' }, { class: IEEE754_GAP_CLASS }));
                }
                children.push(makeBit(v.bits[i], i, css));
            }
            bitsEl.appendChild(create_element(
                { tag: 'div' },
                { class: `${IEEE754_BIT_GROUP_CLASS} ${css}` },
                ...children,
            ));
        };

        const { expStart, fracStart } = fieldStarts(v.format);
        addGroup(IEEE754_SIGN_CLASS, IEEE754_SIGN_START, expStart);
        addGroup(IEEE754_EXP_CLASS, expStart, fracStart);
        addGroup(IEEE754_FRAC_CLASS, fracStart, fracStart + v.format.fractionBits);

        const { sign, exponent, fraction } = splitBits(v);
        bitstringEl.textContent = `S=${sign}  E=${exponent}  M=${fraction}`;
    };

    /** 翻转位图里的一位,并按新位域重建当前值后刷新所有控件. */
    const toggleBit = (globalIndex: number): void => {
        if (!current) return;
        const bits = current.bits.split('');
        bits[globalIndex] = bits[globalIndex] === '0' ? '1' : '0';
        const { sign, exponentField, fraction } = parseBits(bits.join(''), current.format);
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
     * 数据流单向:这里绝不回写输入框,一切以位图(current)为准.
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

        // 长度对得上某个精度的纯位串按位串解释;位串长度本身就说明了精度,菜单跟着切
        if (IEEE754_BITSTRING_PATTERN.test(t) && (t.length === FLOAT32.totalBits || t.length === FLOAT64.totalBits)) {
            const fmt = t.length === FLOAT32.totalBits ? FLOAT32 : FLOAT64;
            const { sign, exponentField, fraction } = parseBits(t, fmt);
            setFormat(fmt === FLOAT32 ? FLOAT32_KEY : FLOAT64_KEY);
            refreshLabels(fmt);
            refreshSpecial(fmt);
            current = buildIEEE754(sign, exponentField, fraction, fmt);
            renderAll(current);
            return;
        }

        const num = Number(t);
        if (Number.isNaN(num) && t.toLowerCase() !== IEEE754_NAN_TEXT) {
            showError(`${IEEE754_ERR_UNPARSABLE_PREFIX}${t}${IEEE754_ERR_UNPARSABLE_SUFFIX}`);
            return;
        }
        // 当前精度 -> 格式定义:走 IEEE754_FORMATS 这张唯一的表(键是菜单项 value)
        const fmt = IEEE754_FORMATS[formatValue as IEEE754FormatKey];
        current = computeIEEE754(num, fmt);
        renderAll(current);
    };

    // 菜单选中:先切当前精度(菜单当前项 + 按钮文案),再按新精度重算当前值.
    // 顺序不能反:菜单是"先关浮层再回调",回调里要保证界面立刻反映新精度.
    formatMenu.onSelect((value) => {
        setFormat(value);
        if (!current) return;
        const fmt = IEEE754_FORMATS[value as IEEE754FormatKey];
        refreshLabels(fmt);
        refreshSpecial(fmt);
        current = computeIEEE754(current.value, fmt);
        renderAll(current);
    });

    // 只有点按"转换"按钮(或输入框内回车)才把输入框内容喂给位图,
    // 键入本身不触发转换,避免"输入与二进制打架".
    const commitInput = (): void => applyInput(input.value);
    convertBtn.addEventListener('click', commitInput);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            commitInput();
        }
    });

    /** 图例里的位数提示随精度改写 */
    const refreshLabels = (fmt: IEEE754Format): void => {
        expBitsLabel.textContent = String(fmt.exponentBits);
        fracBitsLabel.textContent = String(fmt.fractionBits);
    };

    /** 特殊值载入:只改位图与公式,不回写输入框 */
    const onPickSpecial = (v: IEEE754Value): void => {
        current = v;
        renderAll(current);
    };
    const refreshSpecial = (fmt: IEEE754Format): void => {
        renderSpecialTable(specialEl, fmt, onPickSpecial);
    };

    // 图例位数与特殊值表按**默认精度**初始化:唯一来源是 config.ts 里 active 那条
    // (IEEE754_DEFAULT_FORMAT),改精度声明时这里会跟着换,不会停在 float64.
    refreshLabels(IEEE754_DEFAULT_FORMAT);
    refreshSpecial(IEEE754_DEFAULT_FORMAT);

    // 初始渲染:用输入框初值(3.14)作一次种子生成,后续用户键入一律由"转换"触发.
    applyInput(input.value);
}
