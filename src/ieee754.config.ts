// ================================================================
// IEEE 754 浮点可视化(ieee754.ts)常量配置
//
// 只放**声明式常量**:精度格式(FLOAT32 / FLOAT64),格式索引表,分类阈值
// 纯函数,特殊值的原始位域描述,位运算掩码与位移,位图展示分组宽度,
// DOM 契约与可见文案.这里不引用逻辑层函数,也没有模块级可变状态.
// 数值与拆分前的字面量逐位一致.
// ================================================================
import type {
    IEEE754Format,
} from './ieee754.types';

// ============================================================
// 精度格式
// ============================================================

/** 单精度 float32 格式描述 */
export const FLOAT32: IEEE754Format = {
    name: '单精度 float32',
    totalBits: 32,
    exponentBits: 8,
    fractionBits: 23,
    bias: 127,
};

/** 双精度 float64 格式描述 */
export const FLOAT64: IEEE754Format = {
    name: '双精度 float64',
    totalBits: 64,
    exponentBits: 11,
    fractionBits: 52,
    bias: 1023,
};

/**
 * 精度下拉框取值 -> 格式描述.
 * 键名 'f32' / 'f64' 是下拉框 value 的类型契约(与 index.html 的 option 一致),
 * 保留为字面量;代码中请优先使用 FLOAT32_KEY / FLOAT64_KEY 常量.
 */
export const IEEE754_FORMATS: Record<'f32' | 'f64', IEEE754Format> = {
    f32: FLOAT32,
    f64: FLOAT64,
};

/** 精度下拉框的 f32 取值(与 index.html 的 option value 一致) */
export const FLOAT32_KEY = 'f32';

/** 精度下拉框的 f64 取值(与 index.html 的 option value 一致) */
export const FLOAT64_KEY = 'f64';

// ============================================================
// 分类阈值
// ============================================================

/** 指数域全 1 时的值(全 1 表示 ±∞ 或 NaN) */
export function exponentFieldAllOnes(format: IEEE754Format): number {
    return (1 << format.exponentBits) - 1;
}

/** 最大有限值对应的指数域(全 1 减 1) */
export function exponentFieldMaxFinite(format: IEEE754Format): number {
    return (1 << format.exponentBits) - 1 - 1;
}

/** 尾数域全 1 时的值(最大有效位模式) */
export function fractionFieldAllOnes(format: IEEE754Format): number {
    return (1 << format.fractionBits) - 1;
}

/**
 * 分类判定用的零值:指数域与尾数域都为 0 时该数为零.
 * 两个域共同与 0 比较,故只需一个常量.
 */
export const IEEE754_ZERO_FIELD = 0;

// ============================================================
// 位运算掩码 / 位移(float32)
// ============================================================

/** 符号位在 float32 位串中的位移(最高位) */
export const F32_SIGN_SHIFT = 31;

/** 指数域在 float32 位串中的位移 */
export const F32_EXPONENT_SHIFT = 23;

/** 尾数域掩码:低 23 位全 1 */
export const F32_FRACTION_MASK = 0x7fffff;

/** 符号位掩码:最低 1 位(number 版,供 float32 的位运算) */
export const IEEE754_SIGN_MASK = 1;

/** 符号位掩码:最低 1 位(BigInt 版,供 float64 的 BigInt 位运算;与 1 同值) */
export const F64_SIGN_MASK = 1n;

/** 指数域掩码(float32):低 8 位全 1 */
export const F32_EXPONENT_MASK = 0xff;

// ============================================================
// 位运算掩码 / 位移(float64,BigInt)
// ============================================================

/** 符号位在 float64 位串中的位移(最高位) */
export const F64_SIGN_SHIFT = 63n;

/** 指数域在 float64 位串中的位移 */
export const F64_EXPONENT_SHIFT = 52n;

/** 尾数域掩码:低 52 位全 1 */
export const F64_FRACTION_MASK = 0xfffffffffffffn;

