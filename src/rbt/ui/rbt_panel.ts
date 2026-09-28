/*
红黑树工具的**标记组件**(声明式).

红黑树原先的标记写在 index.html 的 `#rbt` 窗格里
(`#treeInput` / `#treeError` / `#rbCanvas`),再由 rbt.ts 按 id 取回来 --
两处各写一份契约,改一处就静默失配.现在改成和地铁车窗控制台,LED 时钟
同一条约定:骨架只提供空的标签页窗格(src/common/ui/site_shell.ts 的
shell.panes.rbt),整块面板按 config.ts 的声明在这里生成:

    <section class="ui-panel">                        面板框体(库的 createPanel)
      <header class="ui-panel-header"><span class="ui-panel-title">Red-Black Tree</span></header>
      <div class="ui-panel-body">
        <div>
          <span>支持简写叶子节点 ...</span><br>
          <span>R 红色 &nbsp;|&nbsp; B 黒色</span><br>
        </div>
        <textarea id="treeInput" spellcheck="false" placeholder="..."></textarea>
        <div id="treeError" hidden></div>
        <canvas id="rbCanvas" width="1200" height="640"></canvas>
      </div>
    </section>

提示区原先夹在标题栏与正文之间,现在移进正文容器(框体归库之后正文只有一个入口),
这是本模块唯一一处结构变化.

本模块是纯函数:不读页面,不改全局,不绑事件,只把"描述"变成元素并把行为
代码要用的引用一起交回;插进宿主与绑事件都是 rbt.ts 的事
(与 ui/settings.ts,clock/ui/clock_display.ts 的分工一致).
*/

import { create_element, createPanel } from 'miko_ui';
import {
    RBT_CANVAS_HEIGHT,
    RBT_CANVAS_WIDTH,
    RBT_DOM,
    RBT_HINT_COLOR_LEGEND,
    RBT_HINT_SHORTHAND,
    RBT_INPUT_PLACEHOLDER,
    RBT_INPUT_SPELLCHECK,
    RBT_PANEL_TITLE,
} from '@/rbt/config';

/** 红黑树面板:根元素 + 行为代码要用的元素引用 */
export interface RbtPanel {
    /** 面板根:库的 `createPanel` 建的 `section.ui-panel`(插进 shell.panes.rbt) */
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
    const input = create_element(
        { tag: 'textarea' },
        {
            id: RBT_DOM.inputId,
            spellcheck: RBT_INPUT_SPELLCHECK,
            placeholder: RBT_INPUT_PLACEHOLDER,
        },
    );

    // 初始必须隐藏:旧标记即 `<div id="treeError" hidden></div>`
    const error = create_element({ tag: 'div' }, { id: RBT_DOM.errorId, hidden: 'hidden' });

    const canvas = create_element(
        { tag: 'canvas' },
        {
            id: RBT_DOM.canvasId,
            width: String(RBT_CANVAS_WIDTH),
            height: String(RBT_CANVAS_HEIGHT),
        },
    );

    // 提示区:两行 span 各自以 <br> 结束(旧标记如此,逐字保留)
    const hints = create_element(
        { tag: 'div' },
        {},
        create_element({ tag: 'span' }, {}, RBT_HINT_SHORTHAND),
        create_element({ tag: 'br' }),
        create_element({ tag: 'span' }, {}, RBT_HINT_COLOR_LEGEND),
        create_element({ tag: 'br' }),
    );

    // 框体(标题栏 / 正文容器)归库;正文顺序:提示区 -> 输入框 -> 错误提示 -> 画布
    const root = createPanel({
        title: RBT_PANEL_TITLE,
        body: [hints, input, error, canvas],
    }).element;

    return { root, input, error, canvas };
}
