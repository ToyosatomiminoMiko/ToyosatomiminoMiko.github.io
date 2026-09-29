/*
红黑树工具的**标记组件**(声明式).

骨架(src/common/ui/site_shell.ts)只提供空的标签页窗格 `shell.panes.rbt`,
整块面板按 config.ts 的声明在这里生成:

    <section class="ui-panel">                        面板框体(库的 createPanel)
      <header class="ui-panel-header"><span class="ui-panel-title">Red-Black Tree</span></header>
      <div class="ui-panel-body">
        <div>
          <span>支持简写叶子节点 ...</span><br>
          <span>R 红色 &nbsp;|&nbsp; B 黒色</span><br>
        </div>
        <textarea id="treeInput" spellcheck="false" placeholder="..."></textarea>
        <div id="treeError" hidden></div>
        <div id="treeProperties" class="tree-properties" hidden></div>
        <canvas id="rbCanvas" width="1200" height="640"></canvas>
      </div>
    </section>

正文顺序(提示区 -> 输入框 -> 错误提示 -> 性质检查清单 -> 画布)由下面 createPanel
的 body 实参决定,不能调换:public/css/index.css 与 rbt_panel.test.ts 都按这个顺序定位.

清单排在输入框**下面**而不是画布下面:改表达式时眼睛在输入框上,结论就贴在它下面,
不用把视线挪到画布再挪回来;清单的**内容**由 rbt.ts 逐条重建(空清单时整块 hidden),
这里只交出容器这一个节点.

本模块是纯函数:不读页面,不改全局,不绑事件,只把"描述"变成元素并把行为
代码要用的引用一起交回;插进宿主与绑事件都是 rbt.ts 的事
(与 ui/settings.ts,clock/ui/clock_display.ts 的分工一致).
*/

import { create_element, createPanel } from 'miko_ui';
import {
    RBT_CANVAS_HEIGHT,
    RBT_CANVAS_WIDTH,
    RBT_DIAGNOSTICS_CLASS,
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
    /** 性质检查清单 #treeProperties(初始 hidden,内容由 rbt.ts 逐条重建) */
    readonly diagnostics: HTMLElement;
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

    // 初始必须隐藏:错误提示只在该出声时由 rbt.ts 显隐
    const error = create_element({ tag: 'div' }, { id: RBT_DOM.errorId, hidden: 'hidden' });

    // 性质检查清单:初始同样隐藏(输入为空或解析失败时都没有"性质"可列)
    const diagnostics = create_element(
        { tag: 'div' },
        { id: RBT_DOM.diagnosticsId, class: RBT_DIAGNOSTICS_CLASS, hidden: 'hidden' },
    );

    const canvas = create_element(
        { tag: 'canvas' },
        {
            id: RBT_DOM.canvasId,
            width: String(RBT_CANVAS_WIDTH),
            height: String(RBT_CANVAS_HEIGHT),
        },
    );

    // 提示区:两行 span 各自以 <br> 结束
    const hints = create_element(
        { tag: 'div' },
        {},
        create_element({ tag: 'span' }, {}, RBT_HINT_SHORTHAND),
        create_element({ tag: 'br' }),
        create_element({ tag: 'span' }, {}, RBT_HINT_COLOR_LEGEND),
        create_element({ tag: 'br' }),
    );

    // 框体(标题栏 / 正文容器)归库;正文顺序:提示区 -> 输入框 -> 错误提示 -> 性质检查清单 -> 画布
    const root = createPanel({
        title: RBT_PANEL_TITLE,
        body: [hints, input, error, diagnostics, canvas],
    }).element;

    return { root, input, error, diagnostics, canvas };
}
