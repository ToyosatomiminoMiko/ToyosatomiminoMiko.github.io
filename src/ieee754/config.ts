// ================================================================
// IEEE 754 浮点可视化(ieee754.ts / ui/ieee754_panel.ts)的声明式常量
//
// 只放常量与纯函数:精度格式,分类阈值,位运算掩码与位移,位图展示参数,
// DOM 契约与可见文案.不引用逻辑层,也没有模块级可变状态 -- 结构 / 类名 / 文案
// 只在这里声明一次,组件与行为代码都从这里取.
// ================================================================
import type {
    IEEE754Format,
} from './types';

// ============================================================
// 精度格式
// ============================================================

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

export const FLOAT32_KEY = 'f32';

export const FLOAT64_KEY = 'f64';

/** 精度取值的字面量联合:IEEE754_FORMATS 的键,也是菜单项 value 的类型契约 */
export type IEEE754FormatKey = typeof FLOAT32_KEY | typeof FLOAT64_KEY;

export const IEEE754_FORMATS: Record<IEEE754FormatKey, IEEE754Format> = {
    [FLOAT32_KEY]: FLOAT32,
    [FLOAT64_KEY]: FLOAT64,
};

// ============================================================
// 分类阈值
// ============================================================

/**
 * 某位宽的全 1 值 2^n - 1.
 * 必须用 2**n 而不是 1 << n:JS 的移位量按 mod 32 取,float64 的尾数 52 位会让
 * `1 << 52` 退化成 `1 << 20`(得 1048575 而非 4503599627370495),把"最大有限值"
 * 算成一个远小于真值的数.29 位以内两者同值,所以只有 float64 的尾数会踩到这个坑.
 */
function allOnes(bits: number): number {
    return 2 ** bits - 1;
}

/** 指数域全 1(保留编码:±∞ 或 NaN) */
export function exponentFieldAllOnes(format: IEEE754Format): number {
    return allOnes(format.exponentBits);
}

/** 最大有限值的指数域(全 1 减 1;再大就溢出成 ±∞) */
export function exponentFieldMaxFinite(format: IEEE754Format): number {
    return exponentFieldAllOnes(format) - 1;
}

/** 尾数域全 1(最大有效位模式) */
export function fractionFieldAllOnes(format: IEEE754Format): number {
    return allOnes(format.fractionBits);
}

/** 零的指数域与尾数域都是 0,分类判定两处共用同一个值 */
export const IEEE754_ZERO_FIELD = 0;

// ============================================================
// 位运算掩码 / 位移
//
// float32 走 number 位运算,float64 走 BigInt(number 装不下 64 位,取位本身也得
// 用 BigUint64Array);两套常量分开命名,避免把 bigint 混进 number 的表达式.
// ============================================================

/** 符号位在 float32 位串中的位移(最高位) */
export const F32_SIGN_SHIFT = 31;

/** 指数域在 float32 位串中的位移 */
export const F32_EXPONENT_SHIFT = 23;

/** 尾数域掩码(float32):低 23 位全 1 */
export const F32_FRACTION_MASK = 0x7fffff;

/** 指数域掩码(float32):低 8 位全 1 */
export const F32_EXPONENT_MASK = 0xff;

/** 符号位掩码(number 版,最低 1 位) */
export const IEEE754_SIGN_MASK = 1;

/** 符号位在 float64 位串中的位移(最高位) */
export const F64_SIGN_SHIFT = 63n;

/** 指数域在 float64 位串中的位移 */
export const F64_EXPONENT_SHIFT = 52n;

/** 尾数域掩码(float64):低 52 位全 1 */
export const F64_FRACTION_MASK = 0xfffffffffffffn;

/** 指数域掩码(float64):低 11 位全 1 */
export const F64_EXPONENT_MASK = 0x7ffn;

/** 符号位掩码(BigInt 版,与 IEEE754_SIGN_MASK 同值:number 与 bigint 不能混算) */
export const F64_SIGN_MASK = 1n;

// ============================================================
// 位图展示 / 位串解析
// ============================================================

