// ================================================================
// 站点级(main.ts / common)的**声明式配置**
//
// 首页的整套骨架都在这里声明,由 src/common/ui/site_shell.ts 生成:
// 导航条(站名 + 标签 + 头像),首屏(舞台 / 压暗层 / 底部一排),
// 五个标签页,以及每个模块自己的**空宿主**;各模块的挂载函数只往宿主里长标记.
// 这条约定是从 SETTING 里的地铁车窗控制台抄来的:
//
//   - 宿主页(index.html)不出现任何标记,只留一个空位 `#site-root`;
//   - "结构 / 文案 / 类名 / id" 只在这里定义一次,组件与 CSS 都引用它;
//   - 行为模块(header_state.ts / background.ts)不读页面:骨架生成后由
//     site_shell 把**元素引用**交回来,不再按 id 去 DOM 里找.
//
// 这里只放纯数据,不放模块级可变状态.凡是"改了必须同步改另一处"的字面量
// (bootstrap 的类名与 data 属性,CSS 里的 id 选择器,模块的宿主 id)都写成
// 具名常量,写错不会报错,只会静默失效的东西尤其不能散在各文件里.
// ================================================================

import { CLOCK_HOST_ID } from '@/clock/config';
import { MOUNT_IDS } from '@/metro_window/src/config';

// ---------- 页面骨架 ----------

/**
 * 页面骨架的宿主:index.html 里**唯一**的一个元素.
 * site_shell.ts 把整个骨架生成到这个位置,所以 HTML 里没有第二处标记可改.
 */
export const SITE_ROOT_ID = 'site-root';

/** 找不到骨架宿主时抛错的文案(静默不生效比报错难查得多) */
export const SITE_ROOT_MISSING_MESSAGE =
    '找不到页面骨架宿主 #site-root,首页无法挂载(check index.html)';

// ---------- 导航条 ----------

/** 导航条的选择器契约:public/css/index.css 的 .site-header 规则靠它命中 */
export const HEADER_CLASS = 'site-header';

/** 站名(左上角),压在首屏画面上时它是唯一的"站点身份" */
export const SITE_BRAND_TEXT = 'ToyosatomiminoMiko';

/** 站名的类名(样式见 public/css/index.css 的 .site-brand) */
export const SITE_BRAND_CLASS = 'site-brand';

/** 标签栏:三个类名都用 bootstrap 5 的约定(见 index.css 里压掉外观的规则) */
export const NAV_LIST_CLASS = 'nav nav-tabs';
export const NAV_ITEM_CLASS = 'nav-item';
export const NAV_LINK_CLASS = 'nav-link';

/** 选中态类名(bootstrap 的标签页契约) */
export const NAV_ACTIVE_CLASS = 'active';

/**
 * 标签页触发器的**声明式属性**(bootstrap 的 data-api):
 * `data-bs-toggle="tab"` 让 bootstrap 的委托监听认出"这是标签页触发器",
 * href 指向的窗格由它切 .active / .show.属性名与取值都是 bootstrap 的约定,
 * 写成常量是为了"标签栏是怎么动起来的"只在这里解释一次.
 */
export const TAB_TOGGLE_DATA_KEY = 'bs-toggle';
export const TAB_TOGGLE_DATA_VALUE = 'tab';

/** 头像:导航条最右侧,点了去 GitHub */
export const AVATAR_LINK = 'https://github.com/ToyosatomiminoMiko';
export const AVATAR_SRC = '/images/head.png';
export const AVATAR_CLASS = 'rounded-circle head';
/**
 * 头像链接的类名(样式见 public/css/index.css 的 .head-link).
 *
 * 头像挂在**导航条 header 上**,不在标签栏 `ul.nav-tabs` 里:`ul` 为了窄窗口
 * 横向滚动是 `overflow-x: auto` 的滚动容器,padding box 就是裁剪区,hover 辉光
 * 放进去会被裁成方块(负 margin 把 header 的 gap 抵掉,位置与"排在标签栏末尾"时一致).
 */
export const AVATAR_LINK_CLASS = 'head-link';
/** 头像的 alt:它同时是链接图标,给它一句可读的替代文本 */
export const AVATAR_ALT = 'ToyosatomiminoMiko 的 GitHub';

/**
 * 一个导航项 = 一个标签页.
 * pane 同时是:标签页窗格的 id,标签 href 的锚点(`#pane`),
 * 以及**该模块的挂载宿主**(OLED / RBT / IEEE754 三个模块把整块面板长在窗格里).
 */
export interface NavItemSpec {
    readonly pane: string;
    readonly label: string;
}

/** 导航项,顺序即界面顺序;第一项是默认激活的标签页 */
export const NAV_ITEMS = [
    { pane: 'home', label: 'HOME' },
    { pane: 'oled', label: 'OLED' },
    { pane: 'rbt', label: 'RBT' },
    { pane: 'ieee754', label: 'IEEE754' },
    { pane: 'setting', label: 'SETTING' },
] as const satisfies readonly NavItemSpec[];