/** 指数域掩码(float64):低 11 位全 1 */
export const F64_EXPONENT_MASK = 0x7ffn;

// ============================================================
// 位图展示 / 位串解析
// ============================================================

/** 符号段在完整位串中的起始下标(0 起) */
export const IEEE754_SIGN_START = 0;

/** 指数段在完整位串中的起始下标(紧跟符号位之后) */
export const IEEE754_EXPONENT_START = 1;

/** 位图每 4 位插入一个间距 */
export const IEEE754_BIT_GROUP_SIZE = 4;

/** 位图 / 位串的二进制进制基数 */
export const IEEE754_BINARY_RADIX = 2;

/** 位串解析:纯 0/1 串的匹配正则 */
export const IEEE754_BITSTRING_PATTERN = /^[01]+$/;

/** 十进制解析 NaN 时接受的字面量(不区分大小写) */
export const IEEE754_NAN_TEXT = 'nan';

// ============================================================
// 特殊值参考表(只描述原始位域,由 ieee754.ts 映射成 IEEE754Value)
// ============================================================

/** 特殊值的原始位域描述(按此顺序展示) */
export interface IEEE754SpecialBits {
    /** 符号位:0(正)或 1(负) */
    readonly sign: number;
    /** 指数域原始值(未减 bias) */
    readonly exponentField: number;
    /** 尾数域原始值(不含隐含位) */
    readonly fraction: number;
}

/** 特殊值一行:展示名 + 由精度格式算出原始位域的函数(纯函数,无副作用) */
export interface IEEE754SpecialSpec {
    /** 表格"名称"列文案 */
    readonly name: string;
    /** 由精度格式计算该值的 [S, E, M] 原始位域 */
    readonly bits: (format: IEEE754Format) => IEEE754SpecialBits;
}

/**
 * 特殊值参考表数据(顺序即表格展示顺序,与原实现逐行一致).
 * 指数字段的"全 1 / 全 1 减 1 / 尾数全 1"一律由上面的纯函数按 format 算出,
 * 不在数据里硬编码不同精度的具体数值.
 */
export const IEEE754_SPECIAL_VALUES: IEEE754SpecialSpec[] = [
    // 正零 +0:符号 0 / 指数域 0 / 尾数域 0
    { name: '正零 +0', bits: () => ({ sign: 0, exponentField: 0, fraction: 0 }) },
    // 负零 -0:符号 1,其余同正零
    { name: '负零 -0', bits: () => ({ sign: 1, exponentField: 0, fraction: 0 }) },
    // 正无穷 +∞:指数域全 1 / 尾数域 0
    { name: '正无穷 +∞', bits: (f) => ({ sign: 0, exponentField: exponentFieldAllOnes(f), fraction: 0 }) },
    // 负无穷 -∞:符号 1,其余同正无穷
    { name: '负无穷 -∞', bits: (f) => ({ sign: 1, exponentField: exponentFieldAllOnes(f), fraction: 0 }) },
    // NaN 非数:指数域全 1 / 尾数域非 0(取 1)
    { name: 'NaN 非数', bits: (f) => ({ sign: 0, exponentField: exponentFieldAllOnes(f), fraction: 1 }) },
    // 最小正规格化数:指数域 1 / 尾数域 0
    { name: '最小正规格化数', bits: () => ({ sign: 0, exponentField: 1, fraction: 0 }) },
    // 最小正次规格化数:指数域 0 / 尾数域 1
    { name: '最小正次规格化数', bits: () => ({ sign: 0, exponentField: 0, fraction: 1 }) },
    // 最大有限值:指数域全 1 减 1 / 尾数域全 1
    {
        name: '最大有限值',
        bits: (f) => ({
            sign: 0,
            exponentField: exponentFieldMaxFinite(f),
            fraction: fractionFieldAllOnes(f),
        }),
    },
];

// ============================================================
// DOM 契约(id / 选择器,与 index.html 完全一致)
// ============================================================

