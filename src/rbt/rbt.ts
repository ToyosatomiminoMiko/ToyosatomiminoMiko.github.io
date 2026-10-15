/*
2026.05.01.00:00:00
红黑树工具:SVG 绘制 + 挂载

解析与性质检查在 rbt_tree.ts(纯逻辑,可单测);本文件只剩两件事:
- 把布局结果画成一棵 `<svg>`:区间递归分配坐标 + 连线(`<line>`)+ 节点
  (`<g>` 里一颗 `<circle>` 与一个 `<text>`);
- mountRBT:接管宿主,把"格式检查 -> 性质检查 -> 重绘"接到输入框的 input 事件上.

**为什么是 SVG 而不是 canvas**(2026-10 起):树的每一笔都成了文档里的元素,于是
- 配色 / 字号 / 线宽回到 CSS(引 src/rbt/tokens.css 的 `--rbt-*`),不再写死在 config 里
  (`ctx.fillStyle` 读不到 CSS 变量,那是 canvas 的死结);
- 将来要做的命中检测 / 节点拖动 / 结构变化动画由浏览器给:`pointerdown` 的
  `event.target` 就是命中的节点,位移与淡入走 CSS transition,不必自己写一遍
  坐标反算与逐帧重绘.

代价是每次输入都整批重建这棵 SVG(节点数很少,不走增量复用那一套):`<svg>` 根上
`replaceChildren` 就行,不留陈旧节点,也不必维护"哪个元素对应哪个节点"的映射表.

文案全部写进 HTML 的唯一输出区 #treeOutput(提示 / 错误 / 性质清单共用它),
这样颜色 / 字号 / 折行由 CSS 决定,截图与选中复制也都正常;SVG 里只画结构与节点值,
一个字都不多写(与 canvas 时代同一条分工).

每轮 input 的结果是四选一(见 renderTree):
1. 没输入 -> 输出区一行提示(#treeOutput .tree-hint),树清空;
2. 解析成空树(nil) -> 输出区一行提示(同上),树清空;
3. 格式检查不过 -> 输出区一行错误(#treeOutput .tree-error),树清空;
4. 解析成功 -> 输出区性质清单 + 画出树.
*/

/*
样式:`tokens.css`(设计令牌)与 `rbt.css`(输入框 / 输出区 / SVG 树的观感)在本模块
引入(与 SETTING 页 / 地铁车窗同一条做法).
*/
import '@/rbt/rbt.css';

import {
    RBT_CLAMP_TOLERANCE,
    RBT_DIAGNOSTICS_ROW_CLASS,
    RBT_DIAGNOSTICS_STATE_CLASS,
    RBT_DIAGNOSTICS_SUMMARY_CLASS,
    RBT_EDGE_CLASS,
    RBT_EMPTY_HINT_TEXT,
    RBT_EMPTY_TREE_HINT_TEXT,
    RBT_ERROR_UI_PREFIX,
    RBT_MIN_CHILD_WIDTH_FACTOR,
    RBT_MIN_HORIZONTAL_GAP,
    RBT_NODE_BLACK_CLASS,
    RBT_NODE_CLASS,
    RBT_NODE_LABEL_CLASS,
    RBT_NODE_RED_CLASS,
    RBT_NODE_SHAPE_CLASS,
    RBT_OUTPUT_ERROR_CLASS,
    RBT_OUTPUT_HINT_CLASS,
    RBT_PROPERTIES,
    RBT_PROPERTY_STATE_FAIL,
    RBT_PROPERTY_STATE_PASS,
    RBT_SIDE_MARGIN,
    RBT_SINGLE_CHILD_GAP_FACTOR,
    RBT_START_Y,
    RBT_TREE_EXAMPLE,
    RBT_VIEW_BOX_WIDTH,
    RBT_Y_STEP,
} from './config';
import {
    buildTreeFromExpression,
    checkTreeProperties,
    formatPropertySummary,
    type RbtNode,
    type RbtPropertyReport,
} from './rbt_tree';
import { createRbtPanel } from './ui/rbt_panel';
import { childNodes, create_element, create_svg_element } from 'miko_ui';

