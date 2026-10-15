/*
红黑树工具的**标记组件**(声明式).

骨架(src/common/ui/site_shell.ts)只提供空的标签页窗格 `shell.panes.rbt`,
整块面板按 config.ts 的声明在这里生成
正文顺序(提示区 -> 输入框 -> 输出区 -> 树)由下面 createPanel 的 body 实参决定,
不能调换:rbt_panel.test.ts 按这个顺序定位(index.css 只按 id 命中,与先后无关;
顺序管的是视觉堆叠与测试).

**树是一棵 `<svg>`,不是一个 `<canvas>`**(2026-10 起):节点与连线都是文档里的真
元素,所以命中检测 / pointer 事件 / CSS transition / CSS 令牌着色全部由浏览器给,
不必自己写 `ctx` 那一套.标记里只放**空的 `<svg>` 根**:每轮要画什么由 rbt.ts 按
布局结果重建(整批换掉根的子节点),这一层不认识树,只认识"这里有一块画树的画布".

`<svg>` 归 `create_svg_element` 建(库的 SVG 命名空间原语)而不是 `create_element`:
两条路都建得出 `<svg>`,但只有前者给的是 `SVGSVGElement`(命名空间也确定是 SVG,
不靠 HTML 解析器"按上下文收编"的特例),拿到的类型才对得上后面要往上挂的几何节点
(见 miko_ui 的 `widgets/svg/dom.ts` 文件头).

`preserveAspectRatio` + CSS 的 `height: auto` 让整棵树随面板宽度等比缩放:
viewBox 是 1200×640 的逻辑坐标,窄屏上不会溢出,也不需要 `devicePixelRatio`
那一套(canvas 时代必须手算 dpr,否则高分辨率屏上是糊的).

画布只画树:一切文案(空输入 / 空树提示,解析错误,性质结论)都写进**同一个**输出区
#treeOutput,颜色 / 字号 / 折行交给 CSS,截图与选中复制也才正常.

输出区排在输入框**下面**而不是树下面:改表达式时眼睛在输入框上,结论就贴在它下面,
不用把视线挪到树下再挪回来.

本模块是纯函数:不读页面,不改全局,不绑事件,只把"描述"变成元素并把行为
代码要用的引用一起交回;插进宿主与绑事件都是 rbt.ts 的事
(与 ui/settings.ts,clock/ui/clock_display.ts 的分工一致).
*/

import { create_element, create_svg_element, createPanel } from 'miko_ui';
import {
    RBT_DOM,
    RBT_HINT_COLOR_LEGEND,
    RBT_HINT_SHORTHAND,
    RBT_INPUT_PLACEHOLDER,
    RBT_INPUT_SPELLCHECK,
    RBT_PANEL_TITLE,
    RBT_VIEW_BOX,
    RBT_VIEW_BOX_HEIGHT,
    RBT_VIEW_BOX_WIDTH,
} from '@/rbt/config';

/** 树这块画布的读屏标签(它不是纯装饰:画的是这一轮解析出来的树). */
const RBT_TREE_LABEL = '红黑树结构图';

/** 红黑树面板:根元素 + 行为代码要用的元素引用 */
interface RbtPanel {
    /** 面板根:库的 `createPanel` 建的 `section.ui-panel`(插进 shell.panes.rbt) */
    readonly root: HTMLElement;
    /** 表达式输入框 #treeInput */
    readonly input: HTMLTextAreaElement;
    /** 唯一输出区 #treeOutput(初始 hidden,内容由 rbt.ts 每次整批重建) */
    readonly output: HTMLElement;
    /**
     * 树绘制用的空 `<svg>` 根 #rbtTree.
     *
     * 这里只给一块**空的**画布:子节点(连线 / 节点)由 rbt.ts 每轮 `replaceChildren`
     * 整批重建,所以这一层与布局无关.
     */
    readonly tree: SVGSVGElement;
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

    /*
      树这块画布:空的 `<svg>` 根.

      `width` / `height` 与 viewBox 同值,只为给出宽高比(1.875)让 CSS 的
      `height: auto` 算得出来;实际显示尺寸由 CSS 的 `width: 100%` 决定,所以窄屏上
      整棵树等比缩小而不是溢出.`preserveAspectRatio` 是 SVG 默认值,写出来是因为
      它决定了"缩放时不裁切"这件事,改 CSS 宽度的人得看得见这条前提.
    */
    const tree = create_svg_element(
        { tag: 'svg' },
        {
            id: RBT_DOM.treeId,
            viewBox: RBT_VIEW_BOX,
            preserveAspectRatio: 'xMidYMid meet',
            width: String(RBT_VIEW_BOX_WIDTH),
            height: String(RBT_VIEW_BOX_HEIGHT),
            role: 'img',
            'aria-label': RBT_TREE_LABEL,
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

    // 框体(标题栏 / 正文容器)归库;正文顺序:提示区 -> 输入框 -> 输出区 -> 树
    const root = createPanel({
        title: RBT_PANEL_TITLE,
        body: [hints, input, output, tree],
    }).element;

    return { root, input, output, tree };
}
