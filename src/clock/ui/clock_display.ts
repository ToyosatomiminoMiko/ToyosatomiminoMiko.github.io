/*
LED 时钟的标记组件(声明式).

宿主由骨架提供空容器,标记全部按 config.ts 的契约生成:

    <canvas id="time_canvas" width="65" height="8">

本模块是纯函数:不读页面,不改全局,只把"描述"变成元素并交回引用;插入宿主
与启动绘制都是 clock.ts 的事.
*/

import { CLOCK_CANVAS_HEIGHT, CLOCK_CANVAS_ID, CLOCK_CANVAS_WIDTH } from '@/clock/config';
import { create_element } from 'miko_ui';

/** 时钟的标记:行为代码需要别的元素时加在这里,与画布一起交回 */
export interface ClockDisplay {
    /** 点阵画布:width/height 是逻辑分辨率,显示高度由 CSS 的 --clock-canvas-height 决定 */
    readonly canvas: HTMLCanvasElement;
}

/** 按 config.ts 的 DOM 契约生成画布:id 与分辨率都取自配置,与 clock.ts 的绘制几何同源 */
export function createClockDisplay(): ClockDisplay {
    const canvas = create_element(
        { tag: 'canvas' },
        {
            id: CLOCK_CANVAS_ID,
            width: String(CLOCK_CANVAS_WIDTH),
            height: String(CLOCK_CANVAS_HEIGHT),
        },
    );
    return { canvas };
}
