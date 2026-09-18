// ================================================================
// LED 时钟(clock.ts)常量配置
//
// 这里集中 clock.ts 里所有"设计参数"字面量:字形几何,像素颜色,刷新
// 间隔与可见文案.canvas 尺寸由 index.html 的 width/height 写死(JS 从
// 不设置),故不在此配置尺寸.数值与拆分前的字面量逐位一致.
// ================================================================

/**
 * 找不到 canvas 时的告警文案(可见文本,与原先完全一致).
 * canvas 的 id 就一次性地写在 getElementById 调用处,不另行配置.
 */
export const CLOCK_CANVAS_MISSING_MESSAGE =
    '[LED Clock] 找不到 canvas 元素: #time_canvas';

// ---------- 时序 ----------

/** 刷新间隔(毫秒):每 1000ms 重绘一次 */
export const REFRESH_INTERVAL_MS = 1000;

/** 单个 LED 像素点绘制成 1×1 的方块(逻辑像素) */
export const PIXEL_SIZE = 1;

// ---------- 调色板 ----------

/** 点亮的 LED 像素颜色(青色) */
export const PIXEL_COLOR = '#00ffff';

/** 画布背景色(黑色) */
export const BACKGROUND_COLOR = '#000';

// ---------- 字形几何(单位:像素) ----------

/** 每个数字 glyph 占 3 列(每列 5 位二进制) */
export const DIGIT_COLUMNS = 3;

/** 每个 glyph 占 5 行(位宽 5,最高位对应最上面一行) */
export const DIGIT_ROWS = 5;

/** 行位序取值的基准:位 4 对应第 0 行,故行索引位移量为 4 - row */
export const ROW_BIT_BASE = 4;

/** 字形在画布中的顶部偏移:上方空 1 行 */
export const GLYPH_TOP_OFFSET = 1;

/** 数字绘制后 x 的推进量(像素):3 列字形 + 1 列间距 */
export const DIGIT_ADVANCE = 4;

/** 点号 / 冒号绘制后 x 的推进量(像素):1 列 + 1 列间距 */
export const PUNCT_ADVANCE = 2;

/** 时间字符串里的日期分隔符 */
export const DOT_CHAR = '.';

/** 时间字符串里的时间分隔符 */
export const COLON_CHAR = ':';

// ---------- 7 段码字形表 ----------

/** 数字段类型:每个数字由 DIGIT_COLUMNS 列组成,每列为 DIGIT_ROWS 位二进制数 */
type DigitSegments = Uint8Array;

/**
 * 7 段码数字定义(高 5px,宽 3px):
 * 每 3 个字节为一个数字(0-9),每字节低 5 位自高到低对应第 0-4 行.
 */
export const DIGIT_SEGMENTS: DigitSegments = new Uint8Array([
    0b11111, 0b10001, 0b11111, // 0
    0b01001, 0b11111, 0b00001, // 1
    0b10111, 0b10101, 0b11101, // 2
    0b10101, 0b10101, 0b11111, // 3
    0b11100, 0b00100, 0b11111, // 4
    0b11101, 0b10101, 0b10111, // 5
    0b11111, 0b10101, 0b10111, // 6
    0b10000, 0b10000, 0b11111, // 7
    0b11111, 0b10101, 0b11111, // 8
    0b11101, 0b10101, 0b11111  // 9
]);

/** 点号定义(用于日期分隔符):每列一个字节,共 DIGIT_ROWS 行,仅最下面一行为 1 */
export const DOT_SEGMENTS: DigitSegments = new Uint8Array([0b0, 0b0, 0b0, 0b0, 0b1]);

/** 冒号定义(用于时间分隔符):第 2,4 行(索引 1,3)点亮的竖排两点 */
export const COLON_SEGMENTS: DigitSegments = new Uint8Array([0b0, 0b1, 0b0, 0b1, 0b0]);

/** 数字解析进制(parseInt 第二参数) */
export const DIGIT_RADIX = 10;
