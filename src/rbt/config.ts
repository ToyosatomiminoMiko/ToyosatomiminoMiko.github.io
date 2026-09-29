// ================================================================
// 红黑树工具(rbt/rbt.ts)常量配置
//
// 集中 rbt/rbt.ts 里所有"设计参数":布局几何,节点/连线配色,字体,
// 阴影与线宽,默认示例与 DOM 契约.
// ================================================================

// ---------- DOM 契约(id,public/css/index.css 按它命中) ----------

/**
 * 红黑树控件用到的 DOM 元素 id.
 * 标记由 src/rbt/ui/rbt_panel.ts 按本文件的声明生成(id 写入元素再由组件
 * 交回引用);这些常量同时给样式(public/css/index.css 的 `#treeInput` /
 * `#treeError` / `#rbCanvas`)与组件共用.
 */
export const RBT_DOM = {
    /** 表达式输入 textarea 的 id */
    inputId: 'treeInput',
    /** 错误提示容器的 id */
    errorId: 'treeError',
    /** 性质检查(诊断)清单的 id */
    diagnosticsId: 'treeProperties',
    /** 树绘制 canvas 的 id */
    canvasId: 'rbCanvas',
} as const;

// ---------- 面板标记契约(声明式模型,ui/rbt_panel.ts 用) ----------
//
// 结构 / 文案 / id 与 public/css/index.css 及测试的定位契约一致.框体
// (section.ui-panel + 标题栏 + 正文容器)由 miko_ui 的 `createPanel` 建,
// 类名归库;提示区排在正文容器最前(见 ui/rbt_panel.ts).

/** 面板标题(可见文本,全站不用 emoji) */
export const RBT_PANEL_TITLE = 'Red-Black Tree';

/** 提示区第一行:简写叶子节点说明(可见文本) */
export const RBT_HINT_SHORTHAND = '支持简写叶子节点 (例如 "5R" 等价于 "5R(nil,nil)")';

/**
 * 提示区第二行:配色图例(可见文本).
 * 颜色说明用汉字(红色 / 黒色)而不是彩色圆点:全站不用 emoji.
 * 分隔符两侧是 HTML 的 `&nbsp;`(Unicode 不换行空格 U+00A0),必须原样保留:
 * 这里直接写 `\u00a0` 而不是普通空格,免得不换行语义在纯文本里丢失.
 */
export const RBT_HINT_COLOR_LEGEND = 'R 红色 \u00a0|\u00a0 B 黒色';

/** 表达式输入框的占位文案(可见文本) */
export const RBT_INPUT_PLACEHOLDER =
    '例: 10B(5R(1B,8R),15R(12B,20B))  或深度4满树示例自动加载';

/** 表达式输入框的拼写检查属性值('false' = 不当自然语言检查) */
export const RBT_INPUT_SPELLCHECK = 'false';

/**
 * 树绘制 canvas 的逻辑分辨率.
 * 行为代码按 canvas.width / canvas.height 自适应,故改这两个值即可整体缩放.
 */
export const RBT_CANVAS_WIDTH = 1200;
export const RBT_CANVAS_HEIGHT = 640;

// ---------- 布局几何(单位:canvas 逻辑像素) ----------

/** 节点圆半径(像素) */
export const RBT_NODE_RADIUS = 22;

/** 相邻两层的垂直步长(像素) */
export const RBT_Y_STEP = 70;

/** 根节点所在的 y 坐标(像素,顶部留白) */
export const RBT_START_Y = 65;

/** 最小水平间距 = 半径 × 2.2(≈ 48px),避免节点圆重叠 */
export const RBT_MIN_HORIZONTAL_GAP = RBT_NODE_RADIUS * 2.2;

/** 画布左右安全边距 = 半径 + 16px */
export const RBT_SIDE_MARGIN = RBT_NODE_RADIUS + 16;

/** 单侧子树预留的最小宽度系数(× minHorizontalGap) */
export const RBT_MIN_CHILD_WIDTH_FACTOR = 0.8;

/** 单孩子节点偏向另一侧的收缩系数(× minHorizontalGap) */
export const RBT_SINGLE_CHILD_GAP_FACTOR = 0.6;

/** 位置钳制的容差(像素):允许节点略微越出安全边距 */
export const RBT_CLAMP_TOLERANCE = 5;

// ---------- 字体 ----------

/** 节点文字字体族(与画布外 CSS 的等宽字体栈保持一致的写法) */
export const RBT_NODE_FONT_FAMILY = '"Fira Code", "Monaco", monospace';

