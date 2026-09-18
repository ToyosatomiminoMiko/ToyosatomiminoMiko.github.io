// ================================================================
// 站点级(main.ts / common)常量配置
//
// 只把站点脚本真正用到的"设计参数"具名化,不改变任何 DOM 结构或
// 选择器字面值.背景图的默认路径由 tokens.css 决定,JS 从不设置,
// 所以这里不配置路径,只配置"切换到哪张"用到的类名与 CSS 变量名.
// ================================================================

/** 背景切换:可点击背景缩略图共用的类名(与 index.html 的 class 保持一致) */
export const BACKGROUND_IMAGE_CLASS = 'bgimg';

/**
 * 背景切换:承载"当前生效背景图"的 CSS 自定义属性名.
 * 默认值在 public/css/tokens.css 的 :root(回落到 --bg-image-default),
 * 由 public/css/index.css 的 body 规则消费.这是 CSS 与 TS 的跨语言契约,
 * 改这里的字面量必须同步那两个样式表.
 */
export const BACKGROUND_IMAGE_VARIABLE = '--bg-image-active';
