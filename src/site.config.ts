// ================================================================
// 站点级(main.ts)常量配置
//
// 只把 main.ts 真正用到的"设计参数"具名化,不改变任何 DOM 结构或
// 选择器字面值.背景图路径由 index.html / tokens.css 决定,JS 从不设置,
// 所以这里不配置路径.
// ================================================================

/** 背景切换:可点击背景缩略图共用的类名(与 index.html 的 class 保持一致) */
export const BACKGROUND_IMAGE_CLASS = 'bgimg';

/** 背景切换:写入 body 内联样式时用到的 CSS 属性名(style.cssText 片段) */
export const BACKGROUND_IMAGE_STYLE_PROPERTY = 'background-image';