/** 符号段在完整位串中的起始下标 */
export const IEEE754_SIGN_START = 0;

/** 指数段起始下标(紧跟符号位) */
export const IEEE754_EXPONENT_START = 1;

/** 位图每 4 位插一个间距(展示约定,间距元素只占位不上色) */
export const IEEE754_BIT_GROUP_SIZE = 4;

export const IEEE754_BINARY_RADIX = 2;

export const IEEE754_BITSTRING_PATTERN = /^[01]+$/;

/** 十进制输入里可直接写 "nan" 表示 NaN(不区分大小写,Number() 认不出来) */
export const IEEE754_NAN_TEXT = 'nan';

// ============================================================
// 特殊值参考表(只声明原始位域,由 ieee754.ts 映射成 IEEE754Value)
// ============================================================

/** 特殊值的原始位域(不含隐含位 / 未减 bias) */
export interface IEEE754SpecialBits {
    /** 符号位:0(正)或 1(负) */
    readonly sign: number;
    /** 指数域原始值(未减 bias) */
    readonly exponentField: number;
    /** 尾数域原始值(不含隐含位) */
    readonly fraction: number;
}

/** 特殊值一行:展示名 + 由精度格式算出原始位域(纯函数) */
export interface IEEE754SpecialSpec {
    /** 表格"名称"列文案 */
    readonly name: string;
    /** 由精度格式计算该值的 [S, E, M] 原始位域 */
    readonly bits: (format: IEEE754Format) => IEEE754SpecialBits;
}

/**
 * 特殊值参考表(顺序即表格展示顺序).
 * "指数域全 1 / 全 1 减 1 / 尾数全 1"一律由上面的纯函数按 format 算出,不硬编码
 * 各精度的具体数值 -- 同一张表要同时服务 float32 与 float64.
 */
