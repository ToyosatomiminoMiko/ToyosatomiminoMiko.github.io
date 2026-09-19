/**
 * 首页骨架的**标记契约**回归网(进程内,跑在 happy-dom 里).
 *
 * 为什么这一层要进 `*.test.ts`:首页标记由 `site_shell.ts` 按 `site.config.ts`
 * 生成,而 CSS 与 bootstrap 都是按**类名 / id / data-* 属性**命中的 --
 * 生成结果一旦走样,表现是"样式静默失效"(看着没坏但全乱),没有报错,
 * 也没有类型错误.这类契约的正确断言方式就是"把生成的 DOM 拿来按 CSS 用的选择器查一遍".
 *
 * 与 `scripts/smoke_home.mjs` 的分工:**这里管"标记长什么样"**(进程内,无浏览器,
 * 不需要 dist,CI 里也跑);真浏览器那份只管"必须真渲染才成立的事"
 * (canvas 像素,bootstrap 交互,computed style,时钟走秒).
 *
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from 'vitest';

import {
    AVATAR_ALT,
    AVATAR_CLASS,
    AVATAR_LINK,
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
} from '@/common/site.config';
import { mountSiteShell, type SiteShell } from '@/common/ui/site_shell';

/** bootstrap 的标签页触发器选择器:属性名与取值都来自 config,这里只是拼出来 */
const TOGGLE_SELECTOR = `a[data-${TAB_TOGGLE_DATA_KEY}="${TAB_TOGGLE_DATA_VALUE}"]`;

/** 建好骨架宿主(#site-root)并生成一次骨架 */
function setupShell(): SiteShell {
    document.body.innerHTML = '';
    const root = document.createElement('div');
    root.id = SITE_ROOT_ID;
    document.body.append(root);
    return mountSiteShell();
}

/** 元素的类名列表(断言"CSS 靠哪个类命中"用) */
function classes(element: Element | null): string[] {
    return element ? [...element.classList] : [];
}

describe('首页骨架:宿主与整体结构', () => {
    it('骨架生成到 #site-root,里面是 header + main', () => {
        const shell = setupShell();
        expect(shell.root.id).toBe(SITE_ROOT_ID);
        expect(shell.root.children).toHaveLength(2);
        expect(shell.root.children[0].tagName).toBe('HEADER');
        expect(shell.root.children[1].tagName).toBe('MAIN');
        // public/css/index.css 的 main / .tab-content 规则按这两个命中
        expect(classes(shell.root.children[1])).toEqual([]);
        expect(shell.root.querySelector(`.${TAB_CONTENT_CLASS}`)).not.toBeNull();
    });

    it('找不到宿主时直接抛错,而不是静默不挂', () => {
        document.body.innerHTML = '';
        expect(() => mountSiteShell()).toThrow(SITE_ROOT_MISSING_MESSAGE);
    });

    it('重复挂载不会插两份(宿主被整体接管)', () => {
        setupShell();
        mountSiteShell();
        expect(document.querySelectorAll(`header.${HEADER_CLASS}`)).toHaveLength(1);
        expect(document.querySelectorAll(`#${HERO_ID}`)).toHaveLength(1);
        expect(document.querySelectorAll(TOGGLE_SELECTOR)).toHaveLength(NAV_ITEMS.length);
    });

    it('整份文档里没有重复 id', () => {
        setupShell();
        const ids = [...document.querySelectorAll('[id]')].map((element) => element.id);
        expect(new Set(ids).size).toBe(ids.length);
    });
});

