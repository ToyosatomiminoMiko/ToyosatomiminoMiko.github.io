/*
2026.05.01.00:00:00
红黑树工具:画布绘制 + 挂载

解析与性质检查在 rbt_tree.ts(纯逻辑,可单测);本文件只剩两件事:
- TreeDrawer:区间递归分配布局 + 画节点 / 连线(画布**只画树**:节点值,连线,
  底色,不写任何提示或错误文案);
- mountRBT:接管宿主,把"格式检查 -> 性质检查 -> 重绘"接到输入框的 input 事件上.

文案全部写进 HTML 的唯一输出区 #treeOutput(提示 / 错误 / 性质清单共用它),
这样颜色 / 字号 / 折行由 CSS 决定,截图与选中复制也都正常;画布上一旦写字,
这些就都做不了.

每轮 input 的结果是四选一(见 renderTree):
1. 没输入 -> 输出区一行提示(#treeOutput .tree-hint),画布清空;
2. 解析成空树(nil) -> 输出区一行提示(同上),画布清空;
3. 格式检查不过 -> 输出区一行错误(#treeOutput .tree-error),画布清空;
4. 解析成功 -> 输出区性质清单 + 画布画树.
*/
import {
    RBT_BLACK_NODE_FILL,
    RBT_BLACK_NODE_LINE_WIDTH,
    RBT_BLACK_NODE_STROKE,
    RBT_BLACK_NODE_TEXT,
    RBT_CANVAS_BACKGROUND,
    RBT_CLAMP_TOLERANCE,
    RBT_COLOR_RED,
    RBT_DIAGNOSTICS_ROW_CLASS,
    RBT_DIAGNOSTICS_STATE_CLASS,
    RBT_DIAGNOSTICS_SUMMARY_CLASS,
    RBT_EDGE_COLOR,
    RBT_EDGE_LINE_WIDTH,
    RBT_EMPTY_HINT_TEXT,
    RBT_EMPTY_TREE_HINT_TEXT,
    RBT_ERROR_UI_PREFIX,
    RBT_MIN_CHILD_WIDTH_FACTOR,
    RBT_MIN_HORIZONTAL_GAP,
    RBT_NODE_FONT_FAMILY,
    RBT_NODE_FONT_MIN_SIZE,
    RBT_NODE_FONT_RADIUS_FACTOR,
    RBT_NODE_RADIUS,
    RBT_NODE_SHADOW_BLUR,
    RBT_NODE_SHADOW_COLOR,
    RBT_OUTPUT_ERROR_CLASS,
    RBT_OUTPUT_HINT_CLASS,
    RBT_PROPERTIES,
    RBT_PROPERTY_STATE_FAIL,
    RBT_PROPERTY_STATE_PASS,
    RBT_RED_NODE_FILL,
    RBT_RED_NODE_LINE_WIDTH,
    RBT_RED_NODE_STROKE,
    RBT_RED_NODE_TEXT,
    RBT_SIDE_MARGIN,
    RBT_SINGLE_CHILD_GAP_FACTOR,
    RBT_START_Y,
    RBT_TEXT_ALIGN,
    RBT_TEXT_BASELINE,
    RBT_TREE_EXAMPLE,
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

// ============================================================
// 画布绘制器 -- 区间递归分配法:每个节点占据一段水平区间并居中,左右子树
// 各分得父节点两侧的子区间;区间不够时先压到最小间距,再由位置钳制兜底
//
// 落笔只有三类:底色,节点圆与节点值,父子连线.提示 / 错误 / 性质结论一概不画
// (它们归 HTML 元素),所以除了 drawNode 里的节点值以外没有任何 fillText.
// ============================================================
class TreeDrawer {
    ctx: CanvasRenderingContext2D;
    canvasWidth: number;
    canvasHeight: number;
    nodeRadius: number;
    yStep: number;
    startY: number;
    minHorizontalGap: number;
    sideMargin: number;

    constructor(ctx: CanvasRenderingContext2D, canvasWidth: number, canvasHeight: number) {
        this.ctx = ctx;
        this.canvasWidth = canvasWidth;
        this.canvasHeight = canvasHeight;
        this.nodeRadius = RBT_NODE_RADIUS;
        this.yStep = RBT_Y_STEP;
        this.startY = RBT_START_Y;
        this.minHorizontalGap = RBT_MIN_HORIZONTAL_GAP;
        this.sideMargin = RBT_SIDE_MARGIN;
    }

    // --------------------------------------------------------
    // 核心布局: 递归分配区间
    // --------------------------------------------------------
    private placeNodeRecursive(node: RbtNode, leftBound: number, rightBound: number, y: number): void {
        // 节点水平居中于可用区间
        const x = (leftBound + rightBound) / 2;
        node.x = x;
        node.y = y;

        const hasLeft = node.left !== null;
        const hasRight = node.right !== null;

        if (hasLeft && hasRight) {
            let leftRightBound = node.x - this.minHorizontalGap;
            let rightLeftBound = node.x + this.minHorizontalGap;

            const minChildWidth = this.minHorizontalGap * RBT_MIN_CHILD_WIDTH_FACTOR;
            if (leftRightBound - leftBound < minChildWidth) {
                leftRightBound = leftBound + minChildWidth;
            }
            if (rightBound - rightLeftBound < minChildWidth) {
                rightLeftBound = rightBound - minChildWidth;
            }
            if (leftRightBound >= rightLeftBound) {
                const mid = (leftRightBound + rightLeftBound) / 2;
                leftRightBound = mid - this.minHorizontalGap / 2;
                rightLeftBound = mid + this.minHorizontalGap / 2;
            }

            this.placeNodeRecursive(node.left!, leftBound, leftRightBound, y + this.yStep);
            this.placeNodeRecursive(node.right!, rightLeftBound, rightBound, y + this.yStep);
        }
        else if (hasLeft) {
            let leftRightBound = node.x - this.minHorizontalGap * RBT_SINGLE_CHILD_GAP_FACTOR;
            if (leftRightBound <= leftBound) leftRightBound = leftBound + this.minHorizontalGap * RBT_MIN_CHILD_WIDTH_FACTOR;
            this.placeNodeRecursive(node.left!, leftBound, leftRightBound, y + this.yStep);
        }
        else if (hasRight) {
            let rightLeftBound = node.x + this.minHorizontalGap * RBT_SINGLE_CHILD_GAP_FACTOR;
            if (rightLeftBound >= rightBound) rightLeftBound = rightBound - this.minHorizontalGap * RBT_MIN_CHILD_WIDTH_FACTOR;
            this.placeNodeRecursive(node.right!, rightLeftBound, rightBound, y + this.yStep);
        }
    }

    layoutTree(root: RbtNode): void {
        const leftBoundary = this.sideMargin;
        const rightBoundary = this.canvasWidth - this.sideMargin;
        if (leftBoundary >= rightBoundary) return;

        this.placeNodeRecursive(root, leftBoundary, rightBoundary, this.startY);
        this.clampNodePositions(root);
    }

    private clampNodePositions(node: RbtNode): void {
        const minX = this.sideMargin - RBT_CLAMP_TOLERANCE;
        const maxX = this.canvasWidth - this.sideMargin + RBT_CLAMP_TOLERANCE;
        if (node.x !== undefined && node.x < minX) node.x = minX;
        if (node.x !== undefined && node.x > maxX) node.x = maxX;
        if (node.left) this.clampNodePositions(node.left);
        if (node.right) this.clampNodePositions(node.right);
    }

    drawLines(node: RbtNode | null): void {
        if (!node) return;
        const ctx = this.ctx;
        const startX = node.x!;
        const startY = node.y!;

        if (node.left) {
            ctx.beginPath();
            ctx.moveTo(startX, startY);
            ctx.lineTo(node.left.x!, node.left.y!);
            ctx.strokeStyle = RBT_EDGE_COLOR;
            ctx.lineWidth = RBT_EDGE_LINE_WIDTH;
            ctx.stroke();
            this.drawLines(node.left);
        }
        if (node.right) {
            ctx.beginPath();
            ctx.moveTo(startX, startY);
            ctx.lineTo(node.right.x!, node.right.y!);
            ctx.strokeStyle = RBT_EDGE_COLOR;
            ctx.lineWidth = RBT_EDGE_LINE_WIDTH;
            ctx.stroke();
            this.drawLines(node.right);
        }
    }

    drawNode(node: RbtNode): void {
        const ctx = this.ctx;
        const x = node.x!;
        const y = node.y!;
        const r = this.nodeRadius;

        ctx.shadowColor = RBT_NODE_SHADOW_COLOR;
        ctx.shadowBlur = RBT_NODE_SHADOW_BLUR;
        if (node.color === RBT_COLOR_RED) {
            ctx.fillStyle = RBT_RED_NODE_FILL;
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = RBT_RED_NODE_STROKE;
            ctx.lineWidth = RBT_RED_NODE_LINE_WIDTH;
            ctx.stroke();
            ctx.fillStyle = RBT_RED_NODE_TEXT;
        } else {
            ctx.fillStyle = RBT_BLACK_NODE_FILL;
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = RBT_BLACK_NODE_STROKE;
            ctx.lineWidth = RBT_BLACK_NODE_LINE_WIDTH;
            ctx.stroke();
            ctx.fillStyle = RBT_BLACK_NODE_TEXT;
        }
        ctx.shadowBlur = 0;
        ctx.font = `bold ${Math.max(RBT_NODE_FONT_MIN_SIZE, Math.floor(r * RBT_NODE_FONT_RADIUS_FACTOR))}px ${RBT_NODE_FONT_FAMILY}`;
        ctx.textAlign = RBT_TEXT_ALIGN;
        ctx.textBaseline = RBT_TEXT_BASELINE;
        ctx.fillText(node.value, x, y);
    }

    drawAllNodes(node: RbtNode | null): void {
        if (!node) return;
        this.drawNode(node);
        this.drawAllNodes(node.left);
        this.drawAllNodes(node.right);
    }

    clearCanvas(): void {
        this.ctx.clearRect(0, 0, this.canvasWidth, this.canvasHeight);
        this.ctx.fillStyle = RBT_CANVAS_BACKGROUND;
        this.ctx.fillRect(0, 0, this.canvasWidth, this.canvasHeight);
    }

    /**
     * 画一棵树:先铺底色,再连线,最后画节点(节点盖在线上).
     *
     * 只接非空根:没有树可画时调用方走 clearCanvas(),画布上不会出现任何文字 --
     * 空树提示与错误提示都在 HTML 里(见 renderTree).
     */
    render(root: RbtNode): void {
        this.clearCanvas();
        this.layoutTree(root);
        this.drawLines(root);
        this.drawAllNodes(root);
    }
}

// ============================================================
// 原生 TS 挂载模块
// ============================================================
/**
 * 把红黑树面板挂到宿主(骨架交回的 `shell.panes.rbt` 空窗格)上.
 * 标记由 rbt_panel.ts 生成并把元素引用交回,所以这里只按引用操作元素,
 * 不查 DOM,也没有"找不到元素"的失败路径;绘制在 TreeDrawer,解析与性质检查在
 * rbt_tree.ts.
 */
export function mountRBT(host: HTMLElement): void {
    const panel = createRbtPanel();
    // 宿主由本模块独占(骨架建的空窗格),用 replaceChildren 整体接管:
    // 重复挂载不会留下两份同 id 的标记(见 clock.ts / oled.ts 的同一条约定).
    host.replaceChildren(panel.root);

    const input = panel.input;
    const outputEl = panel.output;
    const canvas = panel.canvas;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let drawer: TreeDrawer | null = null;

    const ensureDrawer = (): TreeDrawer => {
        if (!drawer || drawer.canvasWidth !== canvas.width || drawer.canvasHeight !== canvas.height) {
            drawer = new TreeDrawer(ctx, canvas.width, canvas.height);
        }
        return drawer;
    };

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

    /** 输出区里的一行纯文本(提示 / 错误),类名决定颜色 */
    const textLine = (className: string, text: string): HTMLElement => {
        const line = document.createElement('div');
        line.className = className;
        line.textContent = text;
        return line;
    };

    /**
     * 性质清单:抬头 + 四条,每条是
     * `<div class="tree-property">性质名: <span class="tree-property-state">PASS / FAIL</span> 出错位置</div>`.
     *
     * 条数与文案都由 config 的 RBT_PROPERTIES 决定,逐条建完交给 renderOutput 整批换掉.
     */
    const propertyLines = (report: RbtPropertyReport): HTMLElement[] => {
        const rows = RBT_PROPERTIES.map((spec, index) => {
            const result = report.results[index];
            const row = document.createElement('div');
            // 这个类名是冒烟脚本数行数的锚点(见 config.ts 的同名常量)
            row.className = RBT_DIAGNOSTICS_ROW_CLASS;
            row.append(document.createTextNode(`${spec.label}: `));
            const state = document.createElement('span');
            state.className = RBT_DIAGNOSTICS_STATE_CLASS;
            state.classList.add(result.pass ? 'is-pass' : 'is-fail');
            state.textContent = result.pass ? RBT_PROPERTY_STATE_PASS : RBT_PROPERTY_STATE_FAIL;
            row.append(state);
            if (!result.pass && result.detail !== '') {
                row.append(document.createTextNode(` ${result.detail}`));
            }
            return row;
        });
        const summary = textLine(RBT_DIAGNOSTICS_SUMMARY_CLASS, formatPropertySummary(report));
        return [summary, ...rows];
    };

    const renderTree = (): void => {
        const activeDrawer = ensureDrawer();
        const expr = input.value.trim();

        if (expr === '') {
            // 没输入:说清画布为什么是空的
            renderOutput([textLine(RBT_OUTPUT_HINT_CLASS, RBT_EMPTY_HINT_TEXT)]);
            activeDrawer.clearCanvas();
            return;
        }

        try {
            // 第 1 步:格式检查(解析).过了才有树可查性质
            const rootNode = buildTreeFromExpression(expr);
            if (rootNode === null) {
                // 表达式非空但解析成空树(nil):没有节点可画,也没有性质可查
                renderOutput([textLine(RBT_OUTPUT_HINT_CLASS, RBT_EMPTY_TREE_HINT_TEXT)]);
                activeDrawer.clearCanvas();
                return;
            }
            // 第 2 步:性质检查写进输出区,画布只画这棵树
            renderOutput(propertyLines(checkTreeProperties(rootNode)));
            activeDrawer.render(rootNode);
        } catch (err) {
            // 格式检查没过:输出区出一行错误(性质检查的输入都还没有);
            // 画布清空而不写错误文案 -- 文案一律归 HTML
            renderOutput([
                textLine(RBT_OUTPUT_ERROR_CLASS, `${RBT_ERROR_UI_PREFIX}${(err as Error).message}`),
            ]);
            activeDrawer.clearCanvas();
        }
    };

    input.addEventListener('input', renderTree);

    // 打开页面时自动加载示例
    input.value = RBT_TREE_EXAMPLE;
    renderTree();
}
