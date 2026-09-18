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

// ---------- 导航条(随首屏切换"透明 / 实底") ----------

/** 首屏容器的 id(与 index.html 的 `<section class="hero" id="hero">` 一致) */
export const HERO_ID = 'hero';

/**
 * 站点导航条的选择器.
 * 带上标签名而不是只用类名:它与 index.html 的 `<header class="site-header">`
 * 是同一份契约,写错不会报错,只会静默不生效.
 */
export const HEADER_SELECTOR = 'header.site-header';

/** 首屏还压在导航条下面时,加在导航条上的类名(样式见 public/css/index.css) */
export const HEADER_OVER_HERO_CLASS = 'is-over-hero';

/**
 * 导航条高度的 CSS 自定义属性名.
 * 与 public/css/tokens.css 的 `--nav-height` 是跨语言契约:JS 要读它来给
 * IntersectionObserver 设 rootMargin,让"透明 -> 实底"正好发生在首屏底边越过
 * 导航条下沿的那一刻(改 tokens.css 必须同步改这里的字面量).
 */
export const NAV_HEIGHT_VARIABLE = '--nav-height';

/** 读不到 `--nav-height` 时的回退高度(px),与 tokens.css 的默认值保持一致 */
export const NAV_HEIGHT_FALLBACK = 42;

/** 找不到首屏或导航条时抛错的文案(静默不生效比报错难查得多) */
export const HEADER_STATE_MISSING_MESSAGE =
    '找不到首屏 #hero 或导航条 header.site-header,导航条无法随首屏切换透明/实底';
