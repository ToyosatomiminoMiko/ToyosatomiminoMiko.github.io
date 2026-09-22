/*
首页骨架的**声明式组件** -- index.html 里唯一一处标记的生成者.

原先首页骨架写在 index.html 里(导航条 / 首屏 / 五个标签页 / 各模块的宿主),
再由 TS 按 id 一个个取回来;现在反过来:HTML 只留一个空位 `#site-root`,
骨架的全部结构由这里按 site.config.ts 的声明生成,并把**元素引用**交回调用方
(src/main.ts 把它们分给各模块的挂载函数).与 SETTING 里的地铁车窗控制台
完全同一条约定:宿主页不出现任何标记,也没有第二处 id 需要同步.

结构(顺序即显示顺序):

    header.site-header
      ├── span.site-brand                      站名(压在首屏画面上时的站点身份)
      ├── ul.nav.nav-tabs                      标签栏(bootstrap 声明式标签页)
      │     └── li.nav-item > a.nav-link[href=#<pane>][data-bs-toggle=tab]
      └── a.head-link[href=GitHub] > img.rounded-circle.head
                                               头像(在标签栏**外面**,见下)
    main > div.tab-content
      ├── div.tab-pane#home         > section.hero#hero
      │     ├── div.hero__stage     > div#metro-window      地铁车窗舞台(空宿主)
      │     ├── div.hero__scrim     顶部渐变压暗
      │     └── div.hero__bottom
      │           ├── div#app_led_clock                      LED 时钟(空宿主)
      │           └── div#metro-styles                       风格按钮(空宿主)
      ├── div.tab-pane#oled         空宿主:OLED 面板由 oled/ 长在里面
      ├── div.tab-pane#rbt          空宿主:红黑树面板由 rbt/ 长在里面
      ├── div.tab-pane#ieee754      空宿主:IEEE754 面板由 ieee754/ 长在里面
      └── div.tab-pane#setting
            ├── (背景切换区:标题 + 缩略图列表,由 ui/background_section.ts 生成)
            ├── div#metro-params    地铁车窗控制台(空宿主)
            └── div#metro-uploads   图层贴图上传面板(空宿主)

**宿主只提供空位**:每个 `div#...` 都是空的,标记由对应模块的挂载函数生成.
OLED / RBT / IEEE754 三个模块干脆把整个标签页窗格当宿主(窗格本身就是容器),
所以骨架里给它们建的宿主就是窗格自己.

**头像挂在 header 上,不是标签栏的最后一项**:标签栏 `ul.nav-tabs` 是**横向
滚动容器**(窄窗口时标签横向滑动,见 index.css),滚动容器的 padding box
就是裁剪区 -- 头像放进去,hover 辉光的模糊半径会被裁成方块.所以头像与标签栏
平级,排在 header 末尾;`.head-link` 的负 margin 把 header 的 gap 抵掉,
头像的落点与当初"排在标签栏末尾"时逐像素一致(见 index.css 的 .head-link).

组件的**修饰类不在这里加**:那是每个组件自己的约定(地铁车窗的 `.metro-window`
由它自己的挂载函数补到每个宿主上),骨架不替组件记这些.
*/

import { h } from '@/common/dom';
import {
    AVATAR_ALT,
    AVATAR_CLASS,
    AVATAR_LINK,
    AVATAR_LINK_CLASS,
    AVATAR_SRC,
    DEFAULT_NAV_PANE,
    HEADER_CLASS,
    HERO_BOTTOM_CLASS,
    HERO_CLASS,
    HERO_ID,
    HERO_SCRIM_CLASS,
    HERO_STAGE_CLASS,
    NAV_ACTIVE_CLASS,
    NAV_ITEM_CLASS,
    NAV_ITEMS,
    NAV_LINK_CLASS,
    NAV_LIST_CLASS,
    SITE_BRAND_CLASS,
    SITE_BRAND_TEXT,
    SITE_HOST_IDS,
    SITE_ROOT_ID,
    SITE_ROOT_MISSING_MESSAGE,
    TAB_CONTENT_CLASS,
    TAB_PANE_ACTIVE_CLASS,
    TAB_PANE_CLASS,
    TAB_TOGGLE_DATA_KEY,
    TAB_TOGGLE_DATA_VALUE,
    type NavItemSpec,
    type NavPaneId,
} from '@/common/site.config';
import { createBackgroundSection } from '@/common/ui/background_section';

