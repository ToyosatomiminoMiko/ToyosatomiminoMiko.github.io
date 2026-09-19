/*
2025.12.10.23:20:00
APP: #app_led_clock
LED Clock

挂载形态与地铁车窗控制台一致:宿主是**空容器**(由 src/common/ui/site_shell.ts
按 src/common/site.config.ts 建好并交回引用),标记由 ui/clock_display.ts 生成,
本文件只做行为 -- 拿组件交回的画布引用画点阵,不再按 id 去 DOM 里找元素.
*/
import { fmt_time } from '@/common/utils';
import { createClockDisplay } from '@/clock/ui/clock_display';
import {
    BACKGROUND_COLOR,
    COLON_CHAR,
    COLON_SEGMENTS,
    DIGIT_ADVANCE,
    DIGIT_COLUMNS,
    DIGIT_RADIX,
    DIGIT_ROWS,
    DIGIT_SEGMENTS,
    DOT_CHAR,
    DOT_SEGMENTS,
    GLYPH_TOP_OFFSET,
    PIXEL_COLOR,
    PIXEL_SIZE,
    PUNCT_ADVANCE,
    REFRESH_INTERVAL_MS,
    ROW_BIT_BASE,
} from './config';

// 绘制LED数字
function drawDigit(ctx: CanvasRenderingContext2D, digit: number, x: number): void {
    const base = digit * DIGIT_COLUMNS; // 每个数字占 DIGIT_COLUMNS 个字节
    for (let col = 0; col < DIGIT_COLUMNS; col++) {
        const columnData = DIGIT_SEGMENTS[base + col];
        for (let row = 0; row < DIGIT_ROWS; row++) {
            const pixel = (columnData >> (ROW_BIT_BASE - row)) & 1;
            if (pixel) {
                ctx.fillStyle = PIXEL_COLOR;
                ctx.fillRect(x + col, row + GLYPH_TOP_OFFSET, PIXEL_SIZE, PIXEL_SIZE);
            }
        }
    }
}

// 绘制冒号
function drawColon(ctx: CanvasRenderingContext2D, x: number): void {
    for (let row = 0; row < DIGIT_ROWS; row++) {
        const pixel = COLON_SEGMENTS[row];
        if (pixel) {
            ctx.fillStyle = PIXEL_COLOR;
            ctx.fillRect(x, row + GLYPH_TOP_OFFSET, PIXEL_SIZE, PIXEL_SIZE);
        }
    }
}

// 绘制点号
function drawDot(ctx: CanvasRenderingContext2D, x: number): void {
    for (let row = 0; row < DIGIT_ROWS; row++) {
        const pixel = DOT_SEGMENTS[row];
        if (pixel) {
            ctx.fillStyle = PIXEL_COLOR;
            ctx.fillRect(x, row + GLYPH_TOP_OFFSET, PIXEL_SIZE, PIXEL_SIZE);
        }
    }
}

/**
 * 把 LED 时钟挂到宿主里.
 *
 * @param host 时钟的宿主(骨架里的 `#app_led_clock`):只提供空位,
 *             画布由 createClockDisplay() 生成后插进去.
 */
export function mountClock(host: HTMLElement): void {
    const { canvas } = createClockDisplay();
    // 宿主由本模块独占(骨架建的空 div),用 replaceChildren 整体接管:
    // 重复挂载不会留下两份同 id 的标记.全站三个"宿主独占"的模块都这么做,
    // 地铁车窗例外 -- 它的宿主可以同时接收设置面板与上传面板,所以那边是 append.
    host.replaceChildren(canvas);

    const ctx = canvas.getContext('2d');
    if (!ctx) return; // 安全处理

    const drawDisplay = (): void => {
        // 清除画布
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        // 设置背景
        ctx.fillStyle = BACKGROUND_COLOR;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // 获取当前时间
        const formattedTime = fmt_time(new Date());

        // 绘制
        let x = 0;
        for (const ch of formattedTime) {
            if (ch === DOT_CHAR) {
                drawDot(ctx, x);
                x += PUNCT_ADVANCE;
            } else if (ch === COLON_CHAR) {
                drawColon(ctx, x);
                x += PUNCT_ADVANCE;
            } else {
                // 数字
                const digit = parseInt(ch, DIGIT_RADIX);
                if (!isNaN(digit)) {
                    drawDigit(ctx, digit, x);
                }
                x += DIGIT_ADVANCE;
            }
        }
    };

    // 立即绘制一次,避免空白
    drawDisplay();
    // 每秒更新一次
    window.setInterval(drawDisplay, REFRESH_INTERVAL_MS);
}
