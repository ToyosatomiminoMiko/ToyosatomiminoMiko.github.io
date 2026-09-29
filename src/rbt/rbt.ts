/*
2026.05.01.00:00:00
红黑树工具:画布绘制 + 挂载

解析与性质检查在 rbt_tree.ts(纯逻辑,可单测);本文件只剩两件事:
- TreeDrawer:区间递归分配布局 + 画节点 / 连线 / 文本;
- mountRBT:接管宿主,把"格式检查 -> 性质检查 -> 重绘"接到输入框的 input 事件上.

三步的先后是死的(见 renderTree):
1. 解析(格式检查)不过 -> 只出 #treeError,画布画错误文案,清单隐藏;
2. 解析过了 -> 画树,并把性质检查的结果画在画布顶部(清单也点亮);
3. 输入为空 -> 画布出提示文案,错误与清单都隐藏.
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
    RBT_EMPTY_HINT_COLOR,
    RBT_EMPTY_HINT_FONT,
    RBT_EMPTY_HINT_TEXT,
    RBT_EMPTY_TEXT,
    RBT_ERROR_HINT_COLOR,
    RBT_ERROR_HINT_FONT,
    RBT_ERROR_PREFIX,
    RBT_ERROR_TEXT_MAX,
    RBT_ERROR_UI_PREFIX,
    RBT_MIN_CHILD_WIDTH_FACTOR,
    RBT_MIN_HORIZONTAL_GAP,
    RBT_NODE_FONT_FAMILY,
    RBT_NODE_FONT_MIN_SIZE,
    RBT_NODE_FONT_RADIUS_FACTOR,
    RBT_NODE_RADIUS,
    RBT_NODE_SHADOW_BLUR,
    RBT_NODE_SHADOW_COLOR,
    RBT_PROPERTIES,
    RBT_PROPERTY_FAIL_COLOR,
    RBT_PROPERTY_PASS_COLOR,
    RBT_PROPERTY_ROW_FONT,
    RBT_PROPERTY_ROW_LINE_HEIGHT,
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
     * 把性质检查的结论画在画布左上角(树之前先画,树盖不住这几行之外的区域).
     *
     * 为什么清单之外还要在画布上画一份:清单在输入框下面,长表达式把输入框拉高
     * 之后会被推出屏幕,而"这棵树到底合不合法"是这幅图的一部分 -- 截图或单看画布
     * 时不带上结论就会漏看.两处渲染的是同一份 report,不会一处通过一处不通过.
     */
    renderPropertyReport(report: RbtPropertyReport): void {
        const ctx = this.ctx;
        const left = 16;
        let y = 24;

        ctx.textAlign = 'left';
        ctx.textBaseline = RBT_TEXT_BASELINE;
        ctx.font = RBT_ERROR_HINT_FONT;
        ctx.fillStyle = report.failedCount === 0 ? RBT_PROPERTY_PASS_COLOR : RBT_PROPERTY_FAIL_COLOR;
        ctx.fillText(formatPropertySummary(report), left, y);

        ctx.font = RBT_PROPERTY_ROW_FONT;
        for (const [index, spec] of RBT_PROPERTIES.entries()) {
            const result = report.results[index];
            y += RBT_PROPERTY_ROW_LINE_HEIGHT;
            ctx.fillStyle = result.pass ? RBT_PROPERTY_PASS_COLOR : RBT_PROPERTY_FAIL_COLOR;
            const state = result.pass ? RBT_PROPERTY_STATE_PASS : RBT_PROPERTY_STATE_FAIL;
            // 不通过时把出错位置一起画上:只说"不通过",读者还得自己找是哪一层
            const detail = result.pass || result.detail === '' ? '' : ` (${result.detail})`;
            ctx.fillText(`${spec.label}: ${state}${detail}`, left, y);
        }
        // 交还画布状态,别影响后面的绘制(错误文案与树都由各自的分支重设对齐)
        ctx.textAlign = RBT_TEXT_ALIGN;
    }

    render(root: RbtNode | null): void {
        this.clearCanvas();
        if (!root) {
            this.ctx.font = RBT_EMPTY_HINT_FONT;
            this.ctx.fillStyle = RBT_EMPTY_HINT_COLOR;
            this.ctx.textAlign = RBT_TEXT_ALIGN;
            this.ctx.fillText(RBT_EMPTY_HINT_TEXT, this.canvasWidth / 2, this.canvasHeight / 2);
            return;
        }

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
    const errorEl = panel.error;
    const diagnosticsEl = panel.diagnostics;
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
     * 把清单渲染成"每条一行":抬头 + 四条性质,每条是
     * `<div class="tree-property">性质名: <span class="tree-property-state">通过 / 不通过</span> 出错位置</div>`.
     *
     * 整批重建而不是逐条更新:条数与文案都由 config 的 RBT_PROPERTIES 决定,
     * 重建最省事也很难写错;这一块每次输入都会重建,但只有"抬头 + 四条"这么几个
     * 节点,不是性能路径.
     */
    const renderDiagnostics = (report: RbtPropertyReport | null): void => {
        if (report === null) {
            diagnosticsEl.replaceChildren();
            diagnosticsEl.hidden = true;
            return;
        }
        const rows = RBT_PROPERTIES.map((spec, index) => {
            const result = report.results[index];
            const row = document.createElement('div');
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
        const summary = document.createElement('div');
        summary.className = RBT_DIAGNOSTICS_SUMMARY_CLASS;
        summary.textContent = formatPropertySummary(report);
        diagnosticsEl.replaceChildren(summary, ...rows);
        diagnosticsEl.hidden = false;
    };

    const renderTree = (): void => {
        const activeDrawer = ensureDrawer();
        const expr = input.value.trim();

        const setError = (msg: string): void => {
            errorEl.textContent = msg ? `${RBT_ERROR_UI_PREFIX}${msg}` : RBT_EMPTY_TEXT;
            errorEl.hidden = msg === RBT_EMPTY_TEXT;
        };

        if (expr === RBT_EMPTY_TEXT) {
            setError(RBT_EMPTY_TEXT);
            renderDiagnostics(null);
            activeDrawer.render(null);
            return;
        }

        try {
            // 第 1 步:格式检查(解析).过了才有树可查性质
            const rootNode = buildTreeFromExpression(expr);
            setError(RBT_EMPTY_TEXT);
            if (rootNode === null) {
                // 表达式非空但解析成 nil:画布出空树提示,没有性质可查
                renderDiagnostics(null);
                activeDrawer.render(null);
                return;
            }
            // 第 2 步:性质检查.清单与画布上那几行渲染同一份 report
            const report = checkTreeProperties(rootNode);
            renderDiagnostics(report);
            activeDrawer.render(rootNode);
            activeDrawer.renderPropertyReport(report);
        } catch (err) {
            // 格式检查没过:只出错误框,清单隐藏(性质检查的输入都还没有)
            const msg = (err as Error).message;
            setError(msg);
            renderDiagnostics(null);
            activeDrawer.clearCanvas();
            activeDrawer.ctx.font = RBT_ERROR_HINT_FONT;
            activeDrawer.ctx.fillStyle = RBT_ERROR_HINT_COLOR;
            activeDrawer.ctx.textAlign = RBT_TEXT_ALIGN;
            activeDrawer.ctx.fillText(
                `${RBT_ERROR_PREFIX}${msg.slice(0, RBT_ERROR_TEXT_MAX)}`,
                activeDrawer.canvasWidth / 2,
                activeDrawer.canvasHeight / 2
            );
        }
    };

    input.addEventListener('input', renderTree);

    // 打开页面时自动加载示例
    input.value = RBT_TREE_EXAMPLE;
    renderTree();
}
