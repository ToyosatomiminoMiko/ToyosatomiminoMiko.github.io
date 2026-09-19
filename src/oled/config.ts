// ================================================================
// OLED 像素画板(oled/oled.ts)常量配置
//
// 集中 oled/oled.ts 里所有"设计参数":默认画布尺寸,预览色/透明度,画笔与
// 擦除色,导出用常量,缩放与定时器参数,DOM 契约(元素 id 与类名).
// 数值与拆分前的字面量逐位一致,不改变任何行为.
// ================================================================

import type { OledRgb } from './types';

// ---------- 默认配置对象 ----------

/**
 * OLEDCanvas 的绘制参数默认值(不传参时生效).
 * 画布尺寸 / 预览色 / 透明度都只在这里定义一次,其余代码统一引用本对象,
 * 保证"同一个值只有一处定义".
 *
 * 注:`canvasId` 是**标记契约**(元素 id),与绘制参数放在一起只是为了
 * 沿用原来的导出形状;真正生成画布时由 ui/oled_panel.ts 读它写 id,
 * 行为代码不再按 id 查元素.
 */
export const OLED_DEFAULT_CONFIG = {
    /** canvas 元素的 id,默认 'pixelCanvas' */
    canvasId: 'pixelCanvas',
    /** 物理像素宽度,默认 128 */
    width: 128,
    /** 物理像素高度,默认 64 */
    height: 64,
    /** 预览线/矩形的颜色 (CSS 颜色) */
    previewColor: '#FF0000',
    /** 预览透明度 0~1,默认 0.6 */
    previewOpacity: 0.6,
} as const;

// ---------- 像素取值 / 通道 ----------

/**
 * 屏幕"未亮起"(未绘制)的像素颜色:中性灰 #333333.
 * 既作画布初始底色,也是"暗"画笔写入的颜色(等于把像素关掉).
 */
export const OLED_COLOR_UNLIT: OledRgb = { r: 0x33, g: 0x33, b: 0x33 };

/**
 * 屏幕"亮起"(已绘制)的像素颜色:青色 #00ffff.
 * "亮"画笔写入这个颜色;导出位图里 bit=1 也对应它.
 */
export const OLED_COLOR_LIT: OledRgb = { r: 0x00, g: 0xff, b: 0xff };

/** 完全不透明的 Alpha 通道值(画布始终不透明) */
export const OLED_ALPHA_OPAQUE = 0xff;

/** 每个像素在 ImageData 中占 4 个字节(RGBA) */
export const OLED_BYTES_PER_PIXEL = 4;

// 通道偏移只在下面的 fillRgb 内部使用,属于模块私有实现细节
/** R 通道在像素 4 字节中的偏移 */
const OLED_CHANNEL_R_OFFSET = 0;

/** G 通道在像素 4 字节中的偏移 */
const OLED_CHANNEL_G_OFFSET = 1;

/** B 通道在像素 4 字节中的偏移 */
const OLED_CHANNEL_B_OFFSET = 2;

/** A(Alpha)通道在像素 4 字节中的偏移 */
export const OLED_CHANNEL_A_OFFSET = 3;

/** 把一个 RGB 颜色写进 ImageData 的某个像素(R/G/B 三通道,Alpha 不动) */
export const fillRgb = (data: Uint8ClampedArray, base: number, color: OledRgb): void => {
    data[base + OLED_CHANNEL_R_OFFSET] = color.r;
    data[base + OLED_CHANNEL_G_OFFSET] = color.g;
    data[base + OLED_CHANNEL_B_OFFSET] = color.b;
};

/** 每个字节的位数(导出/导入时的页内位宽) */
export const OLED_BITS_PER_BYTE = 8;

/** 单页(页模式)覆盖的行数,等于 OLED_BITS_PER_BYTE */
export const OLED_PAGE_ROWS = 8;

/** MSB 模式下的最高位下标(页内第 0 行对应 bit7) */
export const OLED_MSB_TOP_BIT = 7;

/** 导入数据的字节总数契约:128 列 × 64 行 ÷ 8 = 1024 个十六进制字节 */
export const OLED_BUFFER_BYTES = 1024;

