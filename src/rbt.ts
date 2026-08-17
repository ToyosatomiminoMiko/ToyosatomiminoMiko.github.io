/*
2026.05.01.00:00:00
红黑树工具
*/
import { createApp, ref, onMounted } from 'vue';

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
    if (s === '' || s === 'nil' || s === 'Nil' || s === 'NIL') {
        return null;
    }

    // 简写叶子节点: 不带括号 => 自动包装成 值颜色(nil,nil)
    if (!s.includes('(')) {
        if (s.length < 2) {
            throw new Error(`无效节点简写: "${s}",需要例如 "5R" 或 "13B"`);
        }
        const lastChar = s[s.length - 1];
        if (lastChar !== 'R' && lastChar !== 'B') {
            throw new Error(`简写节点必须用 R/B 结尾,错误: "${s}"`);
        }
        const fullExpr = `${s}(nil,nil)`;
        return parseNode(fullExpr);
    }

    // 标准带括号解析
    const leftParenIdx = s.indexOf('(');
    const valueColorPart = s.substring(0, leftParenIdx);
    if (valueColorPart.length < 2) {
        throw new Error(`节点格式错误: 至少包含值和颜色(如 13B), 实际: ${valueColorPart}`);
    }
    const colorChar = valueColorPart[valueColorPart.length - 1];
    if (colorChar !== 'R' && colorChar !== 'B') {
        throw new Error(`颜色标记必须是 R 或 B, 错误部分: ${valueColorPart}`);
    }
    const valueStr = valueColorPart.substring(0, valueColorPart.length - 1);
    const nodeValue = valueStr;

    // 匹配括号内左右子树
    let balance = 1;
    let rightParenIdx = leftParenIdx + 1;
    while (rightParenIdx < s.length && balance > 0) {
        if (s[rightParenIdx] === '(') balance++;
        else if (s[rightParenIdx] === ')') balance--;
        rightParenIdx++;
    }
    if (balance !== 0) {
        throw new Error(`括号不匹配: ${s}`);
    }
    const inside = s.substring(leftParenIdx + 1, rightParenIdx - 1);
    let leftStr = '', rightStr = '';
    let commaIdx = -1;
    let depth = 0;
    for (let i = 0; i < inside.length; i++) {
        const ch = inside[i];
        if (ch === '(') depth++;
        else if (ch === ')') depth--;
        else if (ch === ',' && depth === 0) {
            commaIdx = i;
            break;
        }
    }
    if (commaIdx === -1) {
        throw new Error(`子树格式错误: 缺少逗号分隔左右子树, 内部: ${inside}`);
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
        throw new Error(`解析失败: ${(e as Error).message}`);
    }
}

// ============================================================
// 工具: 计算树深度 (根深度1)
// ============================================================
function getTreeDepth(node: RBNode | null): number {
    if (!node) return 0;
    return 1 + Math.max(getTreeDepth(node.left), getTreeDepth(node.right));
}