/** 标签页 id 的字面量联合('home' | 'oled' | 'rbt' | 'ieee754' | 'setting') */
export type NavPaneId = (typeof NAV_ITEMS)[number]['pane'];

/** 默认激活的标签页(取声明里的第一项,不另写一份字面量) */
export const DEFAULT_NAV_PANE: NavPaneId = NAV_ITEMS[0].pane;

// ---------- 首屏 ----------

/**
 * 首屏容器.它的 id 有两个消费者:`public/css/index.css` 的 `#home { padding-top: 0 }`
 * 是**标签页**的规则(不是首屏),首屏自己只被 .hero 类命中;这里的 id 主要用于
 * 调试与自动化定位,以及"首屏只有一个"这条约束的可读性.
 */
export const HERO_ID = 'hero';
export const HERO_CLASS = 'hero';
/** 画布层:地铁车窗舞台宿主 #metro-window 的父层,必须给定位(舞台是 absolute) */
export const HERO_STAGE_CLASS = 'hero__stage';
/** 顶部渐变压暗:导航文字压在画面上时的可读性来源 */
export const HERO_SCRIM_CLASS = 'hero__scrim';
/** 首屏底部一排:LED 时钟(左) + 风格按钮(右) */
export const HERO_BOTTOM_CLASS = 'hero__bottom';

// ---------- 标签页 ----------

/** bootstrap 的标签页容器 */
export const TAB_CONTENT_CLASS = 'tab-content';
/** 窗格基础类: fade 是过渡,bootstrap 切换时会加 .show */
export const TAB_PANE_CLASS = 'tab-pane fade';
/** 激活窗格的类名(bootstrap:active 参与选择器,show 负责透明度) */
export const TAB_PANE_ACTIVE_CLASS = 'show active';

// ---------- SETTING:背景切换 ----------

/** 背景区的标题文案 */
export const BACKGROUND_SECTION_TITLE = '修改背景';

/** 背景缩略图清单(列表容器 / 列表项 / 缩略图本身的类名见下) */
export interface BackgroundPresetSpec {
    /** 图片地址(站点 public 下的路径) */
    readonly src: string;
    /** 缩略图下方的名字 */
    readonly label: string;
}

/** 可选背景,顺序即界面顺序;点缩略图切整站背景(见 background.ts) */
export const BACKGROUND_PRESETS = [
    { src: '/images/bgimg/bgstar.gif', label: 'STAR' },
    { src: '/images/bgimg/bgcode.gif', label: 'CODE' },
] as const satisfies readonly BackgroundPresetSpec[];

/** 背景列表的类名(样式见 public/css/index.css 的 .bgul / .bgli / .bgimg) */
export const BACKGROUND_LIST_CLASS = 'bgul';
export const BACKGROUND_ITEM_CLASS = 'bgli';
/** 缩略图本身的类名:background.ts 的点击委托就是按它命中"被点的是哪张背景" */
export const BACKGROUND_IMAGE_CLASS = 'bgimg';
/** 缩略图的圆角(bootstrap 的工具类,与 .bgimg 一起写在 class 里) */
export const BACKGROUND_IMAGE_ROUNDED_CLASS = 'rounded';

// ---------- 背景切换(行为侧) ----------

/**
 * 背景切换:承载"当前生效背景图"的 CSS 自定义属性名.
 * 默认值在 public/css/tokens.css 的 :root(回落到 --bg-image-default),
 * 由 public/css/index.css 的 body 规则消费.这是 CSS 与 TS 的跨语言契约,
 * 改这里的字面量必须同步那两个样式表.
 */
export const BACKGROUND_IMAGE_VARIABLE = '--bg-image-active';

// ---------- 导航条"透明 / 实底"状态(行为侧) ----------

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

// ---------- 各模块的空宿主 id(集中成一张表,便于核对"骨架长在哪") ----------

/**
 * 骨架里给各模块留的空宿主 id.
 * 每个 id 的**所有权**在对应模块的 config.ts 里(改 id 时改那边),这里只是
 * 把它们汇总成一张表:site_shell.ts 按这张表建宿主,并交回元素引用.
 */
export const SITE_HOST_IDS = {
    /** LED 时钟(HOME 首屏底部左侧) */
    clock: CLOCK_HOST_ID,
    /** 地铁车窗:舞台(首屏画布层)/ 风格按钮(首屏底部右侧)/ 控制台与上传面板(SETTING) */
    metroStage: MOUNT_IDS.stage,
    metroStyles: MOUNT_IDS.styles,
    metroPanel: MOUNT_IDS.panel,
    metroUploads: MOUNT_IDS.uploads,
} as const;
