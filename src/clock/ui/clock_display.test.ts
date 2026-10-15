/**
 * LED 时钟画布的标记契约(进程内,跑在 happy-dom 里).
 *
 * 断言的是 CSS 真正依赖的两处:画布选择器 `#time_canvas`(面板观感:黑底 / 圆角 /
 * 辉光 / 垫层 + image-rendering),以及画布分辨率与 config 的声明一致.宿主
 * `#app_led_clock` 自己**不带**样式,所以这里只钉"画布长在宿主里面"这条结构契约.
 *
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from 'vitest';

import {
    CLOCK_CANVAS_HEIGHT,
    CLOCK_CANVAS_ID,
    CLOCK_CANVAS_WIDTH,
    CLOCK_HOST_ID,
} from '@/clock/config';
import { createClockDisplay } from '@/clock/ui/clock_display';

describe('LED 时钟:画布标记', () => {
    it('画布 id 与分辨率都来自 config', () => {
        const { canvas } = createClockDisplay();
        expect(canvas.tagName).toBe('CANVAS');
        expect(canvas.id).toBe(CLOCK_CANVAS_ID);
        // 逻辑分辨率是宽高**属性**(CSS 只控制显示高度),两个都要对
        expect(canvas.getAttribute('width')).toBe(String(CLOCK_CANVAS_WIDTH));
        expect(canvas.getAttribute('height')).toBe(String(CLOCK_CANVAS_HEIGHT));
    });

    it('插进宿主后,画布确实长在 #app_led_clock 里面(宿主本身不带样式)', () => {
        document.body.innerHTML = '';
        const host = document.createElement('div');
        host.id = CLOCK_HOST_ID;
        document.body.append(host);
        host.append(createClockDisplay().canvas);

        expect(document.querySelector(`#${CLOCK_HOST_ID} > canvas#${CLOCK_CANVAS_ID}`)).not.toBeNull();
        expect(document.querySelectorAll(`#${CLOCK_HOST_ID}`)).toHaveLength(1);
    });
});
