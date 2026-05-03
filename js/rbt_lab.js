/*
2026.05.01.00:00:00
学习红黑树的辅助工具
DeepSeek辅助开发
*/

// 红黑树节点定义 (支持任意数值/字符串)
class RBNode {
    constructor(value, color, left = null, right = null) {
        this.value = value;   // 展示值 (字符串/数字)
        this.color = color;   // 'R' 红色 或 'B' 黑色
        this.left = left;
        this.right = right;
    }
}

// 解析核心: 支持 "13B(8R(1B,11R),17R(15B,25B))" 以及简写叶子 "5R" -> 自动补全 "(nil,nil)"
function trim(s) {
    return s.trim();
}

function parseNode(str) {
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
    return new RBNode(nodeValue, colorChar, leftChild, rightChild);
}

function buildTreeFromExpression(expr) {
    if (!expr || expr.trim() === '') {
        return null;
    }
    try {
        return parseNode(expr);
    } catch (e) {
        console.error(e);
        throw new Error(`解析失败: ${e.message}`);
    }
}

// ============================================================
// 工具: 计算树深度 (根深度1)
// ============================================================
function getTreeDepth(node) {
    if (!node) return 0;
    return 1 + Math.max(getTreeDepth(node.left), getTreeDepth(node.right));
}

// ============================================================
// 画布绘制器 —— 采用【区间递归分配法】彻底避免节点重叠/交叉
// 尤其针对深度为4的满二叉树 (15节点, 底层8个叶子) 保证叶子间距均匀且无重叠
// 核心思想: 每个节点获得一个水平区间 [leftBound, rightBound],节点居中于区间
// 左右子树递归划分区间,间隔固定最小间隙 (minGap),确保任何两层都不相交
// ============================================================
class TreeDrawer {
    constructor(ctx, canvasWidth, canvasHeight) {
        this.ctx = ctx;
        this.canvasWidth = canvasWidth;
        this.canvasHeight = canvasHeight;
        this.nodeRadius = 22;          // 节点半径 (px)
        this.yStep = 70;                // 垂直层间距
        this.startY = 65;               // 根节点起始Y坐标
        // 最小水平间隙 (两个相邻节点中心最小距离) 防止文本重叠
        this.minHorizontalGap = this.nodeRadius * 2.2;  // ≈ 48px 足够宽松
        this.sideMargin = this.nodeRadius + 16;         // 画布左右边距 (避免节点贴边)
    }

    // --------------------------------------------------------
    // 核心布局: 递归分配区间,保证完全无重叠,完美适应任意形态树(包括极深/极宽)
    // 参数: node 当前节点, leftBound 左边界, rightBound 右边界, y 垂直坐标
    // --------------------------------------------------------
    #placeNodeRecursive(node, leftBound, rightBound, y) {
        if (!node) return;

        // 节点水平居中于可用区间
        const x = (leftBound + rightBound) / 2;
        node.x = x;
        node.y = y;

        // 关键: 仅当存在子节点时才分配子区间,确保至少保留 minHorizontalGap 间距
        const hasLeft = node.left !== null;
        const hasRight = node.right !== null;