/** 节点文字最小字号(像素) */
export const RBT_NODE_FONT_MIN_SIZE = 13;

/** 节点文字字号相对半径的比例(× 半径,向下取整) */
export const RBT_NODE_FONT_RADIUS_FACTOR = 0.75;

/** 空树提示文字的字体(简写形式,字号 14px 等宽) */
export const RBT_EMPTY_HINT_FONT = '14px monospace';

/** 解析错误提示文字的字体(简写形式,字号 13px 等宽) */
export const RBT_ERROR_HINT_FONT = '13px monospace';

// ---------- 配色 ----------

/** 画布底色(白) */
export const RBT_CANVAS_BACKGROUND = '#ffffff';

/** 连线颜色(浅灰蓝) */
export const RBT_EDGE_COLOR = '#94a3b8';

/** 连线线宽(像素) */
export const RBT_EDGE_LINE_WIDTH = 2;

/** 节点投影颜色(极淡的黑色) */
export const RBT_NODE_SHADOW_COLOR = 'rgba(0,0,0,0.08)';

/** 节点投影模糊半径(像素) */
export const RBT_NODE_SHADOW_BLUR = 4;

/** 红色节点填充色 */
export const RBT_RED_NODE_FILL = '#ff0000';

/** 红色节点描边色(深橙) */
export const RBT_RED_NODE_STROKE = '#c2410c';

/** 红色节点描边线宽(像素) */
export const RBT_RED_NODE_LINE_WIDTH = 1.8;

/** 红色节点文字颜色(深棕) */
export const RBT_RED_NODE_TEXT = '#2d1a0e';

/** 黑色节点填充色 */
export const RBT_BLACK_NODE_FILL = '#000000';

/** 黑色节点描边色(深蓝黑) */
export const RBT_BLACK_NODE_STROKE = '#0f172a';

/** 黑色节点描边线宽(像素) */
export const RBT_BLACK_NODE_LINE_WIDTH = 1.6;

/** 黑色节点文字颜色(浅灰) */
export const RBT_BLACK_NODE_TEXT = '#f1f5f9';

/** 空树提示文字颜色(与连线同色) */
export const RBT_EMPTY_HINT_COLOR = RBT_EDGE_COLOR;

/** 解析错误提示文字颜色(玫红) */
export const RBT_ERROR_HINT_COLOR = '#e11d48';

// ---------- 性质检查(诊断清单) ----------
//
// 表达式先过**格式检查**(解析器,错了只出 #treeError),解析成功再过**性质检查**:
// 这棵树到底是不是一棵红黑树.清单排在输入框下面,每条一行,文案全部来自本区块.
//
// 性质有**先后**之分:前一条不通过时,后面的往往也在报同一处错(一棵根为红的树
// 通常还伴随红红相接),所以清单按下面这个顺序排,第一条不过就先看第一条.

/** 清单容器的类名 */
export const RBT_DIAGNOSTICS_CLASS = 'tree-properties';

/** 单条性质的类名(行为代码每渲染一次清单就整批重建这些节点) */
export const RBT_DIAGNOSTICS_ROW_CLASS = 'tree-property';

/** 单条性质里"结论"那一段的类名(状态色挂在它上面) */
export const RBT_DIAGNOSTICS_STATE_CLASS = 'tree-property-state';

/** 清单抬头那一段的类名(样式见 public/css/index.css 的 `#treeProperties`) */
export const RBT_DIAGNOSTICS_SUMMARY_CLASS = 'tree-property-summary';

/**
 * 清单抬头模板(可见文本).
 *
 * `{total}` 换成性质总条数,`{failed}` 换成不通过的条数 -- 两处都在代码里算,
 * 所以"加一条性质"或"改文案"都只动这一个地方,不会出现抬头写着 5 条,
 * 清单里其实 6 行这种对不上的情况.
 */
export const RBT_PROPERTY_SUMMARY = '红黑树性质检查: {total} 条中 {failed} 条未通过';

/** 单条性质通过时的结论文案(可见文本,不用符号 / 表情) */
export const RBT_PROPERTY_STATE_PASS = '通过';

/** 单条性质不通过时的结论文案(可见文本,不用符号 / 表情) */
export const RBT_PROPERTY_STATE_FAIL = '不通过';

// ---------- 性质检查:逐条的出错文案 ----------
//
// 这几条是**出错位置**的模板,由 rbt_tree.ts 填占位符后显示在清单里.
// 占位符有两种:`{node}` 换成"值+颜色"(如 `11R`),数字占位符换成算出来的数.