// ============================================================
// 布局 -- 区间递归分配法:每个节点占据一段水平区间并居中,左右子树各分得父节点
// 两侧的子区间;区间不够时先压到最小间距,再由位置钳制兜底
//
// 坐标写在节点的 x / y 上(单位 = viewBox 坐标),落笔那一步只读它.
// 这一段从 canvas 版本原样继承:它算的是"节点该在哪",与用什么画无关.
//
// 间距全部由 config 的几何常量推出来(半径 -> 最小间距 -> 安全边距),本文件不再另
// 取一份副本:两处半径不一致的表现是"布局按一份算,画出来的圆是另一份",而且不报错.
// ============================================================

/**
 * 递归分配水平区间:节点居中于自己那段,左右子树分走两侧子区间.
 *
 * 三个分支(双孩子 / 只有左 / 只有右)都保留:解析器现在只吐双孩子(单孩子写法
 * `5B(1B)` 在解析阶段就报"缺少逗号"),但布局不该跟着解析器的当前宽严走 --
 * 哪天支持单孩子,这里不用改.
 */
function placeNodeRecursive(node: RbtNode, leftBound: number, rightBound: number, y: number): void {
    // 节点水平居中于可用区间
    const x = (leftBound + rightBound) / 2;
    node.x = x;
    node.y = y;

    const hasLeft = node.left !== null;
    const hasRight = node.right !== null;

    if (hasLeft && hasRight) {
        let leftRightBound = x - RBT_MIN_HORIZONTAL_GAP;
        let rightLeftBound = x + RBT_MIN_HORIZONTAL_GAP;

        const minChildWidth = RBT_MIN_HORIZONTAL_GAP * RBT_MIN_CHILD_WIDTH_FACTOR;
        if (leftRightBound - leftBound < minChildWidth) {
            leftRightBound = leftBound + minChildWidth;
        }
        if (rightBound - rightLeftBound < minChildWidth) {
            rightLeftBound = rightBound - minChildWidth;
        }
        if (leftRightBound >= rightLeftBound) {
            const mid = (leftRightBound + rightLeftBound) / 2;
            leftRightBound = mid - RBT_MIN_HORIZONTAL_GAP / 2;
            rightLeftBound = mid + RBT_MIN_HORIZONTAL_GAP / 2;
        }

        placeNodeRecursive(node.left!, leftBound, leftRightBound, y + RBT_Y_STEP);
        placeNodeRecursive(node.right!, rightLeftBound, rightBound, y + RBT_Y_STEP);
    }
    else if (hasLeft) {
        let leftRightBound = x - RBT_MIN_HORIZONTAL_GAP * RBT_SINGLE_CHILD_GAP_FACTOR;
        if (leftRightBound <= leftBound) leftRightBound = leftBound + RBT_MIN_HORIZONTAL_GAP * RBT_MIN_CHILD_WIDTH_FACTOR;
        placeNodeRecursive(node.left!, leftBound, leftRightBound, y + RBT_Y_STEP);
    }
    else if (hasRight) {
        let rightLeftBound = x + RBT_MIN_HORIZONTAL_GAP * RBT_SINGLE_CHILD_GAP_FACTOR;
        if (rightLeftBound >= rightBound) rightLeftBound = rightBound - RBT_MIN_HORIZONTAL_GAP * RBT_MIN_CHILD_WIDTH_FACTOR;
        placeNodeRecursive(node.right!, rightLeftBound, rightBound, y + RBT_Y_STEP);
    }
}

/** 位置钳制:允许节点略微越出安全边距,但不许整颗跑出 viewBox */
function clampNodePositions(node: RbtNode): void {
    const minX = RBT_SIDE_MARGIN - RBT_CLAMP_TOLERANCE;
    const maxX = RBT_VIEW_BOX_WIDTH - RBT_SIDE_MARGIN + RBT_CLAMP_TOLERANCE;
    if (node.x !== undefined && node.x < minX) node.x = minX;
    if (node.x !== undefined && node.x > maxX) node.x = maxX;
    if (node.left) clampNodePositions(node.left);
    if (node.right) clampNodePositions(node.right);
}

/** 给一棵树算坐标(根居中于整块 viewBox 的可用宽度) */
function layoutTree(root: RbtNode): void {
    const leftBoundary = RBT_SIDE_MARGIN;
    const rightBoundary = RBT_VIEW_BOX_WIDTH - RBT_SIDE_MARGIN;
    if (leftBoundary >= rightBoundary) return;

    placeNodeRecursive(root, leftBoundary, rightBoundary, RBT_START_Y);
    clampNodePositions(root);
}

