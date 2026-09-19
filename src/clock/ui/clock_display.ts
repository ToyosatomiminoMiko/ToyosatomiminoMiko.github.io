/*
LED 时钟的**标记组件**(声明式).

时钟原先的标记写在 index.html 里(`<div id="app_led_clock"><canvas id="time_canvas">`),
再由 clock.ts 按 id 取回来 -- 两处各写一份 id,改一处就静默失配.现在改成
和地铁车窗控制台同一条约定:宿主只提供空容器,标记按 config.ts 的声明生成:

    <canvas id="time_canvas" width="65" height="8">

本模块是纯函数:不读页面,不改全局,只把"描述"变成元素并交回引用;
插进宿主与绑事件都是 clock.ts 的事(与 ui/settings.ts 的分工一致).
*/

import { CLOCK_CANVAS_HEIGHT, CLOCK_CANVAS_ID, CLOCK_CANVAS_WIDTH } from '@/clock/config';
import { h } from '@/common/dom';

/** 时钟的标记:目前只有一个画布;行为代码需要别的元素时在这里加并一起交回 */
export interface ClockDisplay {
    /** LED 点阵画布(宽度即逻辑像素,显示高度由 CSS 的 --clock-canvas-height 控制) */
    readonly canvas: HTMLCanvasElement;
}

/** 按 config.ts 的 DOM 契约生成画布 */
export function createClockDisplay(): ClockDisplay {
    const canvas = h('canvas', {
        attrs: {
            id: CLOCK_CANVAS_ID,
            width: CLOCK_CANVAS_WIDTH,
            height: CLOCK_CANVAS_HEIGHT,
        },
    });
    return { canvas };
}