/** 骨架生成后交回的元素引用(挂载函数据此绑行为,不再按 id 查 DOM) */
export interface SiteShell {
    /** 骨架宿主本身(#site-root) */
    readonly root: HTMLElement;
    /** 导航条:header_state.ts 靠它加/摘 .is-over-hero */
    readonly header: HTMLElement;
    /** 首屏:header_state.ts 用它判断"画面还在不在导航条下面" */
    readonly hero: HTMLElement;
    /** LED 时钟宿主 -> mountClock() */
    readonly clockHost: HTMLElement;
    /** 地铁车窗四块宿主 -> mountMetroWindow() */
    readonly metroStage: HTMLElement;
    readonly metroStyles: HTMLElement;
    readonly metroPanel: HTMLElement;
    readonly metroUploads: HTMLElement;
    /** 五个标签页窗格:OLED / RBT / IEEE754 直接把窗格当面板宿主 */
    readonly panes: Readonly<Record<NavPaneId, HTMLElement>>;
}

/** 一个标签页触发器:声明式 bootstrap 属性 + 指向窗格的锚点 */
function createNavLink(item: NavItemSpec): HTMLAnchorElement {
    const active = item.pane === DEFAULT_NAV_PANE;
    return h('a', {
        class: active ? `${NAV_LINK_CLASS} ${NAV_ACTIVE_CLASS}` : NAV_LINK_CLASS,
        text: item.label,
        attrs: { href: `#${item.pane}` },
        dataset: { [TAB_TOGGLE_DATA_KEY]: TAB_TOGGLE_DATA_VALUE },
    });
}

/** 一个标签页窗格:默认激活的那一个多带 .show active */
function createTabPane(item: NavItemSpec): HTMLDivElement {
    const active = item.pane === DEFAULT_NAV_PANE;
    return h('div', {
        class: active ? `${TAB_PANE_CLASS} ${TAB_PANE_ACTIVE_CLASS}` : TAB_PANE_CLASS,
        attrs: { id: item.pane },
    });
}

/**
 * 生成整页骨架并插进 #site-root,返回各部分的元素引用.
 *
 * 重复调用不会把骨架插两遍:这里用 replaceChildren 整体替换宿主内容,
 * 所以"挂两次"的结果仍是同一份骨架(各模块的挂载函数自己按单例约束办事).
 */
export function mountSiteShell(): SiteShell {
    const root = document.getElementById(SITE_ROOT_ID);
    if (!root) {
        throw new Error(SITE_ROOT_MISSING_MESSAGE);
    }

    // --- 各模块的空宿主:先建好,生成完一起交回 ---
    const clockHost = h('div', { attrs: { id: SITE_HOST_IDS.clock } });
    const metroStage = h('div', { attrs: { id: SITE_HOST_IDS.metroStage } });
    const metroStyles = h('div', { attrs: { id: SITE_HOST_IDS.metroStyles } });
    const metroPanel = h('div', { attrs: { id: SITE_HOST_IDS.metroPanel } });
    const metroUploads = h('div', { attrs: { id: SITE_HOST_IDS.metroUploads } });

    // --- 导航条 ---
    const header = h('header', { class: HEADER_CLASS }, [
        h('span', { class: SITE_BRAND_CLASS, text: SITE_BRAND_TEXT }),
        h('ul', { class: NAV_LIST_CLASS }, [
            ...NAV_ITEMS.map((item) => h('li', { class: NAV_ITEM_CLASS }, [createNavLink(item)])),
        ]),
        // 头像:导航条最右,点了去 GitHub(不是标签页,所以不带 data-bs-toggle).
        // 位置在标签栏**外面**:标签栏是横向滚动容器,会把 hover 辉光裁成方块
        // (完整理由见文件头的结构说明).
        h('a', { class: AVATAR_LINK_CLASS, attrs: { href: AVATAR_LINK } }, [
            h('img', { class: AVATAR_CLASS, attrs: { src: AVATAR_SRC, alt: AVATAR_ALT } }),
        ]),
    ]);

    // --- 首屏 ---
    const hero = h('section', { class: HERO_CLASS, attrs: { id: HERO_ID } }, [
        h('div', { class: HERO_STAGE_CLASS }, [metroStage]),
        h('div', { class: HERO_SCRIM_CLASS }),
        h('div', { class: HERO_BOTTOM_CLASS }, [clockHost, metroStyles]),
    ]);

    // --- 五个标签页窗格 ---
    const panes = {} as Record<NavPaneId, HTMLElement>;
    for (const item of NAV_ITEMS) {
        panes[item.pane] = createTabPane(item);
    }
    // 首屏在 HOME 窗格里;SETTING 窗格 = 背景区 + 车窗控制台 + 上传面板.
    panes.home.append(hero);
    panes.setting.append(...createBackgroundSection(), metroPanel, metroUploads);

    root.replaceChildren(
        header,
        h('main', {}, [h('div', { class: TAB_CONTENT_CLASS }, NAV_ITEMS.map((item) => panes[item.pane]))]),
    );

    return {
        root,
        header,
        hero,
        clockHost,
        metroStage,
        metroStyles,
        metroPanel,
        metroUploads,
        panes,
    };
}