describe('首页骨架:导航条', () => {
    it('导航条用 header.site-header 承载(.site-header 是 CSS 与 header_state 的契约)', () => {
        const shell = setupShell();
        expect(shell.header.tagName).toBe('HEADER');
        expect(classes(shell.header)).toContain(HEADER_CLASS);
    });

    it('站名是 span.site-brand 且文案不变(不是 <a>,不带标签页触发器属性)', () => {
        setupShell();
        const brand = document.querySelector(`.${SITE_BRAND_CLASS}`);
        expect(brand?.tagName).toBe('SPAN');
        expect(brand?.textContent).toBe(SITE_BRAND_TEXT);
        expect(brand?.getAttribute('href')).toBeNull();
        expect(brand?.hasAttribute(`data-${TAB_TOGGLE_DATA_KEY}`)).toBe(false);
    });

    it('标签栏是 ul.nav.nav-tabs(bootstrap 的标签页容器约定)', () => {
        setupShell();
        const list = document.querySelector(`.${NAV_LIST_CLASS.split(' ')[0]}`);
        expect(list?.tagName).toBe('UL');
        expect(classes(list).join(' ')).toBe(NAV_LIST_CLASS);
        expect(list?.children).toHaveLength(NAV_ITEMS.length + 1); // +1 是头像那一项
    });

    it('每个导航项都是 li.nav-item + a.nav-link[href=#窗格][data-bs-toggle=tab]', () => {
        setupShell();
        for (const item of NAV_ITEMS) {
            const link = document.querySelector(`a.${NAV_LINK_CLASS}[href="#${item.pane}"]`);
            expect(link, item.pane).not.toBeNull();
            expect(link?.textContent, item.pane).toBe(item.label);
            // 关键契约:bootstrap 的 data-api 就是按这个选择器委托的,
            // 属性没写对(或写成了别的 data-* 键)时标签页会静默点不动.
            expect(link?.getAttribute(`data-${TAB_TOGGLE_DATA_KEY}`), item.pane)
                .toBe(TAB_TOGGLE_DATA_VALUE);
            expect(classes(link?.parentElement ?? null), item.pane).toEqual([NAV_ITEM_CLASS]);
            expect(link?.closest('li')?.className, item.pane).toBe(NAV_ITEM_CLASS);
        }
        expect(document.querySelectorAll(TOGGLE_SELECTOR)).toHaveLength(NAV_ITEMS.length);
    });

    it('只有默认标签页带 active', () => {
        setupShell();
        const active = [...document.querySelectorAll(`.${NAV_LINK_CLASS}.${NAV_ACTIVE_CLASS}`)];
        expect(active).toHaveLength(1);
        expect(active[0].getAttribute('href')).toBe(`#${DEFAULT_NAV_PANE}`);
    });

    it('头像在导航条里,指向 GitHub', () => {
        setupShell();
        const link = document.querySelector(`header a[href="${AVATAR_LINK}"]`);
        const image = link?.querySelector('img');
        expect(image?.getAttribute('src')).toBe(AVATAR_SRC);
        expect(image?.getAttribute('alt')).toBe(AVATAR_ALT);
        // .head 的尺寸与 hover 辉光在 public/css/index.css 里,两边靠这些类对齐
        expect(classes(image ?? null).join(' ')).toBe(AVATAR_CLASS);
    });
});

describe('首页骨架:首屏', () => {
    it('#hero 是 section.hero,而且落在 HOME 窗格里', () => {
        const shell = setupShell();
        expect(shell.hero.tagName).toBe('SECTION');
        expect(shell.hero.id).toBe(HERO_ID);
        expect(classes(shell.hero)).toEqual([HERO_CLASS]);
        expect(shell.hero.parentElement?.id).toBe(DEFAULT_NAV_PANE);
    });

    it('首屏三段:舞台层 / 压暗层 / 底部一排', () => {
        const shell = setupShell();
        const stage = shell.hero.querySelector(`.${HERO_STAGE_CLASS}`);
        expect(classes(stage)).toEqual([HERO_STAGE_CLASS]);
        expect(classes(shell.hero.querySelector(`.${HERO_SCRIM_CLASS}`)))
            .toEqual([HERO_SCRIM_CLASS]);
        const bottom = shell.hero.querySelector(`.${HERO_BOTTOM_CLASS}`);
        expect(classes(bottom)).toEqual([HERO_BOTTOM_CLASS]);
        // 顺序即层叠顺序:画布层在最下,压暗层压在它上面,底部一排在最上
        expect([...shell.hero.children].map((child) => child.className))
            .toEqual([HERO_STAGE_CLASS, HERO_SCRIM_CLASS, HERO_BOTTOM_CLASS]);
    });

    it('舞台宿主在 .hero__stage 里(舞台是 absolute,宿主必须是定位祖先)', () => {
        const shell = setupShell();
        const stageHost = shell.hero.querySelector(`.${HERO_STAGE_CLASS} > #${SITE_HOST_IDS.metroStage}`);
        expect(stageHost).toBe(shell.metroStage);
        // 站点侧不给舞台补修饰类:那是组件的约定(见 metro_window.ts)
        expect(stageHost?.className).toBe('');
    });

    it('时钟与风格按钮并排在首屏底部', () => {
        const shell = setupShell();
        const bottom = shell.hero.querySelector(`.${HERO_BOTTOM_CLASS}`);
        expect([...(bottom?.children ?? [])].map((child) => child.id))
            .toEqual([SITE_HOST_IDS.clock, SITE_HOST_IDS.metroStyles]);
        expect(shell.clockHost.id).toBe(SITE_HOST_IDS.clock);
        expect(shell.metroStyles.id).toBe(SITE_HOST_IDS.metroStyles);
    });
});