export const IEEE754_SPECIAL_VALUES: IEEE754SpecialSpec[] = [
    { name: '正零 +0', bits: () => ({ sign: 0, exponentField: 0, fraction: 0 }) },
    { name: '负零 -0', bits: () => ({ sign: 1, exponentField: 0, fraction: 0 }) },
    { name: '正无穷 +∞', bits: (f) => ({ sign: 0, exponentField: exponentFieldAllOnes(f), fraction: 0 }) },
    { name: '负无穷 -∞', bits: (f) => ({ sign: 1, exponentField: exponentFieldAllOnes(f), fraction: 0 }) },
    // NaN 只要求尾数域非 0,取最小的 1
    { name: 'NaN 非数', bits: (f) => ({ sign: 0, exponentField: exponentFieldAllOnes(f), fraction: 1 }) },
    // 最小正规格化数 / 最小正次规格化数分别贴着 E=1,M=0 与 E=0,M=1 两个边界
    { name: '最小正规格化数', bits: () => ({ sign: 0, exponentField: 1, fraction: 0 }) },
    { name: '最小正次规格化数', bits: () => ({ sign: 0, exponentField: 0, fraction: 1 }) },
    // 最大有限值:指数比全 1 小 1,尾数全 1
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
// DOM 契约:id 与 ui/ieee754_panel.ts 生成的标记一致,样式在 public/css/ieee754.css
//
// 宿主只提供空窗格;id 由组件生成时写上(留给 CSS 与调试定位),行为代码拿的是组件
// 交回的元素引用,不做 getElementById,所以这里只留 id,没有选择器.
// ============================================================

export const IEEE754_DOM = {
    /** 精度菜单触发按钮(菜单浮层挂在它的锚点里) */
    formatId: 'ieee-format',
    inputId: 'ieee-input',
    convertId: 'ieee-convert',
    bitsId: 'ieee-bits',
    bitstringId: 'ieee-bitstring',
    breakdownId: 'ieee-breakdown',
    formulaId: 'ieee-formula',
    /** 错误提示(初始 hidden) */
    errorId: 'ieee-error',
    specialId: 'ieee-special',
} as const;

// ============================================================
// 面板的声明式模型(ui/ieee754_panel.ts 按此生成整块面板)
//
// 结构与可见文案只在这里声明一次,组件按模型生成标记,行为代码只跟组件交回的
// 元素引用打交道.类名与 public/css/ieee754.css 的选择器一一对应,不合并 / 不省略.
// ============================================================

/** 面板标题文案(全站不用 emoji) */
export const IEEE754_PANEL_TITLE = 'IEEE 754 浮点可视化';

/** 顶部提示段落文案(三句以空格连接成一个段落) */
export const IEEE754_HINT_TEXT =
    '输入十进制小数或长度匹配的 0/1 位串后点「转换」按钮转二进制;也可以点按下面的二进制位(0/1)直接改位. ' +
    '一切以二进制位为准,KaTeX 公式按递等链单向展示(二进制带入 = 十进制 = 精确十进制值). ' +
    '尾数高位在左,低位在右,每 4 位一组.';

export const IEEE754_HINT_CLASS = 'ieee-hint';

/** 精度 / 输入那一行的类名(两列布局:左列随内容,右列半宽) */
export const IEEE754_CONTROLS_ROW_CLASS = 'ieee-controls';

export const IEEE754_CONTROLS_FORMAT_CLASS = 'ieee-controls__format';

export const IEEE754_CONTROLS_INPUT_CLASS = 'ieee-controls__input';

/** 表单标签类名(精度 / 十进制两个 label 共用) */
export const IEEE754_LABEL_CLASS = 'ieee-controls__label';

/**
 * 精度菜单浮层的锚点类名(UI 库 `menu-anchor` 这个字面量).
 *
 * 触发按钮与菜单面板都装在这个锚点里:库的 widgets.css 给它 `position: relative`,
 * 面板(`.menu-popover`)才能按 `top: 100%` 挂在按钮下沿.少写这个类不会报错 -- 面板
 * 会改为相对更外层的定位祖先定位,只是位置不对,所以它写成具名常量,与库的样式表
 * 一一对应.
 */
export const IEEE754_FORMAT_ANCHOR_CLASS = 'menu-anchor';

export const IEEE754_INPUT_GROUP_CLASS = 'ieee-input-group';

export const IEEE754_INPUT_CLASS = 'ieee-input';

/** 精度菜单的标签文案(label 与菜单分组标题共用) */
export const IEEE754_FORMAT_LABEL = '精度';

export const IEEE754_INPUT_LABEL = '十进制数值';

export const IEEE754_INPUT_INITIAL_VALUE = '3.14';

/** 输入框 spellcheck 属性值:数值不该被拼写检查标红 */
export const IEEE754_INPUT_SPELLCHECK = 'false';

export const IEEE754_CONVERT_LABEL = '转换';

/** 错误提示容器类名(初始 hidden) */
export const IEEE754_ERROR_CLASS = 'ieee-error';

/** 位图 / 公式 / 特殊值三个分区的类名 */
export const IEEE754_SECTION_CLASS = 'ieee-section';

export const IEEE754_LEGEND_CLASS = 'ieee-legend';

export const IEEE754_BITSTRING_CLASS = 'ieee-bitstring';

export const IEEE754_BREAKDOWN_CLASS = 'ieee-breakdown';

/** 公式 / 特殊值两个分区标题的类名(共用) */
export const IEEE754_FORMULA_TITLE_CLASS = 'ieee-formula-title';

export const IEEE754_FORMULA_CLASS = 'ieee-formula';

export const IEEE754_SPECIAL_CLASS = 'ieee-special';

export const IEEE754_FORMULA_TITLE = '公式 (KaTeX)';

export const IEEE754_SPECIAL_TITLE = '特殊值参考 (点击载入)';

export interface IEEE754FormatChoiceSpec {
    /** 菜单项 value(类型契约,与 FLOAT32_KEY / FLOAT64_KEY 一致) */
    readonly value: string;
    /** 菜单项可见文案(也是当前精度显示在触发按钮上的文案) */
    readonly label: string;
    /** 菜单项右侧小字(库的 `.menu-item-hint`) */
    readonly hint: string;
    /** 是否初始当前项(菜单 `setActive` 的目标;有且只有一条为 true) */
    readonly active: boolean;
}

/** 精度菜单的两项(顺序即菜单顺序,f64 默认是当前项) */
export const IEEE754_FORMAT_CHOICES = [
    { value: FLOAT32_KEY, label: 'float  (32bit)', hint: '单精度', active: false },
    { value: FLOAT64_KEY, label: 'double (64bit)', hint: '双精度', active: true },
] as const satisfies readonly IEEE754FormatChoiceSpec[];

/** 初始精度项:声明里 active 的那一条(菜单与行为代码共用同一份推导) */
export const IEEE754_DEFAULT_FORMAT_CHOICE: IEEE754FormatChoiceSpec =
    IEEE754_FORMAT_CHOICES.find((choice) => choice.active) ?? IEEE754_FORMAT_CHOICES[0];

export const IEEE754_DEFAULT_FORMAT_VALUE: string = IEEE754_DEFAULT_FORMAT_CHOICE.value;

/** 指数位数提示的 data-role(组件据此生成 `<b data-role="exp-bits">`) */
export const IEEE754_EXP_BITS_ROLE = 'exp-bits';

/** 尾数位数提示的 data-role(组件据此生成 `<b data-role="frac-bits">`) */
export const IEEE754_FRAC_BITS_ROLE = 'frac-bits';

/**
 * 图例条里的一段内容:纯文本,或一个"位数提示"元素.
 * 位数提示在标记上是 `<b data-role="...">11</b>`,由组件生成并把引用登记进 sink;
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

/** 图例三项(顺序即界面顺序;位数是默认精度 float64 的 11 / 52,行为代码随精度改写) */
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
// 位图 class 名(与 public/css/ieee754.css 一致)
// ============================================================

export const IEEE754_BIT_CLASS = 'ieee-bit';

export const IEEE754_BIT_GROUP_CLASS = 'ieee-bit-group';

export const IEEE754_GAP_CLASS = 'ieee-gap';

export const IEEE754_SIGN_CLASS = 'ieee-sign';

export const IEEE754_EXP_CLASS = 'ieee-exp';

export const IEEE754_FRAC_CLASS = 'ieee-frac';

/** 置位比特附加的类名(不带 ieee- 前缀,与 ieee754.css 的 `.on` 对应) */
export const IEEE754_ON_CLASS = 'on';

export const IEEE754_MUTED_CLASS = 'ieee-muted';

export const IEEE754_SPECIAL_TABLE_CLASS = 'ieee-special-table';

/** 位模式单元格的类名(位图容器与特殊值表格共用同一套位串样式) */
export const IEEE754_BITS_CLASS = 'ieee-bits';

// ============================================================
// 可见文案 / 错误信息(用户可见,逐字固定)
// ============================================================

/** 特殊值表格表头(顺序即列顺序) */
export const IEEE754_SPECIAL_TABLE_HEADERS = ['名称', '位模式 (S / E / M)', '数值'] as const;

/** 特殊值表格行的 title 提示 */
export const IEEE754_SPECIAL_ROW_TITLE = '点击载入此特殊值';

/** 空输入时的错误文案 */
export const IEEE754_ERR_EMPTY_INPUT = '请输入数值或位串.';

/** 无法解析数值时的错误文案前缀(后缀前夹用户原输入) */
export const IEEE754_ERR_UNPARSABLE_PREFIX = '无法解析的数值: "';

/** 无法解析数值时的错误文案后缀 */
export const IEEE754_ERR_UNPARSABLE_SUFFIX = '"';

/** 错误提示在 UI 上显示时的前缀(不用符号 / 表情,直接用字说明) */
export const IEEE754_ERROR_UI_PREFIX = '错误: ';

/** 公式渲染相关:KaTeX 选项 */
export const IEEE754_KATEX_OPTIONS = {
    /** 独立成行居中显示 */
    displayMode: true,
    /** 出错时渲染错误标记而不是抛异常(输入随时可能不合法) */
    throwOnError: false,
    /** 不允许 \href 等可信命令 */
    trust: false,
} as const;