// ============================================================
// 落笔 -- 把一棵算好坐标的树建成 SVG 节点
//
// 每个节点一个 `<g>`:位置写在组的 `transform` 上,圆与文字是它的两个孩子.
// 为什么位置放组上而不是各自算:拖动一个节点时只改这一处 `transform`,圆与文字
// 自动跟着走;动画也只插值这一个属性.
//
// 颜色只给类名(`.rbt-node--red` / `--black`),不给 fill / stroke:观感全在 CSS,
// 换配色不用碰 TS(见 config 的类名契约一节).
// ============================================================

/** 一个节点组:位置 + 颜色修饰类 + 圆 + 节点值 */
function createNodeElement(node: RbtNode): SVGGElement {
    const group = create_svg_element(
        { tag: 'g' },
        {
            class: `${RBT_NODE_CLASS} ${node.color === 'R' ? RBT_NODE_RED_CLASS : RBT_NODE_BLACK_CLASS}`,
            transform: `translate(${node.x},${node.y})`,
        },
        create_svg_element({ tag: 'circle' }, { class: RBT_NODE_SHAPE_CLASS }),
        create_svg_element({ tag: 'text' }, { class: RBT_NODE_LABEL_CLASS }, node.value),
    );
    return group;
}

/** 一条父子连线(`x1/y1` 是父节点,`x2/y2` 是子节点) */
function createEdgeElement(from: RbtNode, to: RbtNode): SVGLineElement {
    return create_svg_element(
        { tag: 'line' },
        {
            class: RBT_EDGE_CLASS,
            x1: String(from.x),
            y1: String(from.y),
            x2: String(to.x),
            y2: String(to.y),
        },
    );
}

/** 先序遍历,每个节点调一次 `visit`(连线由 `visit` 自己按左右孩子建) */
function walkTree(node: RbtNode | null, visit: (node: RbtNode) => void): void {
    if (!node) return;
    visit(node);
    walkTree(node.left, visit);
    walkTree(node.right, visit);
}

/**
 * 画一棵树:整批重建 `<svg>` 根的子节点(先连线,后节点 -- 节点盖在线上).
 *
 * 只接非空根:没有树可画时调用方走 clearTreeSvg().
 */
export function renderTreeSvg(svgRoot: SVGSVGElement, root: RbtNode): void {
    layoutTree(root);

    const edges: SVGLineElement[] = [];
    const nodes: SVGGElement[] = [];
    walkTree(root, (node) => {
        if (node.left) edges.push(createEdgeElement(node, node.left));
        if (node.right) edges.push(createEdgeElement(node, node.right));
        nodes.push(createNodeElement(node));
    });

    /*
      整批换掉根的子节点,而不是"往空根里 append 一个图层":

      - **不包一层 `<g class="rbt-layer">`**:节点本来就带 `.rbt-node`,连线带
        `.rbt-edge`,样式与冒烟脚本都按类名命中,再套一层只是多一个不起作用的元素;
      - 连线排在节点之前:`<svg>` 里后画的盖在先画的上面,所以节点永远压在连线上
        (canvas 时代靠"先画线再画节点"保证同一件事);
      - 子节点走库的 `childNodes()`(与 `replaceChildren` 同一套"字符串落成文本节点,
        假值跳过"的规则),不自己拼 innerHTML.
    */
    svgRoot.replaceChildren(...childNodes([...edges, ...nodes], svgRoot));
}

/** 清空画布:一颗节点 / 一条线都不留(输入为空 / 空树 / 解析失败三种情况) */
export function clearTreeSvg(svgRoot: SVGSVGElement): void {
    svgRoot.replaceChildren();
}

// ============================================================
// 原生 TS 挂载模块
// ============================================================

/** 输出区里的一行纯文本(提示 / 错误),类名决定颜色 */
function textLine(className: string, text: string): HTMLElement {
    const line = create_element({ tag: 'div' }, { class: className }, text);
    return line;
}