describe('首页骨架:五个标签页窗格', () => {
    it('每个导航项都有一个同 id 的窗格,类名是 bootstrap 约定的 tab-pane fade', () => {
        const shell = setupShell();
        for (const item of NAV_ITEMS) {
            const pane = document.getElementById(item.pane);
            expect(pane, item.pane).not.toBeNull();
            expect(pane, item.pane).toBe(shell.panes[item.pane]);
            expect(classes(pane), item.pane).toContain('tab-pane');
            expect(classes(pane), item.pane).toContain('fade');
        }
    });

    it('只有默认窗格是 show active,其余四个都不带', () => {
        setupShell();
        for (const item of NAV_ITEMS) {
            const pane = document.getElementById(item.pane);
            const active = item.pane === DEFAULT_NAV_PANE;
            expect(pane?.classList.contains('show'), item.pane).toBe(active);
            expect(pane?.classList.contains(NAV_ACTIVE_CLASS), item.pane).toBe(active);
            if (active) {
                expect(pane?.className, item.pane).toContain(TAB_PANE_ACTIVE_CLASS);
            } else {
                expect(pane?.className, item.pane).toBe(TAB_PANE_CLASS);
            }
        }
    });

    it('SETTING 窗格里是"背景区 + 控制台宿主 + 上传面板宿主"', () => {
        const shell = setupShell();
        const setting = shell.panes.setting;
        // 背景区自带两个子节点(标题 h4 + 缩略图 ul),后两个是车窗的宿主
        const children = [...setting.children];
        expect(children[children.length - 2]).toBe(shell.metroPanel);
        expect(children[children.length - 1]).toBe(shell.metroUploads);
        expect(setting.querySelector(`#${SITE_HOST_IDS.metroPanel}`)).toBe(shell.metroPanel);
        expect(setting.querySelector(`#${SITE_HOST_IDS.metroUploads}`)).toBe(shell.metroUploads);
    });
});

describe('首页骨架:交回的引用与文档里的元素一一对应', () => {
    /*
      "宿主只提供空位 + 引用交回"是这次重构的核心约定:骨架建完就把元素交出去,
      main.ts 与各模块不再按 id 查 DOM.这一条断言的是"交回的确实是文档里那一个",
      否则就会出现"模块把标记长进了不在页面上的元素"这种静默失效.
    */
    it('每个宿主引用都等于按同一个 id 查到的元素', () => {
        const shell = setupShell();
        expect(shell.clockHost).toBe(document.getElementById(SITE_HOST_IDS.clock));
        expect(shell.metroStage).toBe(document.getElementById(SITE_HOST_IDS.metroStage));
        expect(shell.metroStyles).toBe(document.getElementById(SITE_HOST_IDS.metroStyles));
        expect(shell.metroPanel).toBe(document.getElementById(SITE_HOST_IDS.metroPanel));
        expect(shell.metroUploads).toBe(document.getElementById(SITE_HOST_IDS.metroUploads));
        expect(shell.header).toBe(document.querySelector(`header.${HEADER_CLASS}`));
        expect(shell.hero).toBe(document.getElementById(HERO_ID));
        for (const item of NAV_ITEMS) {
            expect(shell.panes[item.pane], item.pane).toBe(document.getElementById(item.pane));
        }
    });

    it('宿主 id 与窗格 id 不撞车(撞了就会把标记长到别人的容器里)', () => {
        const shell = setupShell();
        const hostIds = [shell.clockHost.id, shell.metroStage.id, shell.metroStyles.id,
            shell.metroPanel.id, shell.metroUploads.id];
        expect(new Set(hostIds).size).toBe(hostIds.length);
        for (const id of hostIds) {
            expect(NAV_ITEMS.some((item) => item.pane === id), id).toBe(false);
        }
    });
});