/** 根节点是红色 */
export const RBT_ROOT_RED_DETAIL = '根节点 {node} 是红色';

/** 红节点底下挂了红孩子 */
export const RBT_RED_CHILD_DETAIL = '红节点 {node} 的孩子是红色';

/**
 * 各路径黑高不一致.
 * `{expected}` 是较浅那侧的黑高,`{actual}` 是较深那侧(含多出来的那层).
 */
export const RBT_BLACK_HEIGHT_DETAIL =
    '节点 {node} 两侧黑高不同: 较浅一侧 {expected},较深一侧 {actual}';

/** 二叉搜索树有序性不成立 */
export const RBT_BST_ORDER_DETAIL = '以 {node} 为根的子树不满足左小右大';

/** 性质定义(清单顺序 = 检查顺序 = 界面顺序) */
export interface RbtPropertySpec {
    /** 稳定 id(测试与行为代码按它取某一条的结论) */
    readonly id: string;
    /** 界面上的性质名(可见文本) */
    readonly label: string;
    /**
     * 不通过时的出错位置模板(可见文本).
     *
     * 约定:`{node}` 换成出错节点的"值+颜色"(如 `11R`) -- 节点值只存在表达式里,
     * 不给位置读者对不上是哪个节点;其余占位符是该条性质自己的量(见上面各条).
     */
    readonly failDetail: string;
}

/**
 * 四条性质,顺序即检查顺序.
 *
 * 前三条是红黑树的定义(CLRS 那五条里会被表达式破坏的那些),第四条是"红黑树"
 * 这名字里的另一半:
 *
 * 1. 根是黑色;
 * 2. 红节点的孩子都是黑色(含"红节点直接接 nil" -- nil 是黑的,但那样这条路径
 *    上红节点底下没有黑节点,形状上已经不对);
 * 3. 任一节点到其后代 nil 叶子的所有路径上黑节点数相同(黑高一致);
 * 4. 二叉搜索树有序(左子树全部小于节点,右子树全部大于节点).
 *
 * 第 4 条不是红黑性质,是手打表达式最常见的错(层级对了而值乱序);单独列一条,
 * 文案写的是"二叉搜索树有序",不混进上面那三条.
 *
 * 少了 CLRS 里另外两条,原因不是"没实现"而是**结构上不可能违反**:
 * - "每个节点非红即黑":颜色写在表达式里,解析器只收 R / B;
 * - "nil 叶子是黑色":解析器不建 nil 节点(用 null 表示),颜色恒为黑;
 * - "每个节点要么两个子节点都不是 nil,要么都是":括号表达式必须写两个子树
 *   (`5B(1B,2B)`),单孩子写法 `5B(1B)` 在解析阶段就报"缺少逗号",到不了性质检查.
 * 列一条永远通过的条目只会让清单看着更长,所以不列;哪天支持了单孩子写法,
 * 再把那条加回来.
 */
export const RBT_PROPERTIES: readonly RbtPropertySpec[] = [
    {
        id: 'root-black',
        label: '根节点是黑色',
        failDetail: RBT_ROOT_RED_DETAIL,
    },
    {
        id: 'red-no-red-child',
        label: '红节点的孩子是黑色',
        failDetail: RBT_RED_CHILD_DETAIL,
    },
    {
        id: 'black-height',
        label: '各路径黑节点数相同',
        failDetail: RBT_BLACK_HEIGHT_DETAIL,
    },
    {
        id: 'bst-order',
        label: '二叉搜索树有序',
        failDetail: RBT_BST_ORDER_DETAIL,
    },
];

/**
 * 二叉搜索树有序性的比较容差.
 *
 * 只用来兜住浮点写法(如 `0.1 + 0.2` 那类值在字符串里看不出误差)与整数写法
 * 混用时的边界;相等值(左右子树出现和祖先同一个值)仍然判不通过,所以容差取
 * 极小值,不会把"值重复"放过.
 */
export const RBT_COMPARISON_TOLERANCE = 1e-9;

// ---------- 性质检查的绘制(画布左上角那一份,与清单同一份 report) ----------
//
// 画布是 canvas 2D,fillsStyle 只认色值,读不到 CSS 变量,所以下面这两个色值
// 与 public/css/tokens.css 的 --rbt-pass-color / --rbt-fail-color **必须同值**:
// 清单(canvas 外)走令牌,画布(canvas 内)走这里的常量,改色时两处一起改.

