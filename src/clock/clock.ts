/*
2025.12.10.23:20:00
LED 时钟:把点阵画到调用方交回的画布上,并按秒重绘.

宿主是 Calendario 标签页顶部那颗空容器(见 config.ts 的 CLOCK_HOST_ID,由
src/calendar/ui/calendar_panel.ts 生成后交给 main.ts 转交),标记由
ui/clock_display.ts 生成.本文件只做行为:接收 createClockDisplay() 交回的
画布引用直接绘制,不按 id 去 DOM 里找元素.
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

/** 把 digit 的 3×5 点阵画到 x 处:逐列读表,列内位 4-0 自高到低对应第 0-4 行 */
function drawDigit(ctx: CanvasRenderingContext2D, digit: number, x: number): void {
    const base = digit * DIGIT_COLUMNS;
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

/** 把逐行掩码 segments 的一列点画到 x 处(点号与冒号共用同一套画法) */
function drawColumn(ctx: CanvasRenderingContext2D, segments: Uint8Array, x: number): void {
    for (let row = 0; row < DIGIT_ROWS; row++) {
        if (segments[row]) {
            ctx.fillStyle = PIXEL_COLOR;
            ctx.fillRect(x, row + GLYPH_TOP_OFFSET, PIXEL_SIZE, PIXEL_SIZE);
        }
    }
}

/**
 * 把 LED 时钟挂到宿主里.
 *
 * @param host 时钟宿主(#app_led_clock):只提供空位;画布由 createClockDisplay()
 *             生成后插入,宿主原有内容会被清掉.
 */
export function mountClock(host: HTMLElement): void {
    const { canvas } = createClockDisplay();
    // 宿主由本模块独占,所以用 replaceChildren 整体接管而不是 append:
    // 重复挂载不会留下两份同 id 的标记.
    host.replaceChildren(canvas);

    const ctx = canvas.getContext('2d');
    if (!ctx) return; // 环境不支持 2D 上下文时无法绘制

    const drawDisplay = (): void => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = BACKGROUND_COLOR;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const formattedTime = fmt_time(new Date());

        let x = 0;
        for (const ch of formattedTime) {
            if (ch === DOT_CHAR || ch === COLON_CHAR) {
                drawColumn(ctx, ch === DOT_CHAR ? DOT_SEGMENTS : COLON_SEGMENTS, x);
                x += PUNCT_ADVANCE;
            } else {
                const digit = parseInt(ch, DIGIT_RADIX);
                if (!isNaN(digit)) {
                    drawDigit(ctx, digit, x);
                }
                x += DIGIT_ADVANCE;
            }
        }
    };

    drawDisplay(); // 先画一次,避免等到第一个 tick 才出现内容
    window.setInterval(drawDisplay, REFRESH_INTERVAL_MS);
}
