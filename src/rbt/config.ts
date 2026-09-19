// ================================================================
// 红黑树工具(rbt/rbt.ts)常量配置
//
// 集中 rbt/rbt.ts 里所有"设计参数":布局几何,节点/连线配色,字体,
// 阴影与线宽,默认示例与 DOM 契约.数值与拆分前的字面量逐位一致,
// 不改变绘制结果与解析行为.
// ================================================================

// ---------- DOM 契约(id,与旧 index.html 的 #rbt 窗格完全一致) ----------

/**
 * 红黑树控件用到的 DOM 元素 id.
 * 标记现在由 src/rbt/ui/rbt_panel.ts 按本文件的声明生成(id 写入元素再由组件
 * 交回引用),不再是"HTML 与 TS 各写一份"的约定;保留这些常量给样式
 * (public/css/index.css 的 `#treeInput` / `#treeError` / `#rbCanvas`)与组件共用.
 */
export const RBT_DOM = {
    /** 表达式输入 textarea 的 id */
    inputId: 'treeInput',
    /** 错误提示容器的 id */
    errorId: 'treeError',
    /** 树绘制 canvas 的 id */
    canvasId: 'rbCanvas',
} as const;

// ---------- 面板标记契约(声明式模型,逐字照搬旧 #rbt 窗格) ----------

/** 面板根元素的类名(旧标记 `<div class="card">`) */
export const RBT_PANEL_ROOT_CLASS = 'card';

/** 面板头部容器的类名(旧标记 `<div class="card-header">`) */
export const RBT_PANEL_HEADER_CLASS = 'card-header';

/** 面板主体容器的类名(旧标记 `<div class="card-body">`) */
export const RBT_PANEL_BODY_CLASS = 'card-body';

/** 面板标题(可见文本,保持原样) */
export const RBT_PANEL_TITLE = '🌳 Red-Black Tree';

/** 提示区第一行:简写叶子节点说明(可见文本,保持原样) */
export const RBT_HINT_SHORTHAND = '💡 支持简写叶子节点 (例如 "5R" 等价于 "5R(nil,nil)")';

/**
 * 提示区第二行:配色图例(可见文本,保持原样).
 * 分隔符两侧是 HTML 的 `&nbsp;`(Unicode 不换行空格 U+00A0),必须原样保留:
 * 这里直接写 `\u00a0` 而不是普通空格,免得不换行语义在纯文本里丢失.
 */
export const RBT_HINT_COLOR_LEGEND = '🔴 R 红色 \u00a0|\u00a0 ⚫ B 黒色';

/** 表达式输入框的占位文案(可见文本,保持原样) */
export const RBT_INPUT_PLACEHOLDER =
    '例: 10B(5R(1B,8R),15R(12B,20B))  或深度4满树示例自动加载';

/** 表达式输入框的拼写检查属性值(旧标记 spellcheck="false") */
export const RBT_INPUT_SPELLCHECK = 'false';

/**
 * 树绘制 canvas 的逻辑分辨率(旧标记 width="1200" height="640").
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

/** 空树提示文字颜色(浅灰蓝,与连线同色) */
export const RBT_EMPTY_HINT_COLOR = '#94a3b8';

/** 解析错误提示文字颜色(玫红) */
export const RBT_ERROR_HINT_COLOR = '#e11d48';

// ---------- 文本对齐与占位 ----------

/** canvas 2D 文本的水平对齐方式 */
export const RBT_TEXT_ALIGN = 'center';

/** canvas 2D 文本的垂直基线 */
export const RBT_TEXT_BASELINE = 'middle';

/** 空树提示文案(可见文本,保持原样) */
export const RBT_EMPTY_HINT_TEXT =
    '✨ 请输入红黑树表达式 (例如: 13B(8R(1B,11R),17R(15B,25B)))';

/** 解析错误提示前缀(可见文本,保持原样) */
export const RBT_ERROR_PREFIX = '❌ 解析错误: ';

/** 错误提示在 UI 上显示时的前缀表情 */
export const RBT_ERROR_UI_PREFIX = '⚠️ ';

/**
 * 错误文案截断上限(字符数).
 * 原实现即 88,保留为具名常量以便日后调整.
 */
export const RBT_ERROR_TEXT_MAX = 88;

/** 输入内容为空时清空错误提示的哨兵值 */
export const RBT_EMPTY_TEXT = '';

// ---------- 默认示例 ----------

/** 打开页面时自动加载的深度为 4 的满二叉树示例 */
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

// ---------- 可见文案(解析错误信息,保持原样) ----------

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