/** 性质全部通过时的绿色(与 tokens.css 的 --rbt-pass-color 同值) */
export const RBT_PROPERTY_PASS_COLOR = '#4ade80';

/** 性质不通过时的玫红(与 tokens.css 的 --rbt-fail-color 同值) */
export const RBT_PROPERTY_FAIL_COLOR = '#e11d48';

/** 画布上性质逐条的字体(与解析错误同为 13px 等宽) */
export const RBT_PROPERTY_ROW_FONT = '13px monospace';

/** 画布上性质逐条的行高(像素) */
export const RBT_PROPERTY_ROW_LINE_HEIGHT = 22;

// ---------- 文本对齐与占位 ----------

/** canvas 2D 文本的水平对齐方式 */
export const RBT_TEXT_ALIGN = 'center';

/** canvas 2D 文本的垂直基线 */
export const RBT_TEXT_BASELINE = 'middle';

/** 空树提示文案(可见文本,全站不用 emoji) */
export const RBT_EMPTY_HINT_TEXT =
    '请输入红黑树表达式 (例如: 13B(8R(1B,11R),17R(15B,25B)))';

/** 解析错误提示前缀(可见文本) */
export const RBT_ERROR_PREFIX = '解析错误: ';

/** 错误提示在 UI 上显示时的前缀(不用符号 / 表情,直接用字说明) */
export const RBT_ERROR_UI_PREFIX = '错误: ';

/**
 * 错误文案截断上限(字符数),防止长表达式把画布上的提示撑出界.
 */
export const RBT_ERROR_TEXT_MAX = 88;

/** 输入内容为空时清空错误提示的哨兵值 */
export const RBT_EMPTY_TEXT = '';

// ---------- 默认示例 ----------

/** 打开页面时自动加载的深度为 4 的满二叉树示例(挂载函数写进输入框) */
export const RBT_TREE_EXAMPLE =
    "15B(7R(3B(1R(0B,2B),5R(4B,6B)),11B(9R(8B,10B),13R(12B,14B))),23R(19B(17R(16B,18B),21R(20B,22B)),27B(25R(24B,26B),29R(28B,30B))))";

// ---------- 解析器使用的字符与哨兵 ----------

/** 表示空节点的字符串(小写) */
export const RBT_NIL = 'nil';

/** R/B 颜色标记字符(红) */
export const RBT_COLOR_RED = 'R';

/** R/B 颜色标记字符(黑) */
export const RBT_COLOR_BLACK = 'B';

/** 节点表达式里的左括号 */
export const RBT_LEFT_PAREN = '(';

/** 节点表达式里的右括号 */
export const RBT_RIGHT_PAREN = ')';

/** 左右子树的分隔逗号 */
export const RBT_COMMA = ',';

/** 简写叶子自动补全的后缀:值+颜色(nil,nil) */
export const RBT_LEAF_SUFFIX = '(nil,nil)';

/** 节点简写的最小长度(至少 1 位值 + 1 位颜色) */
export const RBT_MIN_SHORTHAND_LENGTH = 2;

// ---------- 可见文案(解析错误信息,与界面一字不差) ----------

/** 简写节点过短时的错误文案前缀 */
export const RBT_ERR_SHORTHAND_TOO_SHORT = '无效节点简写: "';

/** 简写节点过短时的错误文案后缀 */
export const RBT_ERR_SHORTHAND_TOO_SHORT_SUFFIX = '",需要例如 "5R" 或 "13B"';

/** 简写节点缺少 R/B 结尾时的错误文案前缀 */
export const RBT_ERR_SHORTHAND_NO_COLOR = '简写节点必须用 R/B 结尾,错误: "';

/** 节点格式错误时的错误文案前缀 */
export const RBT_ERR_NODE_FORMAT = '节点格式错误: 至少包含值和颜色(如 13B), 实际: ';

/** 颜色标记错误时的错误文案前缀 */
export const RBT_ERR_COLOR_MARK = '颜色标记必须是 R 或 B, 错误部分: ';

/** 括号不匹配时的错误文案前缀 */
export const RBT_ERR_UNBALANCED = '括号不匹配: ';

/** 缺少逗号时的错误文案前缀 */
export const RBT_ERR_NO_COMMA = '子树格式错误: 缺少逗号分隔左右子树, 内部: ';

/** 解析失败时的错误文案前缀 */
export const RBT_ERR_PARSE_FAILED = '解析失败: ';