/** IEEE754 控件用到的 DOM 元素 id 与 data-role 选择器 */
export const IEEE754_DOM = {
    /** 精度下拉框的 id */
    formatId: 'ieee-format',
    /** 十进制输入框的 id */
    inputId: 'ieee-input',
    /** 转换按钮的 id */
    convertId: 'ieee-convert',
    /** 位图容器的 id */
    bitsId: 'ieee-bits',
    /** 位串文本的 id */
    bitstringId: 'ieee-bitstring',
    /** 分解信息的 id */
    breakdownId: 'ieee-breakdown',
    /** 公式容器的 id */
    formulaId: 'ieee-formula',
    /** 错误提示的 id */
    errorId: 'ieee-error',
    /** 特殊值表的 id */
    specialId: 'ieee-special',
    /** 指数位数提示的选择器 */
    expBitsSelector: '[data-role="exp-bits"]',
    /** 尾数位数提示的选择器 */
    fracBitsSelector: '[data-role="frac-bits"]',
} as const;

/** 找不到 DOM 元素时的 console.warn 文案(可见文本,保持原样) */
export const IEEE754_DOM_MISSING_MESSAGE =
    '[IEEE754] 找不到 #ieee-format/#ieee-input/#ieee-bits 等 DOM 元素';

// ============================================================
// 位图 class 名(与 ieee754.css 保持一致)
// ============================================================

/** 单个比特方块的类名 */
export const IEEE754_BIT_CLASS = 'ieee-bit';

/** 比特分组容器的类名 */
export const IEEE754_BIT_GROUP_CLASS = 'ieee-bit-group';

/** 4 位间距占位元素的类名 */
export const IEEE754_GAP_CLASS = 'ieee-gap';

/** 符号位分组的类名 */
export const IEEE754_SIGN_CLASS = 'ieee-sign';

/** 指数域分组的类名 */
export const IEEE754_EXP_CLASS = 'ieee-exp';

/** 尾数域分组的类名 */
export const IEEE754_FRAC_CLASS = 'ieee-frac';

/** 置位比特附加的类名 */
export const IEEE754_ON_CLASS = 'on';

/** 分解信息里弱化文字的类名 */
export const IEEE754_MUTED_CLASS = 'ieee-muted';

/** 特殊值表格的类名 */
export const IEEE754_SPECIAL_TABLE_CLASS = 'ieee-special-table';

/** 特殊值表格里位模式单元格的类名(与 .ieee-bits 共用) */
export const IEEE754_BITS_CLASS = 'ieee-bits';

// ============================================================
// 可见文案(保持原样)
// ============================================================

/** 特殊值表格的表头文案(顺序即列顺序) */
export const IEEE754_SPECIAL_TABLE_HEADERS = ['名称', '位模式 (S / E / M)', '数值'] as const;

/** 特殊值表格行的 title 提示 */
export const IEEE754_SPECIAL_ROW_TITLE = '点击载入此特殊值';

/** 空输入时的错误文案 */
export const IEEE754_ERR_EMPTY_INPUT = '请输入数值或位串.';

/** 无法解析数值时的错误文案前缀 */
export const IEEE754_ERR_UNPARSABLE_PREFIX = '无法解析的数值: "';

/** 无法解析数值时的错误文案后缀 */
export const IEEE754_ERR_UNPARSABLE_SUFFIX = '"';

/** 错误提示在 UI 上显示时的前缀表情 */
export const IEEE754_ERROR_UI_PREFIX = '⚠️ ';

/** 公式渲染相关:KaTeX 选项(保持与原先完全一致) */
export const IEEE754_KATEX_OPTIONS = {
    /** 使用展示模式(独立成行居中) */
    displayMode: true,
    /** 出错时不抛异常,而是渲染错误标记 */
    throwOnError: false,
    /** 不允许 \href 等可信命令 */
    trust: false,
} as const;
