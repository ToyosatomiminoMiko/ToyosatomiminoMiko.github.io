// ================================================================
// IEEE 754 浮点可视化(ieee754/ieee754.ts)常量配置
//
// 只放**声明式常量**:精度格式(FLOAT32 / FLOAT64),格式索引表,分类阈值
// 纯函数,特殊值的原始位域描述,位运算掩码与位移,位图展示分组宽度,
// DOM 契约与可见文案.这里不引用逻辑层函数,也没有模块级可变状态.
// 数值与拆分前的字面量逐位一致.
// ================================================================
import type {
    IEEE754Format,
} from './types';

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

/**
 * 某位宽的全 1 值:2^n - 1.
 * 这里必须用 2**n,不能用 1<<n:JS 的移位量按 mod 32 取,float64 的尾数是 52 位,
 * `1 << 52` 会退化成 `1 << 20`(算出 1048575 而非 4503599627370495),
 * 于是"最大有限值"被算成一个远小于真值的数.29 位以内两者同值,故只有 float64
 * 的尾数露了这个雷.(n>53 时 number 本身不再精确,但那已不是 f32/f64 的范围.)
 */
function allOnes(bits: number): number {
    return 2 ** bits - 1;
}

/** 指数域全 1 时的值(全 1 表示 ±∞ 或 NaN) */
export function exponentFieldAllOnes(format: IEEE754Format): number {
    return allOnes(format.exponentBits);
}

/** 最大有限值对应的指数域(全 1 减 1) */
export function exponentFieldMaxFinite(format: IEEE754Format): number {
    return exponentFieldAllOnes(format) - 1;
}

/** 尾数域全 1 时的值(最大有效位模式) */
export function fractionFieldAllOnes(format: IEEE754Format): number {
    return allOnes(format.fractionBits);
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
// DOM 契约(id,与面板组件 ui/ieee754_panel.ts 生成的标记一致)
//
// 面板原先写死在 index.html 的 #ieee754 窗格里,这些 id 是"行为按 id 去 DOM 里
// 找元素"的契约;现在反过来:宿主只提供空窗格,id 由组件生成时写上(留给 CSS 与
// 调试定位),行为代码拿组件交回的**元素引用**,不再 getElementById.
// 因此这里只保留 id,不再有 querySelector 选择器.
// ============================================================

/** IEEE754 面板生成的 DOM 元素 id(样式见 public/css/ieee754.css) */
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
} as const;

// ============================================================
// 面板的声明式模型(整块卡片由 ui/ieee754_panel.ts 按此生成)
//
// 结构与文案原先写死在 index.html 里,现在只在这里声明一次:组件按模型生成标记,
// 行为代码只跟组件交回的元素引用打交道.类名是 bootstrap 与 ieee754.css 的契约,
// 逐个照搬原标记,不合并 / 不省略.
// ============================================================

/** 卡片外壳类名(bootstrap) */
export const IEEE754_CARD_CLASS = 'card';

/** 卡片标题栏类名(bootstrap) */
export const IEEE754_CARD_HEADER_CLASS = 'card-header';

/** 卡片主体类名(bootstrap) */
export const IEEE754_CARD_BODY_CLASS = 'card-body';

/** 卡片标题文案(标题标签是 h4,由组件给出) */
export const IEEE754_PANEL_TITLE = '🧮 IEEE 754 浮点可视化';

/**
 * 顶部提示段落文案(逐字照搬原标记里的三句).
 * 原先分三行写,浏览器按空白折叠渲染;这里合成一行(用空格连接),可见文本不变.
 */
export const IEEE754_HINT_TEXT =
    '💡 输入十进制小数或长度匹配的 0/1 位串后点「转换」按钮转二进制;也可以点按下面的二进制位(0/1)直接改位. ' +
    '一切以二进制位为准,KaTeX 公式按递等链单向展示(二进制带入 = 十进制 = 精确十进制值). ' +
    '尾数高位在左,低位在右,每 4 位一组.';

/** 提示段落的类名(样式见 ieee754.css 的 .ieee-hint) */
export const IEEE754_HINT_CLASS = 'ieee-hint';

/** 精度 / 输入那一行的栅格类名(bootstrap,逐个照搬原标记) */
export const IEEE754_CONTROLS_ROW_CLASS = 'row g-3 align-items-center mb-3';

/** 左列(精度下拉框)的栅格类名:宽度随内容 */
export const IEEE754_COL_AUTO_CLASS = 'col-auto';

/** 右列(输入框 + 转换按钮)的栅格类名:半宽 */
export const IEEE754_COL_HALF_CLASS = 'col-6';

/** 表单标签类名(bootstrap) */
export const IEEE754_LABEL_CLASS = 'form-label mb-0';

/** 精度下拉框类名(bootstrap) */
export const IEEE754_SELECT_CLASS = 'form-select form-select-sm';

/** 输入框外层输入组类名(bootstrap) */
export const IEEE754_INPUT_GROUP_CLASS = 'input-group input-group-sm';

/** 十进制输入框类名(bootstrap) */
export const IEEE754_INPUT_CLASS = 'form-control';

