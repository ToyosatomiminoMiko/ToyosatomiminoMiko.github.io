/*
2026.05.01.00:00:00
红黑树工具
*/
import {
    RBT_BLACK_NODE_FILL,
    RBT_BLACK_NODE_LINE_WIDTH,
    RBT_BLACK_NODE_STROKE,
    RBT_BLACK_NODE_TEXT,
    RBT_CANVAS_BACKGROUND,
    RBT_CLAMP_TOLERANCE,
    RBT_COLOR_BLACK,
    RBT_COLOR_RED,
    RBT_COMMA,
    RBT_DOM,
    RBT_DOM_MISSING_MESSAGE,
    RBT_EDGE_COLOR,
    RBT_EDGE_LINE_WIDTH,
    RBT_EMPTY_HINT_COLOR,
    RBT_EMPTY_HINT_FONT,
    RBT_EMPTY_HINT_TEXT,
    RBT_EMPTY_TEXT,
    RBT_ERR_COLOR_MARK,
    RBT_ERR_NODE_FORMAT,
    RBT_ERR_NO_COMMA,
    RBT_ERR_PARSE_FAILED,
    RBT_ERR_SHORTHAND_NO_COLOR,
    RBT_ERR_SHORTHAND_TOO_SHORT,
    RBT_ERR_SHORTHAND_TOO_SHORT_SUFFIX,
    RBT_ERR_UNBALANCED,
    RBT_ERROR_HINT_COLOR,
    RBT_ERROR_HINT_FONT,
    RBT_ERROR_PREFIX,
    RBT_ERROR_TEXT_MAX,
    RBT_ERROR_UI_PREFIX,
    RBT_LEAF_SUFFIX,
    RBT_LEFT_PAREN,
    RBT_MIN_CHILD_WIDTH_FACTOR,
    RBT_MIN_HORIZONTAL_GAP,
    RBT_MIN_SHORTHAND_LENGTH,
    RBT_NIL,
    RBT_NODE_FONT_FAMILY,
    RBT_NODE_FONT_MIN_SIZE,
    RBT_NODE_FONT_RADIUS_FACTOR,
    RBT_NODE_RADIUS,
    RBT_NODE_SHADOW_BLUR,
    RBT_NODE_SHADOW_COLOR,
    RBT_RED_NODE_FILL,
    RBT_RED_NODE_LINE_WIDTH,
    RBT_RED_NODE_STROKE,
    RBT_RED_NODE_TEXT,
    RBT_RIGHT_PAREN,
    RBT_SIDE_MARGIN,
    RBT_SINGLE_CHILD_GAP_FACTOR,
    RBT_START_Y,
    RBT_TEXT_ALIGN,
    RBT_TEXT_BASELINE,
    RBT_TREE_EXAMPLE,
    RBT_Y_STEP,
} from './rbt.config';

// ============================================================
// 红黑树节点定义 (支持任意数值/字符串)
// ============================================================
type Color = 'R' | 'B';

class RBNode {
    value: string;
    color: Color;
    left: RBNode | null;
    right: RBNode | null;
    // 布局时添加的坐标属性(由 TreeDrawer 设置)
    x?: number;
    y?: number;

    constructor(value: string, color: Color, left: RBNode | null = null, right: RBNode | null = null) {
        this.value = value;
        this.color = color;
        this.left = left;
        this.right = right;
    }
}

// ============================================================
// 解析核心: 支持 "13B(8R(1B,11R),17R(15B,25B))" 以及简写叶子 "5R" -> 自动补全 "(nil,nil)"
// ============================================================
function trim(s: string): string {
    return s.trim();
}

