/**
 * LED 时钟画布的标记契约(进程内,跑在 happy-dom 里).
 *
 * 画布原先写在 index.html 的 `<div id="app_led_clock"><canvas id="time_canvas">`,
 * 现在宿主由骨架建,画布由组件按 config 生成.这里断言的就是 **CSS 用的那两个选择器**
 * (`#app_led_clock` 的面板底色 / `#time_canvas` 的 `image-rendering: pixelated`)
 * 与画布分辨率真的对得上.
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
        // 逻辑分辨率是宽高**属性**(CSS 只控制显示高度),两个都要在
        expect(canvas.getAttribute('width')).toBe(String(CLOCK_CANVAS_WIDTH));
        expect(canvas.getAttribute('height')).toBe(String(CLOCK_CANVAS_HEIGHT));
    });

    it('插进宿主后,#app_led_clock > canvas#time_canvas 这两条 CSS 选择器都命中', () => {
        document.body.innerHTML = '';
        const host = document.createElement('div');
        host.id = CLOCK_HOST_ID;
        document.body.append(host);
        host.append(createClockDisplay().canvas);

        expect(document.querySelector(`#${CLOCK_HOST_ID} > canvas#${CLOCK_CANVAS_ID}`)).not.toBeNull();
        expect(document.querySelectorAll(`#${CLOCK_HOST_ID}`)).toHaveLength(1);
    });
});
