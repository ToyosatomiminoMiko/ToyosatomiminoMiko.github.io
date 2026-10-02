/*
红黑树的**表达式解析**与**性质检查**(纯逻辑,不碰 DOM 也不碰 canvas).

拆出来单独一份的原因:`rbt.ts` 里剩的是画布绘制与挂载(要 canvas / 要宿主),
而"这段表达式是不是一棵红黑树"只需一个字符串就能算完,能在 happy-dom 里直接测
(见 rbt_tree.test.ts) -- 混在一个要 `getContext('2d')` 的文件里就没法测.

数据形状:
- `RbtColor` / `RbtNode` 是这棵树的全部状态;节点是**可变对象**(布局期往
  `x` / `y` 上写坐标,见 rbt.ts 的 TreeDrawer),所以这里给的是 interface 而不是
  只读视图.
- `nil` 叶子**不建节点**:用 `null` 表示,颜色恒为黑(所以"nil 叶子是黑色"
  这条性质结构上不会违反,不列进清单,理由见 config 的 RBT_PROPERTIES).

性质检查的两条约定:
- 顺序 = config 里 RBT_PROPERTIES 的顺序,清单也按这个顺序渲染;每条对应的检查
  函数按 id 从 PROPERTY_CHECKS 里取(清单增删而这里没跟上会编译报错);
- `detail` 里的 `{node}` 占位符由这里填成"值+颜色"(如 `11R`),因为节点值只存在
  表达式里,只给"第几层"读者对不上是哪个节点.
*/

import {
    RBT_BLACK_HEIGHT_DETAIL,
    RBT_BST_ORDER_DETAIL,
    RBT_COLOR_BLACK,
    RBT_COLOR_RED,
    RBT_COMMA,
    RBT_COMPARISON_TOLERANCE,
    RBT_ERR_COLOR_MARK,
    RBT_ERR_NO_COMMA,
    RBT_ERR_NODE_FORMAT,
    RBT_ERR_PARSE_FAILED,
    RBT_ERR_SHORTHAND_NO_COLOR,
    RBT_ERR_SHORTHAND_TOO_SHORT,
    RBT_ERR_SHORTHAND_TOO_SHORT_SUFFIX,
    RBT_ERR_TRAILING,
    RBT_ERR_UNBALANCED,
    RBT_LEAF_SUFFIX,
    RBT_LEFT_PAREN,
    RBT_MIN_SHORTHAND_LENGTH,
    RBT_NIL,
    RBT_PROPERTIES,
    RBT_PROPERTY_SUMMARY,
    RBT_RED_CHILD_DETAIL,
    RBT_RIGHT_PAREN,
    RBT_ROOT_RED_DETAIL,
} from './config';

// ============================================================
// 树的形状
// ============================================================

/** 节点颜色:nil 叶子用 `null` 节点表示,颜色恒为黑,不占这个类型 */
type RbtColor = 'R' | 'B';

/** 一个节点(值按字符串存,颜色 R/B,左右子树为 null 表示 nil 叶子) */
export interface RbtNode {
    value: string;
    color: RbtColor;
    left: RbtNode | null;
    right: RbtNode | null;
    /** 布局期由 TreeDrawer 写入的画布坐标(解析与性质检查不读它) */
    x?: number;
    y?: number;
}

// ============================================================
// 解析:支持 "13B(8R(1B,11R),17R(15B,25B))" 与简写叶子 "5R" -> "5R(nil,nil)"
// ============================================================

function parseNode(str: string): RbtNode | null {
    const s = str.trim();
    // nil / 空 直接返回 null(不建节点,对应的就是黑叶子)
    if (s === '' || s === RBT_NIL || s === 'Nil' || s === 'NIL') {
        return null;
    }

    // 简写叶子节点:不带括号 => 自动包装成 值颜色(nil,nil)
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
    // 括号配平还不够:整串必须**只有**这一个表达式.不比对长度的话,
    // `5B(1B,2B)junk` / `5B(1B,2B))` 都会被当成合法的 5B 树 -- 多余的输入
    // 落在配对右括号之后,会被静默丢掉(不报错,但用户写的东西没被检查).
    if (rightParenIdx !== s.length) {
        throw new Error(`${RBT_ERR_TRAILING}${s.substring(rightParenIdx)}`);
    }
    const inside = s.substring(leftParenIdx + 1, rightParenIdx - 1);
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
    const leftStr = inside.substring(0, commaIdx);
    const rightStr = inside.substring(commaIdx + 1);

    const leftChild = parseNode(leftStr);
    const rightChild = parseNode(rightStr);
    return { value: valueStr, color: colorChar as RbtColor, left: leftChild, right: rightChild };
}