// ============================================================
// 画布绘制器 —— 采用【区间递归分配法】彻底避免节点重叠/交叉
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
        this.nodeRadius = 22;
        this.yStep = 70;
        this.startY = 65;
        this.minHorizontalGap = this.nodeRadius * 2.2;  // ≈ 48px
        this.sideMargin = this.nodeRadius + 16;
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

            const minChildWidth = this.minHorizontalGap * 0.8;
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
            let leftRightBound = node.x - this.minHorizontalGap * 0.6;
            if (leftRightBound <= leftBound) leftRightBound = leftBound + this.minHorizontalGap * 0.8;
            this.placeNodeRecursive(node.left!, leftBound, leftRightBound, y + this.yStep);
        }
        else if (hasRight) {
            let rightLeftBound = node.x + this.minHorizontalGap * 0.6;
            if (rightLeftBound >= rightBound) rightLeftBound = rightBound - this.minHorizontalGap * 0.8;
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
        const minX = this.sideMargin - 5;
        const maxX = this.canvasWidth - this.sideMargin + 5;
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
            ctx.strokeStyle = '#94a3b8';
            ctx.lineWidth = 2;
            ctx.stroke();
            this.drawLines(node.left);
        }
        if (node.right) {
            ctx.beginPath();
            ctx.moveTo(startX, startY);
            ctx.lineTo(node.right.x!, node.right.y!);
            ctx.strokeStyle = '#94a3b8';
            ctx.lineWidth = 2;
            ctx.stroke();
            this.drawLines(node.right);
        }
    }

    drawNode(node: RBNode): void {
        const ctx = this.ctx;
        const x = node.x!;
        const y = node.y!;
        const r = this.nodeRadius;

        ctx.shadowColor = "rgba(0,0,0,0.08)";
        ctx.shadowBlur = 4;
        if (node.color === 'R') {
            ctx.fillStyle = '#ff0000';
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#c2410c';
            ctx.lineWidth = 1.8;
            ctx.stroke();
            ctx.fillStyle = '#2d1a0e';
        } else {
            ctx.fillStyle = '#000000';
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#0f172a';
            ctx.lineWidth = 1.6;
            ctx.stroke();
            ctx.fillStyle = '#f1f5f9';
        }
        ctx.shadowBlur = 0;
        ctx.font = `bold ${Math.max(13, Math.floor(r * 0.75))}px "Fira Code", "Monaco", monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
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
        this.ctx.fillStyle = '#ffffff';
        this.ctx.fillRect(0, 0, this.canvasWidth, this.canvasHeight);
    }

    render(root: RBNode | null): void {
        this.clearCanvas();
        if (!root) {
            this.ctx.font = "14px monospace";
            this.ctx.fillStyle = "#94a3b8";
            this.ctx.textAlign = "center";
            this.ctx.fillText("✨ 请输入红黑树表达式 (例如: 13B(8R(1B,11R),17R(15B,25B)))", this.canvasWidth / 2, this.canvasHeight / 2);
            return;
        }

        this.layoutTree(root);
        this.drawLines(root);
        this.drawAllNodes(root);
    }
}

// ============================================================
// Vue 应用模块
// ============================================================
export function mountRBT(): void {
    const App = {
        setup() {
            const inputExpression = ref<string>('');
            const errorMessage = ref<string>('');
            const canvasRef = ref<HTMLCanvasElement | null>(null);
            let currentRoot: RBNode | null = null;
            let drawer: TreeDrawer | null = null;

            const renderTree = (): void => {
                if (!canvasRef.value) return;
                const canvas = canvasRef.value;
                const ctx = canvas.getContext('2d');
                if (!ctx) return;
                const width = canvas.width;
                const height = canvas.height;

                if (!drawer || drawer.canvasWidth !== width || drawer.canvasHeight !== height) {
                    drawer = new TreeDrawer(ctx, width, height);
                } else {
                    drawer.ctx = ctx;
                    drawer.canvasWidth = width;
                    drawer.canvasHeight = height;
                }

                const expr = inputExpression.value.trim();
                if (expr === '') {
                    errorMessage.value = '';
                    currentRoot = null;
                    drawer.render(null);
                    return;
                }

                try {
                    const rootNode = buildTreeFromExpression(expr);
                    currentRoot = rootNode;
                    errorMessage.value = '';
                    drawer.render(currentRoot);
                } catch (err) {
                    const msg = (err as Error).message;
                    errorMessage.value = msg;
                    if (drawer) {
                        drawer.clearCanvas();
                        drawer.ctx.font = "13px monospace";
                        drawer.ctx.fillStyle = "#e11d48";
                        drawer.ctx.textAlign = "center";
                        drawer.ctx.fillText(`❌ 解析错误: ${msg.slice(0, 88)}`, drawer.canvasWidth / 2, drawer.canvasHeight / 2);
                    }
                }
            };

            const handleInput = (): void => {
                renderTree();
            };

            // 深度为4的满二叉树示例
            const Example =
                "15B(7R(3B(1R(0B,2B),5R(4B,6B)),11B(9R(8B,10B),13R(12B,14B))),23R(19B(17R(16B,18B),21R(20B,22B)),27B(25R(24B,26B),29R(28B,30B))))";

            onMounted(() => {
                const canvas = canvasRef.value;
                if (canvas) {
                    inputExpression.value = Example;
                    renderTree();
                }
            });

            return {
                inputExpression,
                errorMessage,
                canvasRef,
                handleInput,
            };
        },
        template: `
<div>
    <textarea 
        id="treeInput" 
        v-model="inputExpression" 
        @input="handleInput"
        spellcheck="false"
        placeholder="例: 10B(5R(1B,8R),15R(12B,20B))  或深度4满树示例自动加载"
    />
    <div v-if="errorMessage" class="error-msg">⚠️ {{ errorMessage }}</div>
    <canvas ref="canvasRef" id="rbCanvas" width="1200" height="640"></canvas>
</div>`
    };

    const app = createApp(App);
    app.mount('#rbt-container');
}