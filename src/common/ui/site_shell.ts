/*
首页骨架的生成者,index.html 里唯一一处标记的来源.

index.html 只留一个空位 `#site-root`,骨架的全部结构由这里按 site.config.ts 的声明
生成,并把元素引用交回调用方(src/main.ts 再把它们分给各模块的挂载函数).
宿主页因此不出现任何标记,也没有第二处 id 需要同步.

宿主只提供空位:结构里的每个宿主 div 都是空的,标记由对应模块的挂载函数生成.
OLED / RBT / IEEE754 三个模块直接把整个标签页窗格当宿主,所以骨架给它们建的就是
窗格本身.组装出的完整结构(导航条 / 首屏 / 五个窗格 / SETTING 面板)见
README.md 的"首屏与导航条"一节.

头像与标签栏平级,排在 header 末尾,而不是当标签栏的最后一项:标签栏是横向滚动
容器(窄窗口时标签横向滑动),滚动容器的 padding box 就是裁剪区,头像放进去 hover
辉光会被裁成方块.`.head-link` 的负 margin 把 header 的 gap 抵掉,落点与"排在
标签栏末尾"时一致.

组件自己的修饰类不在这里加:地铁车窗的 `.metro-window` 由它自己的挂载函数补到
每个宿主上,骨架不替组件记这些约定.
*/

import { create_element, createPanel } from 'miko_ui';
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
    SETTING_PANEL_TITLE,
    SITE_BRAND_CLASS,
    SITE_BRAND_TEXT,
    SITE_HOST_IDS,
    SITE_ROOT_ID,
    SITE_ROOT_MISSING_MESSAGE,
    TAB_CONTENT_CLASS,
    TAB_PANE_ACTIVE_CLASS,
    TAB_PANE_CLASS,
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
    /** 标签栏容器:mountTabs() 的 tablist */
    readonly navList: HTMLElement;
    /** 标签栏里的触发器,顺序与 NAV_ITEMS 一致 -> mountTabs() */
    readonly navLinks: readonly HTMLAnchorElement[];
    /** LED 时钟宿主 -> mountClock() */
    readonly clockHost: HTMLElement;
    /** 地铁车窗四块宿主 -> mountMetroWindow() */
    readonly metroStage: HTMLElement;
    readonly metroStyles: HTMLElement;
    readonly metroPanel: HTMLElement;
    readonly metroUploads: HTMLElement;
    /**
     * 背景缩略图那一行(`.bgrow`,SETTING 面板体的第一个子节点).
     * 它**已经有两颗缩略图**,不是空宿主:页面透明度滑块
     * (src/common/page_opacity.ts)往它里面 append 第三条参数行.
     */
    readonly backgroundRow: HTMLElement;
    /** 五个标签页窗格:OLED / RBT / IEEE754 直接把窗格当面板宿主 */
    readonly panes: Readonly<Record<NavPaneId, HTMLElement>>;
}

/** 一个标签页触发器:`<a href="#窗格">`,行为由 src/common/tabs.ts 绑上去 */
function createNavLink(item: NavItemSpec): HTMLAnchorElement {
    const active = item.pane === DEFAULT_NAV_PANE;
    return create_element(
        { tag: 'a' },
        {
            class: active ? `${NAV_LINK_CLASS} ${NAV_ACTIVE_CLASS}` : NAV_LINK_CLASS,
            href: `#${item.pane}`,
        },
        item.label,
    );
}

/** 一个标签页窗格:默认激活的那一个多带 .show active */
function createTabPane(item: NavItemSpec): HTMLDivElement {
    const active = item.pane === DEFAULT_NAV_PANE;
    return create_element(
        { tag: 'div' },
        { class: active ? `${TAB_PANE_CLASS} ${TAB_PANE_ACTIVE_CLASS}` : TAB_PANE_CLASS, id: item.pane },
    );
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
    const clockHost = create_element({ tag: 'div' }, { id: SITE_HOST_IDS.clock });
    const metroStage = create_element({ tag: 'div' }, { id: SITE_HOST_IDS.metroStage });
    const metroStyles = create_element({ tag: 'div' }, { id: SITE_HOST_IDS.metroStyles });
    const metroPanel = create_element({ tag: 'div' }, { id: SITE_HOST_IDS.metroPanel });
    const metroUploads = create_element({ tag: 'div' }, { id: SITE_HOST_IDS.metroUploads });

    // --- 导航条 ---
    // 触发器先建好,按 NAV_ITEMS 的顺序收进数组:后面 mountTabs() 要的就是
    // "触发器列表 + 窗格表"(见 src/common/tabs.ts),不是 ul 的子孙查询.
    const navLinks = NAV_ITEMS.map((item) => createNavLink(item));
    const navList = create_element(
        { tag: 'ul' },
        { class: NAV_LIST_CLASS },
        ...navLinks.map((link) =>
            create_element({ tag: 'li' }, { class: NAV_ITEM_CLASS }, link),
        ),
    );
    const header = create_element(
        { tag: 'header' },
        { class: HEADER_CLASS },
        create_element({ tag: 'span' }, { class: SITE_BRAND_CLASS }, SITE_BRAND_TEXT),
        navList,
        // 头像:导航条最右,点了去 GitHub(不是标签页,所以没有 href="#窗格").
        // 位置在标签栏**外面**:标签栏是横向滚动容器,会把 hover 辉光裁成方块
        // (完整理由见文件头的结构说明).
        create_element(
            { tag: 'a' },
            { class: AVATAR_LINK_CLASS, href: AVATAR_LINK },
            create_element({ tag: 'img' }, { class: AVATAR_CLASS, src: AVATAR_SRC, alt: AVATAR_ALT }),
        ),
    );

    // --- 首屏 ---
    const hero = create_element(
        { tag: 'section' },
        { class: HERO_CLASS, id: HERO_ID },
        create_element({ tag: 'div' }, { class: HERO_STAGE_CLASS }, metroStage),
        create_element({ tag: 'div' }, { class: HERO_SCRIM_CLASS }),
        create_element({ tag: 'div' }, { class: HERO_BOTTOM_CLASS }, clockHost, metroStyles),
    );

    // --- 五个标签页窗格 ---
    const panes = {} as Record<NavPaneId, HTMLElement>;
    for (const item of NAV_ITEMS) {
        panes[item.pane] = createTabPane(item);
    }
    // 首屏在 HOME 窗格里;SETTING 窗格 = 库的 `createPanel` 建的一张面板
    // (`section.ui-panel`),面板体里依次是背景缩略图 + 车窗控制台宿主 + 上传面板宿主
    // (标题"设置"在 `.ui-panel-header`).
    panes.home.append(hero);
    // 背景行先建好并留个引用:页面透明度滑块要往这一行里追加
    // (见 main.ts 的 mountPageOpacity).
    const backgroundRow = createBackgroundSection();
    panes.setting.append(
        createPanel({
            title: SETTING_PANEL_TITLE,
            body: [backgroundRow, metroPanel, metroUploads],
        }).element,
    );

    root.replaceChildren(
        header,
        create_element(
            { tag: 'main' },
            {},
            create_element(
                { tag: 'div' },
                { class: TAB_CONTENT_CLASS },
                ...NAV_ITEMS.map((item) => panes[item.pane]),
            ),
        ),
    );

    return {
        root,
        header,
        hero,
        navList,
        navLinks,
        clockHost,
        metroStage,
        metroStyles,
        metroPanel,
        metroUploads,
        backgroundRow,
        panes,
    };
}
