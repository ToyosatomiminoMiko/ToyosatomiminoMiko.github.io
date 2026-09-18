/*
 * 车窗自身的页面级标记(标题 / 副标题 / 画布)生成器.
 *
 * 宿主(站点首页 HOME 卡片)只留一个空容器,标记由这里生成 -- 文案与画布分辨率
 * 只在 config.ts 里定义一次,宿主页不需要复制粘贴任何标记,也不用再来改这里.
 *
 * 和 ui/dom.ts 的关系:这里只做"描述 -> 节点列表",不读页面,不改全局;真正的
 * 挂载(root.append)交给 metro_window.ts,和设置面板一样由挂载函数统一负责.
 * 设置面板不在这里:它是"组件",由 ui/settings.ts 生成后插在画布之后.
 */
import { CANVAS_HEIGHT, CANVAS_WIDTH, ELEMENT_IDS, SUBTITLE_CLASS, WINDOW_SUBTITLE, WINDOW_TITLE } from '@/metro_window/web/src/config';
import { h, type DomChild } from '@/metro_window/web/src/ui/dom';

/**
 * 按 config.ts 的声明生成车窗标记,顺序即显示顺序:
 *
 *     <h1>标题</h1>
 *     <p class="subtitle">副标题</p>
 *     <canvas id="webgpu-canvas" width="1344" height="756"></canvas>
 *
 * 画布 id 取自 ELEMENT_IDS.canvas:挂载函数随后按同一个 id 把它取回来,
 * 两边靠 config.ts 对齐,不在这里写死.
 */
export function createWindowContent(): readonly DomChild[] {
    return [
        h('h1', { text: WINDOW_TITLE }),
        h('p', { class: SUBTITLE_CLASS, text: WINDOW_SUBTITLE }),
        h('canvas', {
            attrs: { id: ELEMENT_IDS.canvas, width: CANVAS_WIDTH, height: CANVAS_HEIGHT },
        }),
    ];
}
