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
        <div id="treeOutput" hidden></div>
        <canvas id="rbCanvas" width="1200" height="640"></canvas>
      </div>
    </section>

正文顺序(提示区 -> 输入框 -> 输出区 -> 画布)由下面 createPanel 的 body 实参决定,
不能调换:rbt_panel.test.ts 按这个顺序定位(index.css 只按 id 命中,与先后无关;
顺序管的是视觉堆叠与测试).

画布只画树:一切文案(空输入 / 空树提示,解析错误,性质结论)都写进**同一个**输出区
#treeOutput,颜色 / 字号 / 折行交给 CSS,截图与选中复制也才正常.

输出区只有一个元素:提示 / 错误 / 性质清单没有 stdout 与 stderr 那种必须分流的语义,
分三块只会多出"谁该显示,谁该隐藏"的互斥维护;现在整块内容每次重建,一行 / 抬头的
颜色由类名区分(见 config 的 RBT_OUTPUT_*_CLASS 与 RBT_DIAGNOSTICS_*_CLASS).

输出区排在输入框**下面**而不是画布下面:改表达式时眼睛在输入框上,结论就贴在它下面,
不用把视线挪到画布再挪回来.

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
interface RbtPanel {
    /** 面板根:库的 `createPanel` 建的 `section.ui-panel`(插进 shell.panes.rbt) */
    readonly root: HTMLElement;
    /** 表达式输入框 #treeInput */
    readonly input: HTMLTextAreaElement;
    /** 唯一输出区 #treeOutput(初始 hidden,内容由 rbt.ts 每次整批重建) */
    readonly output: HTMLElement;
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

    // 唯一输出区:提示 / 错误 / 性质清单都塞进这一个元素(理由见文件头部注释).
    // 容器只认 id(`#treeOutput` 是 CSS 与冒烟脚本的定位契约),自己不挂类名:
    // 每一行 / 抬头各有自己的类,样式只认它们.初始 hidden 只是挂载前的默认态,
    // 挂载时 rbt.ts 立刻会写入第一轮内容.
    const output = create_element({ tag: 'div' }, { id: RBT_DOM.outputId, hidden: 'hidden' });

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

    // 框体(标题栏 / 正文容器)归库;正文顺序:提示区 -> 输入框 -> 输出区 -> 画布
    const root = createPanel({
        title: RBT_PANEL_TITLE,
        body: [hints, input, output, canvas],
    }).element;

    return { root, input, output, canvas };
}
