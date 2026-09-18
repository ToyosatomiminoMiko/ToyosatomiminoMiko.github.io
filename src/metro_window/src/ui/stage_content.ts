/*
 * 车窗**舞台**的标记生成器(画布,以及可选的标题 / 副标题).
 *
 * 宿主(站点首屏的空容器)只留一个空位,标记由这里生成 -- 文案与画布分辨率
 * 只在 config.ts 里定义一次,宿主页不需要复制粘贴任何标记,也不用再来改这里.
 *
 * 拆成"舞台"与"控制台"两块以后,本文件只管舞台:要不要生成标题 / 副标题由
 * config.ts 的 STAGE_COPY_ENABLED 决定;设置面板在 ui/settings.ts 里,由挂载
 * 函数插进另一个宿主(站点放在 SETTING 标签页).
 *
 * 和 ui/dom.ts 的关系:这里只做"描述 -> 节点列表",不读页面,不改全局;真正的
 * 挂载(root.append)交给 metro_window.ts,和设置面板一样由挂载函数统一负责.
 */
import {
    CANVAS_HEIGHT,
    CANVAS_WIDTH,
    ELEMENT_IDS,
    STAGE_COPY_ENABLED,
    SUBTITLE_CLASS,
    WINDOW_SUBTITLE,
    WINDOW_TITLE,
} from '@/metro_window/src/config';
import { h, type DomChild } from '@/metro_window/src/ui/dom';

/**
 * 按 config.ts 的声明生成舞台标记,顺序即显示顺序:
 *
 *     [<h1>标题</h1>]                     <- STAGE_COPY_ENABLED 为 true 时才有
 *     [<p class="subtitle">副标题</p>]     <- 同上
 *     <canvas id="webgpu-canvas" width="1344" height="756"></canvas>
 *
 * 画布 id 取自 ELEMENT_IDS.canvas:挂载函数随后按同一个 id 把它取回来,
 * 两边靠 config.ts 对齐,不在这里写死.
 */
export function createStageContent(): readonly DomChild[] {
    const content: DomChild[] = [];
    if (STAGE_COPY_ENABLED) {
        content.push(h('h1', { text: WINDOW_TITLE }));
        content.push(h('p', { class: SUBTITLE_CLASS, text: WINDOW_SUBTITLE }));
    }
    content.push(
        h('canvas', {
            attrs: { id: ELEMENT_IDS.canvas, width: CANVAS_WIDTH, height: CANVAS_HEIGHT },
        }),
    );
    return content;
}
