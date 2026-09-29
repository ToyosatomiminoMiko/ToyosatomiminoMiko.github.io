/**
 * 站点级(main.ts / common)的声明式配置.
 *
 * 首页整套骨架都在这里声明,由 src/common/ui/site_shell.ts 生成:导航条(站名 +
 * 标签 + 头像),首屏(舞台 / 压暗层 / 底部一排),五个标签页,以及每个模块自己的
 * 空宿主;各模块的挂载函数只往宿主里长标记.宿主页 index.html 里没有任何标记,
 * 只留一个空位 `#site-root`.
 *
 * 只放纯数据,不放模块级可变状态.凡是"改了必须同步改另一处"的字面量(标签页类名,
 * 宿主 id,CSS 里的选择器)都写成具名常量:这类字面量写错不会报错,只会静默失效,
 * 所以不能散在各文件里.
 */

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

/**
 * 标签栏及其列表项的类名,由 public/css/index.css 的标签栏一节与
 * src/common/tabs.ts 独家使用.名字是当年照抄 bootstrap 的,但现在只有本站在用;
 * 改名要同时动 CSS 与测试,所以按现状保留.
 */
export const NAV_LIST_CLASS = 'nav nav-tabs';
export const NAV_ITEM_CLASS = 'nav-item';
export const NAV_LINK_CLASS = 'nav-link';

/** 选中态类名:触发器用它点亮文字,窗格用它上屏(见 index.css 的 .tab-content > .active) */
export const NAV_ACTIVE_CLASS = 'active';

/** 头像:导航条最右侧,点了去 GitHub */
export const AVATAR_LINK = 'https://github.com/ToyosatomiminoMiko';
export const AVATAR_SRC = '/images/head.png';
/** 头像的类名:尺寸与圆形都在 public/css/index.css 的 `.head` 里 */
export const AVATAR_CLASS = 'head';
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
 * 首屏容器的 id 与类名.样式只按 `.hero` 命中(见 public/css/index.css);
 * id 留给调试与自动化定位,以及"首屏只有一个"这条约束的可读性.
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

/** 标签页窗格的容器(唯一消费者是 index.css 的 `.tab-content > .tab-pane` 规则) */
export const TAB_CONTENT_CLASS = 'tab-content';
/** 窗格基础类:fade 只是一次过渡的名字,切换逻辑见 src/common/tabs.ts */
export const TAB_PANE_CLASS = 'tab-pane fade';
/**
 * 窗格"正在显示"的类名.
 *
 * `active` 参与选择器(display: block),`show` 只负责透明度 -- 两者分开写成
 * 常量,是因为 `classList` 不接受带空格的 token,tabs.ts 要按条增删;下面那条
 * 合并串留给骨架生成标记时直接用(两边因此不会各写一份字面量).
 */
export const TAB_PANE_SHOW_CLASS = 'show';
export const TAB_PANE_ACTIVE_CLASS = `${TAB_PANE_SHOW_CLASS} ${NAV_ACTIVE_CLASS}`;

// ---------- SETTING:整页面板 ----------

/*
 SETTING 标签页与 OLED / RBT / IEEE754 用**同一套面板结构**:框体由 miko_ui 的
 `createPanel` 建(`section.ui-panel > header.ui-panel-header > span.ui-panel-title`
 + `div.ui-panel-body`,外观与桌面窗口同源),本站只给标题文案与作用域类.
*/

/** 面板标题文案(标签栏那一项是 SETTING,页内标题沿用中文"设置") */
export const SETTING_PANEL_TITLE = '设置';

// ---------- SETTING:背景切换 ----------

/** 背景缩略图清单的一项 */
interface BackgroundPresetSpec {
    /** 图片地址(站点 public 下的路径) */
    readonly src: string;
    /** 缩略图下方的名字(同时是那颗按钮的可访问名) */
    readonly label: string;
}

/** 可选背景,顺序即界面顺序;点缩略图切整站背景(见 background.ts) */
export const BACKGROUND_PRESETS = [
    { src: '/images/bgimg/bgstar.gif', label: 'STAR' },
    { src: '/images/bgimg/bgcode.gif', label: 'CODE' },
] as const satisfies readonly BackgroundPresetSpec[];

/**
 * 背景缩略图那一行(排布行的容器)的类名(样式见 public/css/index.css 的 `.bgrow`).
 * 行本身不是控件,只是把两颗按钮并排摆开的 flex 容器.
 */
export const BACKGROUND_ROW_CLASS = 'bgrow';
/**
 * 缩略图按钮的类名:整块 tile 由库的 `createButton` 生成(基线类 `.ui-button`),
 * 这个类只叠本站要盖住基线的部分(块的排布与内边距,见 index.css 的 `.bgbtn`).
 */
export const BACKGROUND_BUTTON_CLASS = 'bgbtn';
/**
 * 缩略图本身的类名:background.ts 的点击委托先按**按钮**命中,
 * 再从这个按钮里按它取出要切的那张图.
 */
export const BACKGROUND_IMAGE_CLASS = 'bgimg';

// ---------- 背景切换(行为侧) ----------

/**
 * 背景切换:承载"当前生效背景图"的 CSS 自定义属性名.
 * 默认值在 public/css/tokens.css 的 :root(回落到 --bg-image-default),
 * 由 public/css/index.css 的 body 规则消费.这是 CSS 与 TS 的跨语言契约,
 * 改这里的字面量必须同步那两个样式表.
 */
export const BACKGROUND_IMAGE_VARIABLE = '--bg-image-active';

// ---------- 导航条"隐形 / 实底"状态(行为侧) ----------

/**
 * 导航条"隐形"时加在它身上的类名(样式见 public/css/index.css 的 `.is-over-hero`).
 * 两种情形都会加:首屏还压在导航条下面(HOME),或页面停在顶端(所有标签页,
 * 此时窗格顶上只有全站背景图).
 */
export const HEADER_OVER_HERO_CLASS = 'is-over-hero';

/**
 * 导航条高度的 CSS 自定义属性名.
 * 与 public/css/tokens.css 的 `--nav-height` 是跨语言契约:JS 要读它来给
 * 首屏那个 IntersectionObserver 设 rootMargin,让"隐形 -> 实底"正好发生在
 * 首屏底边越过导航条下沿的那一刻(改 tokens.css 必须同步改这里的字面量).
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
