// ================================================================
// OLED 像素画板(oled.ts)常量配置
//
// 集中 oled.ts 里所有"设计参数":默认画布尺寸,预览色/透明度,画笔与
// 擦除色,导出用常量,缩放与定时器参数,DOM 契约(元素 id 与类名).
// 数值与拆分前的字面量逐位一致,不改变任何行为.
// ================================================================

// ---------- 默认配置对象 ----------

/**
 * OLEDCanvas 的默认配置(不传参时生效).
 * 画布尺寸 / 预览色 / 透明度都只在这里定义一次,其余代码(包括下面的
 * OLED_DOM.canvasId)统一引用本对象,保证"同一个值只有一处定义".
 */
export const OLED_DEFAULT_CONFIG = {
    /** canvas 元素的 id,默认 'pixelCanvas' */
    canvasId: 'pixelCanvas',
    /** 物理像素宽度,默认 128 */
    width: 128,
    /** 物理像素高度,默认 64 */
    height: 64,
    /** 预览线/矩形的颜色 (CSS 颜色),默认 '#FF0000' */
    previewColor: '#FF0000',
    /** 预览透明度 0~1,默认 0.6 */
    previewOpacity: 0.6,
} as const;

// ---------- 像素取值 / 通道 ----------

/** 黑色像素的通道值(画笔为"暗"时的着色值) */
export const OLED_VALUE_BLACK = 0;

/** 白色像素的通道值(画布底色 / 画笔为"亮"时的着色值) */
export const OLED_VALUE_WHITE = 255;

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

/** 用画笔值填充 R/G/B 三个通道(逐位保留原实现:三通道写同一个值,Alpha 不动) */
export const fillRgb = (data: Uint8ClampedArray, base: number, value: number): void => {
    data[base + OLED_CHANNEL_R_OFFSET] = value;
    data[base + OLED_CHANNEL_G_OFFSET] = value;
    data[base + OLED_CHANNEL_B_OFFSET] = value;
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

/** 预览用的离屏 canvas 标识名(便于调试,不插入 DOM) */
export const OLED_TEMP_CANVAS_ID = 'oled-preview-canvas';

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

/** 默认画笔颜色模式:'dark' 表示画笔为黑色 */
export const OLED_DEFAULT_COLOR_MODE = 'dark';

/** 默认字节序模式:'lsb' 表示低位在前 */
export const OLED_DEFAULT_BYTE_ORDER = 'lsb';

/** 默认绘图工具:'free' 自由画笔 */
export const OLED_DEFAULT_TOOL = 'free';

/**
 * 颜色模式相关的文案与配色.
 * 每个模式给出:按钮文案,文字色,按钮底色,画笔像素通道值.
 * 画笔值 0 = 黑,255 = 白,与画面像素逐位一致.
 */
export const OLED_COLOR_MODES = {
    /** 暗色模式:画笔为黑底白字按钮 */
    dark: {
        /** 按钮文案(暗色) */
        buttonText: '🔄️暗⬛',
        /** 按钮文字颜色 */
        buttonTextColor: '#ffffff',
        /** 按钮背景颜色 */
        buttonBackgroundColor: '#000000',
        /** 画笔写入的通道值(0 = 黑) */
        pixelValue: 0,
    },
    /** 亮色模式:画笔为白底黑字按钮 */
    light: {
        /** 按钮文案(亮色) */
        buttonText: '🔄️亮⬜',
        /** 按钮文字颜色 */
        buttonTextColor: '#000000',
        /** 按钮背景颜色 */
        buttonBackgroundColor: '#ffffff',
        /** 画笔写入的通道值(255 = 白) */
        pixelValue: 255,
    },
} as const;

/** 字节序按钮的文案(低位 / 高位模式) */
export const OLED_BYTE_ORDER_TEXT = {
    /** 低位模式(LSB)按钮文案 */
    lsb: '⬇低位模式(LSB)',
    /** 高位模式(MSB)按钮文案 */
    msb: '⬆高位模式(MSB)',
} as const;

// ---------- DOM 契约(id / class,与 index.html 完全一致) ----------

/** OLED 控件用到的 DOM 元素 id 与选择器(主画布 id 见 OLED_DEFAULT_CONFIG.canvasId) */
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
    /** 工具 radio 的查询选择器 */
    toolRadioSelector: 'input[name="tools"]',
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
