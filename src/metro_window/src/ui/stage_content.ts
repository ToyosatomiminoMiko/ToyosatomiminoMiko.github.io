/*
 * 车窗**舞台**的标记生成器.
 *
 * 宿主(站点首屏的空容器)只留一个空位,标记由这里生成 -- 画布分辨率只在
 * config.ts 里定义一次,宿主页不需要复制粘贴任何标记,也不用再来改这里.
 *
 * 拆成"舞台"与"控制台"两块以后,本文件只管舞台;设置面板在 ui/settings.ts 里,
 * 由挂载函数插进另一个宿主(站点放在 SETTING 标签页).
 *
 * 和 ui/dom.ts 的关系:这里只做"描述 -> 节点列表",不读页面,不改全局;真正的
 * 挂载(root.append)交给 metro_window.ts,和设置面板一样由挂载函数统一负责.
 */
import {
    CANVAS_HEIGHT,
    CANVAS_WIDTH,
    ELEMENT_IDS,
} from '@/metro_window/src/config';
import { h, type DomChild } from '@/metro_window/src/ui/dom';

/**
 * 按 config.ts 的声明生成舞台标记:
 *
 *     <canvas id="webgpu-canvas" width="1344" height="756"></canvas>
 *
 * 画布 id 取自 ELEMENT_IDS.canvas:挂载函数随后按同一个 id 把它取回来,
 * 两边靠 config.ts 对齐,不在这里写死.
 */
export function createStageContent(): readonly DomChild[] {
    return [
        h('canvas', {
            attrs: { id: ELEMENT_IDS.canvas, width: CANVAS_WIDTH, height: CANVAS_HEIGHT },
        }),
    ];
}
