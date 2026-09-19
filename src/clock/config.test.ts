/*
LED 时钟配置的回归网.

原有的一处隐患是"画布尺寸写在 index.html 的 width/height 上,而字形推进量写在
clock/config.ts 里" -- 两边对不上时表现为**最后一个数字被裁掉**,不报错.
现在尺寸也归 config.ts 了,这里就把这条不变量钉死:

    fmt_time() 的输出排完后占多少像素,画布就必须正好那么大.

数值来自同一个 config(推进量 / 字形宽度 / 顶偏移),所以它测的不是"某个数字是几",
而是"这几个声明互相自洽".
*/
import { describe, expect, it } from 'vitest';

import {
    CLOCK_CANVAS_HEIGHT,
    CLOCK_CANVAS_WIDTH,
    COLON_CHAR,
    DIGIT_ADVANCE,
    DIGIT_COLUMNS,
    DIGIT_ROWS,
    DOT_CHAR,
    GLYPH_TOP_OFFSET,
    PIXEL_SIZE,
    PUNCT_ADVANCE,
} from './config';
import { fmt_time } from '@/common/utils';

/** 一个字符画完后 x 的推进量(数字与标点不同,与 clock.ts 的绘制循环同一套规则) */
function advanceOf(char: string): number {
    return char === DOT_CHAR || char === COLON_CHAR ? PUNCT_ADVANCE : DIGIT_ADVANCE;
}

/** 一个字符实际占用的像素宽度 */
function glyphWidthOf(char: string): number {
    return char === DOT_CHAR || char === COLON_CHAR ? PIXEL_SIZE : DIGIT_COLUMNS;
}

/** 固定一个 19 字符的时间戳(2026.09.20.01:22:00),格式由 fmt_time 决定 */
const SAMPLE_TIME = fmt_time(new Date(2026, 8, 20, 1, 22, 0));

describe('LED 时钟画布尺寸', () => {
    it('时间戳排完后正好铺满画布宽', () => {
        const chars = [...SAMPLE_TIME];
        expect(chars.length).toBe(19);
        const drawnWidth =
            chars.reduce((total, char) => total + advanceOf(char), 0) -
            advanceOf(chars[chars.length - 1]) +
            glyphWidthOf(chars[chars.length - 1]);
        expect(CLOCK_CANVAS_WIDTH).toBe(drawnWidth);
    });

    it('字形高度(含顶部偏移)不超过画布高', () => {
        expect(GLYPH_TOP_OFFSET + DIGIT_ROWS).toBeLessThanOrEqual(CLOCK_CANVAS_HEIGHT);
    });
});