/**
 * 性质清单:抬头 + 四条,每条是
 * `<div class="tree-property">性质名: <span class="tree-property-state">PASS / FAIL</span> 出错位置</div>`.
 *
 * 条数与文案都由 config 的 RBT_PROPERTIES 决定,逐条建完交给 renderOutput 整批换掉.
 */
function propertyLines(report: RbtPropertyReport): HTMLElement[] {
    const rows = RBT_PROPERTIES.map((spec, index) => {
        const result = report.results[index];
        // 这个类名是冒烟脚本数行数的锚点(见 config.ts 的同名常量)
        const row = create_element({ tag: 'div' }, { class: RBT_DIAGNOSTICS_ROW_CLASS });
        const state = create_element(
            { tag: 'span' },
            {
                class: result.pass
                    ? `${RBT_DIAGNOSTICS_STATE_CLASS} is-pass`
                    : `${RBT_DIAGNOSTICS_STATE_CLASS} is-fail`,
            },
            result.pass ? RBT_PROPERTY_STATE_PASS : RBT_PROPERTY_STATE_FAIL,
        );
        row.append(`${spec.label}: `, state);
        if (!result.pass && result.detail !== '') {
            row.append(` ${result.detail}`);
        }
        return row;
    });
    const summary = textLine(RBT_DIAGNOSTICS_SUMMARY_CLASS, formatPropertySummary(report));
    return [summary, ...rows];
}

/**
 * 把红黑树面板挂到宿主(骨架交回的 `shell.panes.rbt` 空窗格)上.
 * 标记由 rbt_panel.ts 生成并把元素引用交回,所以这里只按引用操作元素,
 * 不查 DOM,也没有"找不到元素"的失败路径;绘制在 renderTreeSvg,解析与性质检查在
 * rbt_tree.ts.
 */
export function mountRBT(host: HTMLElement): void {
    const panel = createRbtPanel();
    // 宿主由本模块独占(骨架建的空窗格),用 replaceChildren 整体接管:
    // 重复挂载不会留下两份同 id 的标记(见 clock.ts / oled.ts 的同一条约定).
    host.replaceChildren(panel.root);

    const input = panel.input;
    const outputEl = panel.output;
    const treeEl = panel.tree;

    /**
     * 输出区的写入口:整批替换 #treeOutput 的子节点,空数组就整块 hidden.
     *
     * 提示行 / 错误行 / 性质清单都走这一条路 -- 它们只是"这一轮要显示的内容",
     * 没有 stdout 与 stderr 那种必须分流的语义;整批替换也让"上一轮的东西残留"
     * 变成不可能(行数很少,不是性能路径).
     */
    const renderOutput = (children: readonly HTMLElement[]): void => {
        outputEl.replaceChildren(...children);
        outputEl.hidden = children.length === 0;
    };

    const renderTree = (): void => {
        const expr = input.value.trim();

        if (expr === '') {
            // 没输入:说清画布为什么是空的
            renderOutput([textLine(RBT_OUTPUT_HINT_CLASS, RBT_EMPTY_HINT_TEXT)]);
            clearTreeSvg(treeEl);
            return;
        }

        try {
            // 第 1 步:格式检查(解析).过了才有树可查性质
            const rootNode = buildTreeFromExpression(expr);
            if (rootNode === null) {
                // 表达式非空但解析成空树(nil):没有节点可画,也没有性质可查
                renderOutput([textLine(RBT_OUTPUT_HINT_CLASS, RBT_EMPTY_TREE_HINT_TEXT)]);
                clearTreeSvg(treeEl);
                return;
            }
            // 第 2 步:性质检查写进输出区,画布只画这棵树
            renderOutput(propertyLines(checkTreeProperties(rootNode)));
            renderTreeSvg(treeEl, rootNode);
        } catch (err) {
            // 格式检查没过:输出区出一行错误(性质检查的输入都还没有);
            // 画布清空而不写错误文案 -- 文案一律归 HTML
            renderOutput([
                textLine(RBT_OUTPUT_ERROR_CLASS, `${RBT_ERROR_UI_PREFIX}${(err as Error).message}`),
            ]);
            clearTreeSvg(treeEl);
        }
    };

    input.addEventListener('input', renderTree);

    // 打开页面时自动加载示例
    input.value = RBT_TREE_EXAMPLE;
    renderTree();
}
