/**
 * 屏幕性能 HUD(perf_overlay.ts)的常量.
 * 从 perf_overlay.ts 抽出: DOM id / role / 内联样式各项.
 * 颜色与字号刻意与 451 页面的火焰色系一致, 但这是引擎自主创建的 DOM,
 * 拿不到页面 CSS 的自定义属性, 所以在这里以 TS 常量维护.
 */

/** HUD 容器 id(便于调试时 getElementById) */
export const PERF_OVERLAY_ID = 'emberPerfHud';

/** HUD 的 aria role: 纯展示, 不参与无障碍朗读 */
export const PERF_OVERLAY_ROLE = 'presentation';

/** 层级: 拉到 int32 上限, 保证压住页面一切内容 */
export const PERF_OVERLAY_Z_INDEX = 2_147_483_647;

/** 内边距 */
export const PERF_OVERLAY_PADDING = '4px 8px';

/** 背景色(半透明黑) */
export const PERF_OVERLAY_BG = 'rgba(0,0,0,0.72)';

/** 文字颜色(暖橙) */
export const PERF_OVERLAY_COLOR = '#ffb37a';

/** 字体: 字号/行高/等宽字体族 */
export const PERF_OVERLAY_FONT = '12px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace';

/** 最大宽度: 不超过视口, 免得撑出横向滚动 */
export const PERF_OVERLAY_MAX_WIDTH = '100vw';
