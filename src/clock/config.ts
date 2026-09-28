// ================================================================
// LED 时钟(clock/clock.ts)常量配置
//
// 声明式模型与全部设计参数字面量:宿主 / 画布的 DOM 契约,画布分辨率,像素
// 与字形几何,调色板,刷新间隔.clock_display.ts 按这里生成标记,clock.ts 按
// 这里绘制;尺寸与几何同处一文件,config.test.ts 才能钉住"排完宽度 == 画布
// 宽度"这条不变量.
// ================================================================

// ---------- DOM 契约(声明式模型) ----------

/**
 * 时钟宿主的 id:HOME 首屏底部左侧的空 div.骨架(src/common/ui/site_shell.ts)
 * 按 src/common/site.config.ts 的 SITE_HOST_IDS.clock 建好它,引用经 main.ts
 * 交给 mountClock(),所以挂载时不做 DOM 查询;这个 id 只供 CSS
 * (public/css/index.css 的 `#app_led_clock`)使用.
 */
export const CLOCK_HOST_ID = 'app_led_clock';

/** 画布 id(样式见 public/css/index.css 的 `#time_canvas`) */
export const CLOCK_CANVAS_ID = 'time_canvas';

/**
 * 画布的逻辑分辨率,写在 canvas 的 width/height **属性**上:CSS 只通过
 * --clock-canvas-height 控制显示高度,宽度按比例缩放.宽 65 = 19 字符的
 * fmt_time() 输出按下面推进量排完的实际列数;高 8 比字形块(顶偏移 1 +
 * DIGIT_ROWS 5)多 2 行余量.
 */
export const CLOCK_CANVAS_WIDTH = 65;
export const CLOCK_CANVAS_HEIGHT = 8;

// ---------- 时序 ----------

/** 重绘间隔(毫秒):显示精确到秒,1Hz 足够 */
export const REFRESH_INTERVAL_MS = 1000;

// ---------- 调色板 ----------

/** 点亮的 LED 像素颜色(青色) */
export const PIXEL_COLOR = '#00ffff';

/** 画布背景色(黑,不透明) */
export const BACKGROUND_COLOR = '#000';

// ---------- 像素与字形几何(单位:像素) ----------

/** 单个 LED 像素的边长:1 逻辑像素,放大后靠 CSS 的 image-rendering: pixelated 保持硬边 */
export const PIXEL_SIZE = 1;

/** 每个数字占 3 列(位宽 3,最高位对应最左边一列) */
export const DIGIT_COLUMNS = 3;

/** 每个 glyph 占 5 行(位宽 5,最高位对应最上面一行) */
export const DIGIT_ROWS = 5;

/** 位序基准:字节的位 4 对应第 0 行(最上面一行),故第 row 行的位移量是 ROW_BIT_BASE - row */
export const ROW_BIT_BASE = 4;

/** 字形整体相对画布顶部的偏移(行),用于把点阵画在画布中间 */
export const GLYPH_TOP_OFFSET = 1;

/** 数字绘制后 x 的推进量:3 列字形 + 1 列间距 */
export const DIGIT_ADVANCE = 4;

/** 点号 / 冒号绘制后 x 的推进量:1 列字形 + 1 列间距 */
export const PUNCT_ADVANCE = 2;

/** 日期分隔符,fmt_time() 输出里的 `.` */
export const DOT_CHAR = '.';

/** 时间分隔符,fmt_time() 输出里的 `:` */
export const COLON_CHAR = ':';

// ---------- 点阵字形表 ----------

/**
 * 字形表类型:数字表每个字节是一**列**(字节内位 4-0 自高到低对应第 0-4 行,
 * 见 ROW_BIT_BASE),标点表每个字节是一**行**.
 */
type DigitSegments = Uint8Array;

/** 数字点阵(5 行 × 3 列):每 3 个字节为一个数字(0-9),字节格式见 DigitSegments */
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

/** 点号:逐行掩码,只有最下面一行(第 4 行)为 1 */
export const DOT_SEGMENTS: DigitSegments = new Uint8Array([0b0, 0b0, 0b0, 0b0, 0b1]);

/** 冒号:逐行掩码,第 1,3 行点亮,即竖排两点 */
export const COLON_SEGMENTS: DigitSegments = new Uint8Array([0b0, 0b1, 0b0, 0b1, 0b0]);

export const DIGIT_RADIX = 10;