/**
 * 把表达式解析成一棵树;空表达式给 `null`(空树).
 *
 * 失败一律抛 Error:文案是 config 里那几条 RBT_ERR_*,由调用方(挂载函数)显示在
 * #treeError 这块 HTML 里 -- 画布只画树,不写任何文案(见 rbt.ts 的分工说明).
 *
 * 原始错误对象挂在新错误的 `cause` 上(而不是像原来那样先 `console.error(e)`):
 * 解析失败是**预期内的用户输入错误**,不是异常状况 -- 每敲错一个字符就往控制台
 * 打一条红字,正常使用会被刷屏;跑测试时更糟:故意喂错表达式的用例会往 stderr
 * 打字,看日志的人会以为测试挂了(运行时这条路径会真实发生,不是只在测试里).
 * 需要看原始栈时走 `error.cause` 即可,信息一点没少.
 *
 * `cause` 是手动挂的,不是 `new Error(msg, { cause })`:tsconfig 是 ES2020
 * (ErrorOptions 是 ES2022 才进 lib),用构造函数那个重载编译不过.
 */
export function buildTreeFromExpression(expr: string): RbtNode | null {
    if (!expr || expr.trim() === '') {
        return null;
    }
    try {
        return parseNode(expr);
    } catch (e) {
        const error = new Error(`${RBT_ERR_PARSE_FAILED}${(e as Error).message}`);
        (error as Error & { cause?: unknown }).cause = e;
        throw error;
    }
}

// ============================================================
// 性质检查:四条,对应 config.RBT_PROPERTIES 的四个 id
// ============================================================

/** 单条性质的结论 */
interface RbtPropertyResult {
    /** 对应 RbtPropertySpec.id */
    readonly id: string;
    /** 是否 PASS */
    readonly pass: boolean;
    /** FAIL 时的出错位置(已填好占位符);PASS 时是空串 */
    readonly detail: string;
}

/** 一次性质检查的完整结论 */
export interface RbtPropertyReport {
    /** 逐条结论,顺序与 RBT_PROPERTIES 一致 */
    readonly results: readonly RbtPropertyResult[];
    /** FAIL 的条数 */
    readonly failedCount: number;
    /** 总条数(= RBT_PROPERTIES.length) */
    readonly total: number;
}

/** 节点在提示里的写法:值 + 颜色(如 `11R`) */
function describeNode(node: RbtNode): string {
    return `${node.value}${node.color}`;
}

/**
 * 取节点值参与比较时用的数.
 *
 * 用手写解析而不是 `Number()`:`Number` 会把 `''` 当 0,把 `0x10` 当 16,把
 * `1e3` 当 1000,这些"看着是数字其实不是"的写法在这里只会让人对不上号.
 * 认不出来就返回 null,由调用方跳过比较(见 checkBstOrder).
 */
function toComparable(value: string): number | null {
    return /^[+-]?\d+(\.\d+)?$/.test(value) ? Number(value) : null;
}

/** 第 1 条:根节点必须是黑色 */
function checkRootIsBlack(root: RbtNode): string | null {
    return root.color === RBT_COLOR_RED ? RBT_ROOT_RED_DETAIL.replace('{node}', describeNode(root)) : null;
}

/** 第 2 条:红节点的孩子都是黑色(红节点接 nil 也算:那条路径上没有黑节点兜底) */
function checkRedChildrenAreBlack(root: RbtNode): string | null {
    return scanNodes(root, (node) => {
        if (node.color !== RBT_COLOR_RED) return null;
        const leftIsRed = node.left !== null && node.left.color === RBT_COLOR_RED;
        const rightIsRed = node.right !== null && node.right.color === RBT_COLOR_RED;
        return leftIsRed || rightIsRed ? RBT_RED_CHILD_DETAIL.replace('{node}', describeNode(node)) : null;
    });
}

/**
 * 第 3 条:任一节点到它所有后代 nil 叶子的路径上黑节点数相同.
 *
 * 递归返回值是"这棵子树的黑高"(含自身,除非自身是红);两棵子树黑高不同就报错.
 * 黑高不一致至少发生在两个节点上,这里报**较深的那一侧**的节点:它是多出来的
 * 那个黑节点所在的位置,顺着它往下能最快看到"多出来的一层".
 */
function checkBlackHeight(node: RbtNode): number | string {
    const leftHeight = node.left === null ? 1 : checkBlackHeight(node.left);
    if (typeof leftHeight === 'string') return leftHeight;
    const rightHeight = node.right === null ? 1 : checkBlackHeight(node.right);
    if (typeof rightHeight === 'string') return rightHeight;
    if (leftHeight !== rightHeight) {
        const expected = Math.min(leftHeight, rightHeight);
        const actual = Math.max(leftHeight, rightHeight);
        return RBT_BLACK_HEIGHT_DETAIL
            .replace('{node}', describeNode(node))
            .replace('{expected}', String(expected))
            .replace('{actual}', String(actual));
    }
    return leftHeight + (node.color === RBT_COLOR_BLACK ? 1 : 0);
}