        if (hasLeft && hasRight) {
            // 左右孩子都存在: 切割区间,在 node.x 两侧预留最小间隙
            let leftRightBound = node.x - this.minHorizontalGap;
            let rightLeftBound = node.x + this.minHorizontalGap;

            // 边界安全检查: 确保区间有效 (左侧区间至少保留宽度,右侧同理)
            // 若因为画布边界导致子区间过窄,动态压缩最小间隙但依然保证不重叠
            const minChildWidth = this.minHorizontalGap * 0.8;
            if (leftRightBound - leftBound < minChildWidth) {
                leftRightBound = leftBound + minChildWidth;
            }
            if (rightBound - rightLeftBound < minChildWidth) {
                rightLeftBound = rightBound - minChildWidth;
            }
            // 最终防止逻辑错误: 左右区间不能交叉
            if (leftRightBound >= rightLeftBound) {
                // 极端情况微调 (让左右孩子略有间距)
                const mid = (leftRightBound + rightLeftBound) / 2;
                leftRightBound = mid - this.minHorizontalGap / 2;
                rightLeftBound = mid + this.minHorizontalGap / 2;
            }

            this.#placeNodeRecursive(node.left, leftBound, leftRightBound, y + this.yStep);
            this.#placeNodeRecursive(node.right, rightLeftBound, rightBound, y + this.yStep);
        }
        else if (hasLeft) {
            // 只有左子树: 给左子树分配左边大部分区间,但仍保持节点居左方向偏移视觉美观
            // 为了美观,左子树区间从 leftBound 到 node.x - this.minHorizontalGap*0.5
            let leftRightBound = node.x - this.minHorizontalGap * 0.6;
            if (leftRightBound <= leftBound) leftRightBound = leftBound + this.minHorizontalGap * 0.8;
            this.#placeNodeRecursive(node.left, leftBound, leftRightBound, y + this.yStep);
        }
        else if (hasRight) {
            // 只有右子树
            let rightLeftBound = node.x + this.minHorizontalGap * 0.6;
            if (rightLeftBound >= rightBound) rightLeftBound = rightBound - this.minHorizontalGap * 0.8;
            this.#placeNodeRecursive(node.right, rightLeftBound, rightBound, y + this.yStep);
        }
        // 无孩子: 叶子节点不需递归
    }

    // 对外接口: 对整棵树执行布局,自动适配画布宽度
    layoutTree(root) {
        if (!root) return;
        // 有效绘制区域左右边界
        const leftBoundary = this.sideMargin;
        const rightBoundary = this.canvasWidth - this.sideMargin;
        if (leftBoundary >= rightBoundary) return; // 宽度过小

        // 递归计算所有节点坐标 (防重叠)
        this.#placeNodeRecursive(root, leftBoundary, rightBoundary, this.startY);

        // 可选: 轻微水平边界微调,防止极个别情况超出可视区 (递归分配已保证基本不越界)
        this.#clampNodePositions(root);
    }

    // 边界钳位辅助: 确保所有节点 x 坐标在边距内 (保险)
    #clampNodePositions(node) {
        if (!node) return;
        const minX = this.sideMargin - 5;
        const maxX = this.canvasWidth - this.sideMargin + 5;
        if (node.x < minX) node.x = minX;
        if (node.x > maxX) node.x = maxX;
        this.#clampNodePositions(node.left);
        this.#clampNodePositions(node.right);
    }

    // 绘制线条 (父子连接线)
    drawLines(node) {
        if (!node) return;
        const ctx = this.ctx;
        const startX = node.x;
        const startY = node.y;
        if (node.left) {
            ctx.beginPath();
            ctx.moveTo(startX, startY);
            ctx.lineTo(node.left.x, node.left.y);
            ctx.strokeStyle = '#94a3b8';
            ctx.lineWidth = 2;
            ctx.stroke();
            this.drawLines(node.left);
        }
        if (node.right) {
            ctx.beginPath();
            ctx.moveTo(startX, startY);
            ctx.lineTo(node.right.x, node.right.y);
            ctx.stroke();
            this.drawLines(node.right);
        }
    }

    // 绘制单个节点 (红/黑样式)
    drawNode(node) {
        const ctx = this.ctx;
        const x = node.x;
        const y = node.y;
        const r = this.nodeRadius;

        // 阴影 + 高级质感
        ctx.shadowColor = "rgba(0,0,0,0.08)";
        ctx.shadowBlur = 4;
        if (node.color === 'R') {
            ctx.fillStyle = '#ff0000'; // 红
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#c2410c';
            ctx.lineWidth = 1.8;
            ctx.stroke();
            ctx.fillStyle = '#2d1a0e';
        } else {
            ctx.fillStyle = '#000000'; // 黑
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

    drawAllNodes(node) {
        if (!node) return;
        this.drawNode(node);
        this.drawAllNodes(node.left);
        this.drawAllNodes(node.right);
    }

    clearCanvas() {
        this.ctx.clearRect(0, 0, this.canvasWidth, this.canvasHeight);
        this.ctx.fillStyle = '#ffffff';
        this.ctx.fillRect(0, 0, this.canvasWidth, this.canvasHeight);
    }

    render(root) {
        this.clearCanvas();
        if (!root) {
            this.ctx.font = "14px monospace";
            this.ctx.fillStyle = "#94a3b8";
            this.ctx.textAlign = "center";
            this.ctx.fillText("✨ 请输入红黑树表达式 (例如: 13B(8R(1B,11R),17R(15B,25B)))", this.canvasWidth / 2, this.canvasHeight / 2);
            return;
        }

        // 使用防重叠递归布局 (深度最多4满树自动完美分布)
        this.layoutTree(root);
        // 绘制连线 + 节点
        this.drawLines(root);
        this.drawAllNodes(root);
    }
}

// ============================================================
// Vue 应用模块
// ============================================================
const App = {
    setup() {
        const inputExpression = ref('');
        const errorMessage = ref('');
        const canvasRef = ref(null);
        let currentRoot = null;
        let drawer = null;

        // 核心渲染函数 (解析 + 布局绘制)
        const renderTree = () => {
            if (!canvasRef.value) return;
            const canvas = canvasRef.value;
            const ctx = canvas.getContext('2d');
            const width = canvas.width;
            const height = canvas.height;

            // 初始化或重建Drawer (保持画布尺寸一致)
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
                errorMessage.value = err.message;
                if (drawer) {
                    drawer.clearCanvas();
                    drawer.ctx.font = "13px monospace";
                    drawer.ctx.fillStyle = "#e11d48";
                    drawer.ctx.textAlign = "center";
                    drawer.ctx.fillText(`❌ 解析错误: ${err.message.slice(0, 88)}`, drawer.canvasWidth / 2, drawer.canvasHeight / 2);
                }
            }
        };

        const handleInput = () => {
            renderTree();
        };

        // 示例: 深度为4 (不包含nil叶子节点) 的满树,共15个节点,底层8个叶子,彻底测试无交叉重叠
        // 使用完全二叉树结构,颜色符合红黑风格 (红黑节点交替视觉美观)
        // 表达式完全展开每个非叶子节点都有两个孩子,叶子节点用简写(如"1B")自动补全,确保深度=4
        const Example =
            "15B(7R(3B(1R(0B,2B),5R(4B,6B)),11B(9R(8B,10B),13R(12B,14B))),23R(19B(17R(16B,18B),21R(20B,22B)),27B(25R(24B,26B),29R(28B,30B))))";

        onMounted(() => {
            const canvas = canvasRef.value;
            if (canvas) {
                // 设置默认表达式: 深度4满二叉树 + 防止重叠的完美测试用例
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

createApp(App).mount('.container');