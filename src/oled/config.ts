// ================================================================
// OLED 像素画板(oled/oled.ts)常量配置
//
// 集中 oled/oled.ts 里所有"设计参数":默认画布尺寸,预览色/透明度,画笔与
// 擦除色,导出用常量,缩放与定时器参数,DOM 契约(元素 id 与类名).
// 数值与拆分前的字面量逐位一致,不改变任何行为.
// ================================================================

import type { DrawTool, OledRgb } from './types';

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
 * 导入数据的错误提示文案(可见文本,全站不用 emoji).
 * 其中 1024 与 OLED_BUFFER_BYTES 同源,用模板保证两处只有一个数值来源.
 */
export const OLED_IMPORT_FORMAT_ERROR =
    `数据格式错误,需要包含${OLED_BUFFER_BYTES}个十六进制值`;

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
 * 颜色模式相关的文案与画笔颜色.
 * 每个模式给出:按钮文案 + 画笔写入的像素颜色;画笔颜色与画面像素共用
 * OLED_COLOR_UNLIT / OLED_COLOR_LIT.
 * 按钮文案是二值位图的读数:**亮起写 1,未亮写 0**,与导出的 bit 一一对应.
 * 按钮的底色 / 文字颜色都不在这里声明:按钮整颗归 UI 库(`miko_ui`)的基线,
 * 本站不往它身上写任何背景色(所以这颗按钮是透明的,只有 0 / 1 两个字).
 */
export const OLED_COLOR_MODES = {
    /** 暗色模式:画笔把像素关掉(中性灰) */
    dark: {
        /** 按钮文案(未亮 = 0) */
        buttonText: '0',
        /** 画笔写入的像素颜色(未亮起的中性灰) */
        pixelColor: OLED_COLOR_UNLIT,
    },
    /** 亮色模式:画笔把像素点亮(青) */
    light: {
        /** 按钮文案(亮起 = 1) */
        buttonText: '1',
        /** 画笔写入的像素颜色(亮起的青) */
        pixelColor: OLED_COLOR_LIT,
    },
} as const;

/**
 * 字节序按钮的文案(低位 / 高位模式).
 * 原先用上下两个箭头当图示,现在全站不用 emoji,改为文字说明.
 */
export const OLED_BYTE_ORDER_TEXT = {
    lsb: '低位模式(LSB)',
    msb: '高位模式(MSB)',
} as const;

// ---------- DOM 契约(id / class,与 index.html 完全一致) ----------