/** 单个字节在导出源码里写成的十六进制位数(如 0x0f) */
export const OLED_HEX_DIGITS_PER_BYTE = 2;

/** 导出 C 源码时每行的字节数 */
export const OLED_BYTES_PER_SOURCE_LINE = 16;

/** 导入时匹配十六进制字节的正则(0x + 两位十六进制) */
export const OLED_HEX_BYTE_PATTERN = /0x[0-9a-fA-F]{2}/g;

/** 解析十六进制用的进制基数 */
export const OLED_HEX_RADIX = 16;

/**
 * 导入数据的错误提示文案(可见文本,保持原样).
 * 其中 1024 与 OLED_BUFFER_BYTES 同源,用模板保证两处只有一个数值来源.
 */
export const OLED_IMPORT_FORMAT_ERROR =
    `❌数据格式错误,需要包含${OLED_BUFFER_BYTES}个十六进制值`;

// ---------- 覆盖层 / 离屏画布 ----------

/** 预览叠加的混合模式(保持二值化核心,不改变主画布) */
export const OLED_PREVIEW_COMPOSITE_OPERATION = 'source-over';

/** 矩形预览描边宽度(像素) */
export const OLED_PREVIEW_STROKE_WIDTH = 1;

/** 预览矩形的半像素对齐偏移(逻辑像素),避免描边跨像素发虚 */
export const OLED_PREVIEW_HALF_PIXEL = 0.5;

// ---------- 定时器 ----------

/** 窗口 resize 后更新画布位置的防抖延时(毫秒) */
export const OLED_RESIZE_DEBOUNCE_MS = 100;

/** 复制成功后按钮文案的还原延时(毫秒) */
export const OLED_COPY_FEEDBACK_MS = 4000;

// ---------- 工具 / 颜色模式取值 ----------

/** 默认画笔颜色模式亮 表示画笔把像素置为未亮(见 OLED_COLOR_UNLIT) */
export const OLED_DEFAULT_COLOR_MODE = 'light';

/** 默认字节序模式:'lsb' 表示低位在前 */
export const OLED_DEFAULT_BYTE_ORDER = 'lsb';

/** 默认绘图工具:'free' 自由画笔 */
export const OLED_DEFAULT_TOOL = 'free';

/**
 * 把一个 RGB 颜色写成 CSS 颜色(如 {51,51,51).
 * 画板像素与按钮底色共用同一个颜色对象,以后改颜色两处一起变.
 */
const rgbToCssColor = ({ r, g, b }: OledRgb): string =>
    `#${[r, g, b].map(v => v.toString(OLED_HEX_RADIX).padStart(OLED_HEX_DIGITS_PER_BYTE, '0')).join('')}`;

/** 画板"未亮起"像素的 CSS 颜色(由 OLED_COLOR_UNLIT 推出) */
export const OLED_UNLIT_CSS_COLOR = rgbToCssColor(OLED_COLOR_UNLIT);

/** 画板"亮起"像素的 CSS 颜色(由 OLED_COLOR_LIT 推出) */
export const OLED_LIT_CSS_COLOR = rgbToCssColor(OLED_COLOR_LIT);

/**
 * 颜色模式相关的文案与配色.
 * 每个模式给出:按钮文案,按钮底色,画笔写入的像素颜色.
 * 画笔颜色与画面像素共用 OLED_COLOR_UNLIT / OLED_COLOR_LIT,
 * 按钮底色也由同一对颜色推出(OLED_UNLIT_CSS_COLOR / OLED_LIT_CSS_COLOR),
 * 保证"按钮显示什么颜色,画笔就写什么颜色".
 * 按钮文字颜色不在这里声明(由 public/css/index.css 的 `#change-color` 定).
 */
export const OLED_COLOR_MODES = {
    /** 暗色模式:画笔把像素关掉(中性灰) */
    dark: {
        /** 按钮文案(暗色) */
        buttonText: '🔄️',
        /** 按钮背景颜色(与画板未亮像素同源) */
        buttonBackgroundColor: OLED_UNLIT_CSS_COLOR,
        /** 画笔写入的像素颜色(未亮起的中性灰) */
        pixelColor: OLED_COLOR_UNLIT,
    },
    /** 亮色模式:画笔把像素点亮(青) */
    light: {
        /** 按钮文案(亮色) */
        buttonText: '🔄️',
        /** 按钮背景颜色(与画板亮起像素同源) */
        buttonBackgroundColor: OLED_LIT_CSS_COLOR,
        /** 画笔写入的像素颜色(亮起的青) */
        pixelColor: OLED_COLOR_LIT,
    },
} as const;