/** 转换按钮类名(bootstrap) */
export const IEEE754_BUTTON_CLASS = 'btn btn-primary';

/** 转换按钮的 type:普通按钮,不提交表单(原标记就是 type="button") */
export const IEEE754_BUTTON_TYPE = 'button';

/** 精度下拉框的 label 文案 */
export const IEEE754_FORMAT_LABEL = '精度';

/** 十进制输入框的 label 文案 */
export const IEEE754_INPUT_LABEL = '十进制数值';

/** 十进制输入框的初值(与原标记的 value 逐字一致) */
export const IEEE754_INPUT_INITIAL_VALUE = '3.14';

/** 十进制输入框的 spellcheck 属性值:关掉拼写检查(数值不该被标红) */
export const IEEE754_INPUT_SPELLCHECK = 'false';

/** 转换按钮文案 */
export const IEEE754_CONVERT_LABEL = '转换';

/** 错误提示容器的类名(样式见 ieee754.css 的 .ieee-error),初始 hidden */
export const IEEE754_ERROR_CLASS = 'ieee-error';

/** 位图 / 公式 / 特殊值三个分区的类名(样式见 ieee754.css 的 .ieee-section) */
export const IEEE754_SECTION_CLASS = 'ieee-section';

/** 图例条类名(样式见 ieee754.css 的 .ieee-legend) */
export const IEEE754_LEGEND_CLASS = 'ieee-legend';

/** 位串文本类名(样式见 ieee754.css 的 .ieee-bitstring) */
export const IEEE754_BITSTRING_CLASS = 'ieee-bitstring';

/** 分解信息类名(样式见 ieee754.css 的 .ieee-breakdown) */
export const IEEE754_BREAKDOWN_CLASS = 'ieee-breakdown';

/** 公式 / 特殊值分区标题的类名(样式见 ieee754.css 的 .ieee-formula-title) */
export const IEEE754_FORMULA_TITLE_CLASS = 'ieee-formula-title';

/** 公式容器类名(样式见 ieee754.css 的 .ieee-formula) */
export const IEEE754_FORMULA_CLASS = 'ieee-formula';

/** 特殊值容器类名(样式见 ieee754.css 的 .ieee-special) */
export const IEEE754_SPECIAL_CLASS = 'ieee-special';

/** 公式分区标题文案 */
export const IEEE754_FORMULA_TITLE = '公式 (KaTeX)';

/** 特殊值分区标题文案 */
export const IEEE754_SPECIAL_TITLE = '特殊值参考 (点击载入)';

/** 精度下拉框的一个 option:取值 / 文案 / 是否默认选中 */
export interface IEEE754FormatOptionSpec {
    /** option 的 value(类型契约,与 FLOAT32_KEY / FLOAT64_KEY 一致) */
    readonly value: string;
    /** option 的可见文案 */
    readonly label: string;
    /** 是否带 selected 属性(默认选中项) */
    readonly selected: boolean;
}

/** 精度下拉框的两个 option(顺序即界面顺序,f64 默认选中) */
export const IEEE754_FORMAT_OPTIONS = [
    { value: FLOAT32_KEY, label: '单精度 float32 (32位)', selected: false },
    { value: FLOAT64_KEY, label: '双精度 float64 (64位)', selected: true },
] as const satisfies readonly IEEE754FormatOptionSpec[];

/** 指数位数提示的 data-role(组件据此生成 `<b data-role="exp-bits">`) */
export const IEEE754_EXP_BITS_ROLE = 'exp-bits';

/** 尾数位数提示的 data-role(组件据此生成 `<b data-role="frac-bits">`) */
export const IEEE754_FRAC_BITS_ROLE = 'frac-bits';

/**
 * 图例条里的一段内容:纯文本,或一个"位数提示"元素.
 * 位数提示在标记上是 `<b data-role="...">11</b>` 这种形状,由组件生成;
 * data-role 只用于生成与调试,行为代码拿的是组件交回的 <b> 引用.
 */
export type IEEE754LegendPart =
    | { readonly text: string }
    | { readonly bitsRole: string; readonly bits: number };

/** 图例项:类名(决定颜色)+ 内容片段(顺序即标记顺序) */
export interface IEEE754LegendSpec {
    /** ieee754.css 按 `.ieee-legend .ieee-s / -e / -m` 上色 */
    readonly className: string;
    readonly parts: readonly IEEE754LegendPart[];
}

/** 图例三项(顺序即界面顺序;位数初值取默认精度 float64 的 11 / 52) */
export const IEEE754_LEGENDS = [
    { className: 'ieee-s', parts: [{ text: 'S 符号' }] },
    {
        className: 'ieee-e',
        parts: [
            { text: 'E 指数(' },
            { bitsRole: IEEE754_EXP_BITS_ROLE, bits: FLOAT64.exponentBits },
            { text: ' bit)' },
        ],
    },
    {
        className: 'ieee-m',
        parts: [
            { text: 'M 尾数(' },
            { bitsRole: IEEE754_FRAC_BITS_ROLE, bits: FLOAT64.fractionBits },
            { text: ' bit)' },
        ],
    },
] as const satisfies readonly IEEE754LegendSpec[];

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
