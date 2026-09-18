/*
2025.12.10.23:20:00
APP: #app_led_clock
LED Clock
*/
import { fmt_time } from '@/common/utils';
import {
    BACKGROUND_COLOR,
    CLOCK_CANVAS_MISSING_MESSAGE,
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

export function mountClock(): void {
    const canvas = document.getElementById('time_canvas');
    if (!canvas || !(canvas instanceof HTMLCanvasElement)) {
        console.warn(CLOCK_CANVAS_MISSING_MESSAGE);
        return;
    }
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