/** OLED 控件用到的 DOM 元素 id(主画布 id 见 OLED_DEFAULT_CONFIG.canvasId) */
export const OLED_DOM = {
    /** 鼠标位置指示器(红框)的 id */
    indicatorId: 'pixelIndicator',
    /** 坐标文本显示的 id */
    coordsDisplayId: 'coordsDisplay',
    /**
     * 数据编辑器(`.code-editor` 外框)的 id.
     * 导出写入与导入读取的是**同一颗框**:导出的源码本身就是 `0x??` 形式
     * (见 OLED_HEX_BYTE_PATTERN),一个缓冲足够跑完"导出 -> 改 / 粘 -> 导入",
     * 不再分导出框 / 导入框两个 id.
     */
    dataEditorId: 'oledData',
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
    /** 数据编辑器折叠 / 展开按钮的 id */
    editorToggleBtnId: 'editor-toggle-btn',
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
export const OLED_COPY_SUCCESS_TEXT = '已复制!';

/** 复制失败时的告警文案 */
export const OLED_COPY_FAILED_ALERT = '复制失败,请手动选择文本后按 Ctrl+C';

/** 复制失败时的 console.error 前缀 */
export const OLED_COPY_FAILED_LOG = '复制失败:';

/** 导入成功时的结果文案 */
export const OLED_IMPORT_SUCCESS_MESSAGE = '数据格式正确,已导入!';

/** 导入失败时的结果文案前缀 */
export const OLED_IMPORT_FAILED_PREFIX = '导入失败:';

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
// index.html **逐字一致**(类名与 id 直接决定 public/css/index.css 的命中),
// 所以这里只做"搬家",不做任何改名.唯一的例外是框体:它现在由 miko_ui 的
// `createPanel` 建(`section.ui-panel`),类名归库,本站只留定宽的作用域类.

/** 面板标题文案 */
export const OLED_PANEL_TITLE_TEXT = 'OLED Canvas';

/** 本站给面板根追加的作用域类(喂给库的 `createPanel`;CSS 的 `.oled-card` 定宽) */
export const OLED_PANEL_EXTRA_CLASS = 'oled-card';

/** 坐标显示类名(`.coords-display` 提供底色与等宽字体) */
export const OLED_PANEL_COORDS_CLASS = 'coords-display';

/** 坐标显示的初始文案(与 OLED_COORDS_EMPTY 同源) */
export const OLED_PANEL_COORDS_TEXT = OLED_COORDS_EMPTY;

/** 指示器类名(CSS 的 `.pixel-indicator` 定位红框并默认隐藏) */
export const OLED_PANEL_INDICATOR_CLASS = 'pixel-indicator';

/** 工具控制区类名(CSS 的 `.tools`) */
export const OLED_PANEL_TOOLS_CLASS = 'tools';

/** 数据区行类名(CSS 的 `.area-data` 提供上下外边距;唯一一行,只放那颗数据编辑器) */
export const OLED_PANEL_ROW_CLASS = 'area-data';

/*
 * 本站只补 id / 槽宽 / 高亮注入 / 滚动条这四件事
 * (见 ui/oled_panel.ts).
 */

/**
 * 数据编辑器行号槽的宽度(px).
 *
 * 导出数据的形态是固定的(每行同样多的字节),行号槽没有"随行数变宽"的必要;
 * 而库默认按"最大行号位数 × 当前字体的数字宽"自己量,量出来的宽度会在
 * 1 位行号(刚粘贴)与 2 位行号(导出的 67 行)之间跳(实测 32px / 35px),同一颗
 * 框在"粘贴一小段"与"导出整份"之间就会忽宽忽窄.所以这里钉一个常量:既作为库的
 * `gutterMinWidth`,也由 ui/oled_panel.ts 以内联 `!important` 压住库随后写上的
 * 内联值.取值按"3 位数 + 槽内边距 / 边框"留量(实测 3 位需约 45px).
 * 位数再多(例如把 1024 个字节一行一个粘进来)会被 `overflow: hidden` 裁掉,
 * 而不是给行号栏加一条自己的滑条 -- 这是刻意的,见 index.css 的说明.
 */
export const OLED_PANEL_EDITOR_GUTTER_WIDTH = 48;

/**
 * 数据编辑器"展开"状态的类名(挂在库的 `.code-editor` 外框上).
 *
 * 折叠态高度 = `--oled-editor-height`,`is-expanded` 时换成
 * `--oled-editor-expanded-height`(70 行,见 public/css/tokens.css 的算式);
 * 两个高度都由 public/css/index.css 落在 `.oled-card .code-editor` 上.
 * 用类名而不是内联 style:高度是"设计参数",该留在样式表里;行为代码只切状态.
 */
export const OLED_PANEL_EDITOR_EXPANDED_CLASS = 'is-expanded';

/** 颜色重置按钮的文案 */
export const OLED_PANEL_REFILL_BUTTON_TEXT = '颜色重置';

/** 导出数据按钮的文案 */
export const OLED_PANEL_EXPORT_BUTTON_TEXT = '导出数据';

/** 下载 PNG 按钮的文案 */
export const OLED_PANEL_PNG_BUTTON_TEXT = '下载PNG';

/** 导入数据按钮的文案 */
export const OLED_PANEL_IMPORT_BUTTON_TEXT = '导入数据';

/** 折叠 / 展开按钮在**折叠态**下的文案(点一下展开,文案随之换成下面那条) */
export const OLED_PANEL_EDITOR_EXPAND_TEXT = '展开编辑器';

/** 折叠 / 展开按钮在**展开态**下的文案 */
export const OLED_PANEL_EDITOR_COLLAPSE_TEXT = '折叠编辑器';

/** 一个绘图工具选项的声明(value 即 DrawTool,label 是按钮上的文字) */
export interface OledToolOption {
    /** 选项值(DrawTool 取值) */
    readonly value: DrawTool;
    /** 按钮上的可见文字 */
    readonly label: string;
}

/**
 * 工具选项的声明清单(顺序即界面上的先后).
 * 默认选中哪一项由 OLED_DEFAULT_TOOL 决定,不在这里重复写死.
 * 这份清单直接喂给 `miko_ui` 的 `createSegmented`(分段选择器,单选),
 * 结构与库的 `SegmentedItem<DrawTool>` 一致.
 */
export const OLED_PANEL_TOOL_OPTIONS: readonly OledToolOption[] = [
    { value: 'free', label: '绘制' },
    { value: 'line', label: '直线' },
    { value: 'rectangle', label: '矩形' },
];

/** 工具分段选择器的组名(读屏把整组念成一个整体,取 createSegmented 的 ariaLabel) */
export const OLED_PANEL_TOOL_GROUP_LABEL = '绘图工具';