function parseNode(str: string): RBNode | null {
    let s = trim(str);
    // nil / 空 直接返回 null
    if (s === '' || s === RBT_NIL || s === 'Nil' || s === 'NIL') {
        return null;
    }

    // 简写叶子节点: 不带括号 => 自动包装成 值颜色(nil,nil)
    if (!s.includes(RBT_LEFT_PAREN)) {
        if (s.length < RBT_MIN_SHORTHAND_LENGTH) {
            throw new Error(`${RBT_ERR_SHORTHAND_TOO_SHORT}${s}${RBT_ERR_SHORTHAND_TOO_SHORT_SUFFIX}`);
        }
        const lastChar = s[s.length - 1];
        if (lastChar !== RBT_COLOR_RED && lastChar !== RBT_COLOR_BLACK) {
            throw new Error(`${RBT_ERR_SHORTHAND_NO_COLOR}${s}"`);
        }
        const fullExpr = `${s}${RBT_LEAF_SUFFIX}`;
        return parseNode(fullExpr);
    }

    // 标准带括号解析
    const leftParenIdx = s.indexOf(RBT_LEFT_PAREN);
    const valueColorPart = s.substring(0, leftParenIdx);
    if (valueColorPart.length < RBT_MIN_SHORTHAND_LENGTH) {
        throw new Error(`${RBT_ERR_NODE_FORMAT}${valueColorPart}`);
    }
    const colorChar = valueColorPart[valueColorPart.length - 1];
    if (colorChar !== RBT_COLOR_RED && colorChar !== RBT_COLOR_BLACK) {
        throw new Error(`${RBT_ERR_COLOR_MARK}${valueColorPart}`);
    }
    const valueStr = valueColorPart.substring(0, valueColorPart.length - 1);
    const nodeValue = valueStr;

    // 匹配括号内左右子树
    let balance = 1;
    let rightParenIdx = leftParenIdx + 1;
    while (rightParenIdx < s.length && balance > 0) {
        if (s[rightParenIdx] === RBT_LEFT_PAREN) balance++;
        else if (s[rightParenIdx] === RBT_RIGHT_PAREN) balance--;
        rightParenIdx++;
    }
    if (balance !== 0) {
        throw new Error(`${RBT_ERR_UNBALANCED}${s}`);
    }
    const inside = s.substring(leftParenIdx + 1, rightParenIdx - 1);
    let leftStr = '', rightStr = '';
    let commaIdx = -1;
    let depth = 0;
    for (let i = 0; i < inside.length; i++) {
        const ch = inside[i];
        if (ch === RBT_LEFT_PAREN) depth++;
        else if (ch === RBT_RIGHT_PAREN) depth--;
        else if (ch === RBT_COMMA && depth === 0) {
            commaIdx = i;
            break;
        }
    }
    if (commaIdx === -1) {
        throw new Error(`${RBT_ERR_NO_COMMA}${inside}`);
    }
    leftStr = inside.substring(0, commaIdx);
    rightStr = inside.substring(commaIdx + 1);

    const leftChild = parseNode(leftStr);
    const rightChild = parseNode(rightStr);
    return new RBNode(nodeValue, colorChar as Color, leftChild, rightChild);
}

function buildTreeFromExpression(expr: string): RBNode | null {
    if (!expr || expr.trim() === '') {
        return null;
    }
    try {
        return parseNode(expr);
    } catch (e) {
        console.error(e);
        throw new Error(`${RBT_ERR_PARSE_FAILED}${(e as Error).message}`);
    }
}

// ============================================================
// 画布绘制器 -- 采用[区间递归分配法]彻底避免节点重叠/交叉
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
    private placeNodeRecursive(node: RBNode, leftBound: number, rightBound: number, y: number): void {
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
        // 无孩子:叶子节点不需递归
    }

    layoutTree(root: RBNode): void {
        if (!root) return;
        const leftBoundary = this.sideMargin;
        const rightBoundary = this.canvasWidth - this.sideMargin;
        if (leftBoundary >= rightBoundary) return;

        this.placeNodeRecursive(root, leftBoundary, rightBoundary, this.startY);
        this.clampNodePositions(root);
    }

    private clampNodePositions(node: RBNode): void {
        if (!node) return;
        const minX = this.sideMargin - RBT_CLAMP_TOLERANCE;
        const maxX = this.canvasWidth - this.sideMargin + RBT_CLAMP_TOLERANCE;
        if (node.x !== undefined && node.x < minX) node.x = minX;
        if (node.x !== undefined && node.x > maxX) node.x = maxX;
        if (node.left) this.clampNodePositions(node.left);
        if (node.right) this.clampNodePositions(node.right);
    }

    drawLines(node: RBNode | null): void {
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

    drawNode(node: RBNode): void {
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
        ctx.fillText(`${node.value}`, x, y);
    }

    drawAllNodes(node: RBNode | null): void {
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

    render(root: RBNode | null): void {
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
export function mountRBT(): void {
    const input = document.getElementById(RBT_DOM.inputId);
    const errorEl = document.getElementById(RBT_DOM.errorId);
    const canvas = document.getElementById(RBT_DOM.canvasId);
    if (
        !input || !errorEl || !canvas ||
        !(input instanceof HTMLTextAreaElement) ||
        !(canvas instanceof HTMLCanvasElement)
    ) {
        console.warn(RBT_DOM_MISSING_MESSAGE);
        return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let drawer: TreeDrawer | null = null;

    const ensureDrawer = (): TreeDrawer => {
        if (!drawer || drawer.canvasWidth !== canvas.width || drawer.canvasHeight !== canvas.height) {
            drawer = new TreeDrawer(ctx, canvas.width, canvas.height);
        }
        return drawer;
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
            activeDrawer.render(null);
            return;
        }

        try {
            const rootNode = buildTreeFromExpression(expr);
            setError(RBT_EMPTY_TEXT);
            activeDrawer.render(rootNode);
        } catch (err) {
            const msg = (err as Error).message;
            setError(msg);
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
