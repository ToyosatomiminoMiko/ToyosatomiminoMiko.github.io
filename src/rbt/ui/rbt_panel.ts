/*
红黑树工具的**标记组件**(声明式).

红黑树原先的标记写在 index.html 的 `#rbt` 窗格里
(`#treeInput` / `#treeError` / `#rbCanvas`),再由 rbt.ts 按 id 取回来 --
两处各写一份契约,改一处就静默失配.现在改成和地铁车窗控制台,LED 时钟
同一条约定:骨架只提供空的标签页窗格(src/common/ui/site_shell.ts 的
shell.panes.rbt),整块面板按 config.ts 的声明在这里生成:

    <div class="card">
      <div class="card-header"><h4>🌳 Red-Black Tree</h4></div>
      <div>
        <span>💡 支持简写叶子节点 ...</span><br>
        <span>🔴 R 红色 &nbsp;|&nbsp; ⚫ B 黒色</span><br>
      </div>
      <div class="card-body">
        <textarea id="treeInput" spellcheck="false" placeholder="..."></textarea>
        <div id="treeError" hidden></div>
        <canvas id="rbCanvas" width="1200" height="640"></canvas>
      </div>
    </div>

本模块是纯函数:不读页面,不改全局,不绑事件,只把"描述"变成元素并把行为
代码要用的引用一起交回;插进宿主与绑事件都是 rbt.ts 的事
(与 ui/settings.ts,clock/ui/clock_display.ts 的分工一致).
*/

import { h } from '@/common/dom';
import {
    RBT_CANVAS_HEIGHT,
    RBT_CANVAS_WIDTH,
    RBT_DOM,
    RBT_HINT_COLOR_LEGEND,
    RBT_HINT_SHORTHAND,
    RBT_INPUT_PLACEHOLDER,
    RBT_INPUT_SPELLCHECK,
    RBT_PANEL_BODY_CLASS,
    RBT_PANEL_HEADER_CLASS,
    RBT_PANEL_ROOT_CLASS,
    RBT_PANEL_TITLE,
} from '@/rbt/config';

/** 红黑树面板:根元素 + 行为代码要用的元素引用 */
export interface RbtPanel {
    /** 面板根 div.card(插进 shell.panes.rbt) */
    readonly root: HTMLElement;
    /** 表达式输入框 #treeInput */
    readonly input: HTMLTextAreaElement;
    /** 解析错误提示 #treeError(初始 hidden,由 rbt.ts 按需显隐) */
    readonly error: HTMLElement;
    /** 树绘制画布 #rbCanvas(width/height 来自 config) */
    readonly canvas: HTMLCanvasElement;
}

/** 按 config.ts 的声明式模型生成整块面板 */
export function createRbtPanel(): RbtPanel {
    const input = h('textarea', {
        attrs: {
            id: RBT_DOM.inputId,
            spellcheck: RBT_INPUT_SPELLCHECK,
            placeholder: RBT_INPUT_PLACEHOLDER,
        },
    });

    // 初始必须隐藏:旧标记即 `<div id="treeError" hidden></div>`
    const error = h('div', { attrs: { id: RBT_DOM.errorId, hidden: 'hidden' } });

    const canvas = h('canvas', {
        attrs: {
            id: RBT_DOM.canvasId,
            width: RBT_CANVAS_WIDTH,
            height: RBT_CANVAS_HEIGHT,
        },
    });

    // 提示区:两行 span 各自以 <br> 结束(旧标记如此,逐字保留)
    const hints = h('div', {}, [
        h('span', { text: RBT_HINT_SHORTHAND }),
        h('br'),
        h('span', { text: RBT_HINT_COLOR_LEGEND }),
        h('br'),
    ]);

    const root = h('div', { class: RBT_PANEL_ROOT_CLASS }, [
        h('div', { class: RBT_PANEL_HEADER_CLASS }, [h('h4', { text: RBT_PANEL_TITLE })]),
        hints,
        h('div', { class: RBT_PANEL_BODY_CLASS }, [input, error, canvas]),
    ]);

    return { root, input, error, canvas };
}