/** 字节序按钮的文案(低位 / 高位模式) */
export const OLED_BYTE_ORDER_TEXT = {
    /** 低位模式(LSB)按钮文案 */
    lsb: '⬇低位模式(LSB)',
    /** 高位模式(MSB)按钮文案 */
    msb: '⬆高位模式(MSB)',
} as const;

// ---------- DOM 契约(id / name / class,与 index.html 完全一致) ----------

/** OLED 控件用到的 DOM 元素 id / name(主画布 id 见 OLED_DEFAULT_CONFIG.canvasId) */
export const OLED_DOM = {
    /** 鼠标位置指示器(红框)的 id */
    indicatorId: 'pixelIndicator',
    /** 坐标文本显示的 id */
    coordsDisplayId: 'coordsDisplay',
    /** 导出结果 textarea 的 id */
    exportTextareaId: 'exportOutput',
    /** 导入数据 textarea 的 id */
    importTextareaId: 'importData',
    /** 复制按钮的 id */
    copyBtnId: 'output-button',
    /** 字节序切换按钮的 id */
    byteOrderBtnId: 'byte-order-btn',
    /** 画笔颜色切换按钮的 id */
    colorBtnId: 'change-color',
    /** 下载 PNG 按钮的 id */
    pngBtnId: 'output-png-btn',
    /** 颜色重置按钮的 id */
    refillBtnId: 'refill-btn',
    /** 导出数据按钮的 id */
    exportBtnId: 'export-btn',
    /** 导入数据按钮的 id */
    importBtnId: 'import-btn',
    /**
     * 工具 radio 的 name(`input[name="tools"]`).
     * id 只留给 CSS 与调试定位,radio 靠 name 成组,顺序由
     * OLED_PANEL_TOOL_OPTIONS 声明 -- 面板直接把 radio 引用交回行为代码,
     * 不再用 `input[name="tools"]` 选择器回头查 DOM.
     */
    toolRadioName: 'tools',
} as const;

// ---------- 可见文案(保持原样,集中一处便于校对) ----------

/** Canvas 2D 上下文不可用时的异常文案 */
export const OLED_CONTEXT_UNAVAILABLE = '[OLEDCanvas] Canvas 2D 上下文不可用';

/** 找不到 canvas 时的异常文案(与原先的模板拼接结果完全一致) */
export const OLED_CANVAS_MISSING_MESSAGE =
    `[OLEDCanvas] 找不到 canvas 元素: #${OLED_DEFAULT_CONFIG.canvasId}`;

/** 下载 PNG 时使用的文件名 */
export const OLED_PNG_FILENAME = 'canvas.png';

/** 导出 C 源码时使用的位图变量名 */
export const OLED_EXPORT_ARRAY_NAME = 'bitmap';

/** 导出 C 源码时声明的数组长度(与 OLED_BUFFER_BYTES 同源) */
export const OLED_EXPORT_ARRAY_LENGTH = OLED_BUFFER_BYTES;

/** 复制按钮的默认文案 */
export const OLED_COPY_BUTTON_TEXT = '复制到剪贴板';

/** 复制成功后的按钮文案 */
export const OLED_COPY_SUCCESS_TEXT = '✅已复制!';

/** 复制失败时的告警文案 */
export const OLED_COPY_FAILED_ALERT = '❌复制失败,请手动选择文本后按 Ctrl+C';

/** 复制失败时的 console.error 前缀 */
export const OLED_COPY_FAILED_LOG = '❌复制失败:';

/** 导入成功时的结果文案 */
export const OLED_IMPORT_SUCCESS_MESSAGE = '✅数据格式正确,已导入!';

/** 导入失败时的结果文案前缀 */
export const OLED_IMPORT_FAILED_PREFIX = '❌导入失败:';

/** 坐标显示文本的格式前缀 */
export const OLED_COORDS_PREFIX = 'coordinate:';

