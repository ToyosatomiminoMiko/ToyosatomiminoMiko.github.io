/*
 * 车窗**舞台**的标记生成器.
 *
 * 宿主(站点首屏的空容器)只留一个空位,标记由这里生成 -- 画布分辨率只在
 * config.ts 里定义一次,宿主页不需要复制粘贴任何标记,也不用再来改这里.
 *
 * 拆成"舞台"与"控制台"两块以后,本文件只管舞台;设置面板在 ui/settings.ts 里,
 * 由挂载函数插进另一个宿主(站点放在 SETTING 标签页).
 *
 * 和库的 create_element 的关系:这里只做"描述 -> 节点列表",不读页面,不改全局;
 * 真正的挂载(root.append)交给 metro_window.ts,和设置面板一样由挂载函数统一负责.
 */
import {
    CANVAS_HEIGHT,
    CANVAS_WIDTH,
    ELEMENT_IDS,
} from '@/metro_window/src/config';
import { create_element, type Child } from 'miko_ui';

/**
 * 按 config.ts 的声明生成舞台标记:
 *
 *     <canvas id="webgpu-canvas" width="1344" height="756"></canvas>
 *
 * 画布 id 取自 ELEMENT_IDS.canvas:挂载函数随后按同一个 id 把它取回来,
 * 两边靠 config.ts 对齐,不在这里写死.
 */
export function createStageContent(): readonly Child[] {
    return [
        create_element(
            { tag: 'canvas' },
            { id: ELEMENT_IDS.canvas, width: String(CANVAS_WIDTH), height: String(CANVAS_HEIGHT) },
        ),
    ];
}