/**
 * 第 4 条:二叉搜索树有序(左子树全部小于节点,右子树全部大于节点).
 *
 * 用区间递归而不是"每层只比父子":只比父子会漏掉"孙子比爷爷大"这种错
 * (父节点在两者之间时,父子关系全对而整棵树仍然不是搜索树).
 *
 * 比较用**数值**而不是字符串:值在网页上是十进制写法(`007` 与 `7` 是同一个数,
 * 而字符串比较会把它们当成两个),所以先经 toComparable 换成数;换成数与否
 * 只看这个值自己,与祖先能不能换无关(不能换的值既不检查它,也不收窄区间).
 *
 * 区间是**开区间**:等于祖先的值也算乱序(左子树出现和爷爷同一个数,查找时这个值
 * 落在哪一边是不确定的).容差只用来兜浮点写法,取极小值,不会把相等的值放过.
 */
function checkBstOrder(root: RbtNode): string | null {
    const inRange = (node: RbtNode | null, low: number | null, high: number | null): boolean => {
        if (node === null) return true;
        const value = toComparable(node.value);
        if (value !== null) {
            // 两个边界都是**闭合排除**的:小于等于下界,大于等于上界都不算有序.
            // (`<=` / `>=` 而不是 `<` / `>`:相等值必须算违规,见上面那段注释)
            if (low !== null && value <= low + RBT_COMPARISON_TOLERANCE) return false;
            if (high !== null && value >= high - RBT_COMPARISON_TOLERANCE) return false;
            return inRange(node.left, low, value) && inRange(node.right, value, high);
        }
        // 值不是十进制数:这一层无从判定,区间原样往下传,不误报也不放过子树的比较
        return inRange(node.left, low, high) && inRange(node.right, low, high);
    };
    return inRange(root, null, null) ? null : RBT_BST_ORDER_DETAIL.replace('{node}', describeNode(root));
}

/** 深度优先遍历,第一个让 `find` 返回非 null 的节点就把它交回去(先根,再左,再右) */
function scanNodes(node: RbtNode, find: (node: RbtNode) => string | null): string | null {
    const own = find(node);
    if (own !== null) return own;
    if (node.left !== null) {
        const left = scanNodes(node.left, find);
        if (left !== null) return left;
    }
    if (node.right !== null) {
        const right = scanNodes(node.right, find);
        if (right !== null) return right;
    }
    return null;
}

/** RBT_PROPERTIES 的 id 联合('root-black' | 'red-no-red-child' | 'black-height' | 'bst-order') */
type RbtPropertyId = (typeof RBT_PROPERTIES)[number]['id'];

/**
 * 性质 id -> 检查函数.
 *
 * 用 `Record<RbtPropertyId, ...>` 而不是"按下标取第 i 个检查":`RBT_PROPERTIES`
 * 增删一条而这里没跟上会**编译报错**(缺键 / 多键),而不是等到某个输入触发
 * `undefined` 调用(checkBlackHeight 那条还要包一层,因为它返回的是黑高数字).
 * 检查与渲染的顺序仍由 `RBT_PROPERTIES` 的顺序决定,所以"清单顺序 = 检查顺序".
 */
const PROPERTY_CHECKS: Readonly<Record<RbtPropertyId, (node: RbtNode) => string | null>> = {
    'root-black': checkRootIsBlack,
    'red-no-red-child': checkRedChildrenAreBlack,
    'black-height': (node) => {
        const height = checkBlackHeight(node);
        return typeof height === 'string' ? height : null;
    },
    'bst-order': checkBstOrder,
};

/**
 * 跑完四条性质,交回逐条结论.
 *
 * 四条**都跑**(不做"前一条不过就短路"):清单要一次把问题列全,只报第一条的话
 * 读者修完一次还要再看一次.每条各自在自己的子树里找第一处错,所以同一处错
 * 可能同时落在两条性质上(如根为红 + 红红相接),这是有意的:两条性质确实都被它
 * 破坏了.空树走另一条路:四条在空树上都是空真(见 checkTreeProperties 的 root === null).
 */
export function checkTreeProperties(root: RbtNode | null): RbtPropertyReport {
    const results: RbtPropertyResult[] = RBT_PROPERTIES.map((spec) => {
        const detail = root === null ? null : PROPERTY_CHECKS[spec.id](root);
        return { id: spec.id, pass: detail === null, detail: detail ?? '' };
    });

    return {
        results,
        failedCount: results.filter((result) => !result.pass).length,
        total: results.length,
    };
}

/** 按 id 取一条结论(找不到时抛错:清单与 RBT_PROPERTIES 对不上是硬错误) */
export function findPropertyResult(
    report: RbtPropertyReport,
    id: string,
): RbtPropertyResult {
    const found = report.results.find((result) => result.id === id);
    if (!found) throw new Error(`性质检查里没有 ${id} 这条结论`);
    return found;
}

/** 清单抬头文案(把 RBT_PROPERTY_SUMMARY 里的两个占位符换成数字) */
export function formatPropertySummary(report: RbtPropertyReport): string {
    return RBT_PROPERTY_SUMMARY
        .replace('{total}', String(report.total))
        .replace('{failed}', String(report.failedCount));
}