/** 坐标显示的空值占位(未进入画布时) */
export const OLED_COORDS_EMPTY = 'coordinate:(X:-,Y:-)';

/** 指示器 / 坐标显示可见时的 display 值 */
export const OLED_DISPLAY_VISIBLE = 'block';

/** 指示器隐藏时的 display 值 */
export const OLED_DISPLAY_HIDDEN = 'none';

/** 鼠标按下事件的按钮掩码(左键/右键) */
export const OLED_MOUSE_BUTTON_MASK = 3;

// ---------- 面板标记的声明式模型(ui/oled_panel.ts 用) ----------
//
// 原先这些字面量写在 index.html 的 `#oled` 窗格里(标签 / 类名 / 文案 / id),
// 现在集中到此处,由 ui/oled_panel.ts 的纯函数生成标记.字符串与拆分前的
// index.html **逐字一致**(类名与 id 直接决定 public/css/index.css 与
// bootstrap 的命中),所以这里只做"搬家",不做任何改名.

/** 面板标题 `<h4>` 的文案 */
export const OLED_PANEL_TITLE_TEXT = 'OLED Canvas';

/** 卡片外框类名:div.card.oled-card(CSS 的 `.oled-card` 定宽) */
export const OLED_PANEL_CARD_CLASS = 'card oled-card';

/** 卡片标题栏类名 */
export const OLED_PANEL_CARD_HEADER_CLASS = 'card-header';

/** 卡片主体类名 */
export const OLED_PANEL_CARD_BODY_CLASS = 'card-body';

/** 坐标显示类名(`.coords-display` 提供底色与等宽字体,card-text 沿用 bootstrap) */
export const OLED_PANEL_COORDS_CLASS = 'coords-display card-text';

/** 坐标显示的初始文案(与 OLED_COORDS_EMPTY 同源) */
export const OLED_PANEL_COORDS_TEXT = OLED_COORDS_EMPTY;

/** 指示器类名(CSS 的 `.pixel-indicator` 定位红框并默认隐藏) */
export const OLED_PANEL_INDICATOR_CLASS = 'pixel-indicator';

/** 工具控制区类名(CSS 的 `.tools`) */
export const OLED_PANEL_TOOLS_CLASS = 'tools';

/** 画笔颜色按钮前面的说明文字(说明它旁边那颗按钮就是画笔) */
export const OLED_PANEL_BRUSH_LABEL_TEXT = '画笔:';

/** 数据输入输出行类名(CSS 的 `.area-data` 提供上下外边距) */
export const OLED_PANEL_ROW_CLASS = 'area-data';

/** 数据 textarea 类名(CSS 的 `.textarea-data` 锁宽 / 等宽字体) */
export const OLED_PANEL_TEXTAREA_CLASS = 'textarea-data';

/** bootstrap 按钮类名(原先每个按钮都写 `btn btn-primary`) */
export const OLED_PANEL_BUTTON_CLASS = 'btn btn-primary';

/** 颜色重置按钮的文案 */
export const OLED_PANEL_REFILL_BUTTON_TEXT = '颜色重置';

/** 导出数据按钮的文案 */
export const OLED_PANEL_EXPORT_BUTTON_TEXT = '导出数据';

/** 下载 PNG 按钮的文案 */
export const OLED_PANEL_PNG_BUTTON_TEXT = '下载PNG';

/** 导入数据按钮的文案 */
export const OLED_PANEL_IMPORT_BUTTON_TEXT = '导入数据';

/** 一个绘图工具 radio 的声明(value 即 DrawTool,label 是 radio 后面的文字) */
export interface OledToolOption {
    /** radio 的 value(DrawTool 取值) */
    readonly value: string;
    /** radio 后面的可见文字 */
    readonly label: string;
}

/**
 * 工具 radio 的声明清单(顺序即原标记的顺序).
 * 默认选中哪一项由 OLED_DEFAULT_TOOL 决定,不在这里重复写死.
 */
export const OLED_PANEL_TOOL_OPTIONS: readonly OledToolOption[] = [
    { value: 'free', label: '绘制' },
    { value: 'line', label: '直线' },
    { value: 'rectangle', label: '矩形' },
];
