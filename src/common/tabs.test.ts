/**
 * 标签页行为的**状态迁移**回归网(进程内,跑在 happy-dom 里).
 *
 * 这一层与 `ui/site_shell.test.ts` 的分工:那边管"骨架长什么样"(类名 / id /
 * 结构),这边管"点下去之后类名怎么迁移" -- 切换行为整个在 `src/common/tabs.ts`,
 * 所以这套断言就落在它身上.
 *
 * 进程内跑不到的东西(真实 CSS 级联下的 display / opacity,淡入的过渡本身)留给
 * `scripts/smoke_home.mjs`:happy-dom 不解析样式表,这里只能验"类名与 ARIA 有没有
 * 落到该落的元素上".好在契约就是这个:样式表按类名命中,类名对了,真浏览器里
 * 的显隐就对了.
 *
 * 测试都走**真实入口**(mountSiteShell + mountTabs),不自己拼一份最简 DOM:
 * 这样"骨架生成的顺序"与"控制器期望的顺序"如果哪天错位,这里会直接红.
 *
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from 'vitest';

import {
    DEFAULT_NAV_PANE,
    NAV_ACTIVE_CLASS,
    NAV_ITEMS,
    SITE_ROOT_ID,
    TAB_PANE_SHOW_CLASS,
} from '@/common/site.config';
import { mountTabs, TABS_MISMATCH_MESSAGE } from '@/common/tabs';
import { mountSiteShell, type SiteShell } from '@/common/ui/site_shell';

/** 建骨架并挂上控制器(与 src/main.ts 的调用顺序一致) */
function setupTabs(): SiteShell {
    document.body.innerHTML = '';
    const root = document.createElement('div');
    root.id = SITE_ROOT_ID;
    document.body.append(root);
    const shell = mountSiteShell();
    mountTabs({ list: shell.navList, links: shell.navLinks, panes: shell.panes });
    return shell;
}

/** 触发器的 href -> 元素(测试里按窗格 id 取,读起来比下标清楚) */
function linkFor(shell: SiteShell, pane: string): HTMLAnchorElement {
    const link = shell.navLinks.find((candidate) => candidate.getAttribute('href') === `#${pane}`);
    if (!link) throw new Error(`没有指向 #${pane} 的触发器`);
    return link;
}

/** 当前激活的窗格 id */
function activePane(shell: SiteShell): string | null {
    return shell.navLinks.find(
        (link) => link.classList.contains(NAV_ACTIVE_CLASS),
    )?.getAttribute('href')?.replace('#', '') ?? null;
}

/** 按一次键(事件从触发器冒泡到标签栏,与真实键盘路径一致) */
function pressKey(link: HTMLAnchorElement, key: string): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    link.dispatchEvent(event);
    return event;
}

describe('标签页:初始状态', () => {
    it('只有默认项是当前项,其余四项都不是', () => {
        const shell = setupTabs();
        expect(activePane(shell)).toBe(DEFAULT_NAV_PANE);
        for (const item of NAV_ITEMS) {
            expect(linkFor(shell, item.pane).classList.contains(NAV_ACTIVE_CLASS), item.pane)
                .toBe(item.pane === DEFAULT_NAV_PANE);
        }
    });

    it('挂上 tablist / tab / tabpanel 三个角色', () => {
        const shell = setupTabs();
        expect(shell.navList.getAttribute('role')).toBe('tablist');
        for (const item of NAV_ITEMS) {
            expect(linkFor(shell, item.pane).getAttribute('role'), item.pane).toBe('tab');
            expect(shell.panes[item.pane].getAttribute('role'), item.pane).toBe('tabpanel');
        }
    });

    it('aria-selected 与 roving tabindex 都对齐到当前项', () => {
        /*
          关键契约:非当前项被移出 Tab 顺序(`tabindex="-1"`),所以**必须**有方向键
          才能在标签之间走 -- 少了方向键,键盘用户只能停在当前标签上.
        */
        const shell = setupTabs();
        for (const item of NAV_ITEMS) {
            const link = linkFor(shell, item.pane);
            const active = item.pane === DEFAULT_NAV_PANE;
            expect(link.getAttribute('aria-selected'), item.pane).toBe(String(active));
            expect(link.getAttribute('tabindex'), item.pane).toBe(active ? null : '-1');
        }
    });

    it('默认窗格带着 .show(标记里就有的,不靠控制器补)', () => {
        const shell = setupTabs();
        expect(shell.panes[DEFAULT_NAV_PANE].classList.contains(TAB_PANE_SHOW_CLASS)).toBe(true);
        for (const item of NAV_ITEMS) {
            if (item.pane === DEFAULT_NAV_PANE) continue;
            expect(shell.panes[item.pane].classList.contains(TAB_PANE_SHOW_CLASS), item.pane)
                .toBe(false);
        }
    });
});

describe('标签页:点击', () => {
    it('点另一个触发器:active / show / aria-selected / tabindex 一起迁移', () => {
        const shell = setupTabs();
        linkFor(shell, 'ieee754').click();

        expect(activePane(shell)).toBe('ieee754');
        expect(linkFor(shell, 'ieee754').getAttribute('aria-selected')).toBe('true');
        expect(linkFor(shell, 'ieee754').getAttribute('tabindex')).toBeNull();
        expect(linkFor(shell, DEFAULT_NAV_PANE).getAttribute('aria-selected')).toBe('false');
        expect(linkFor(shell, DEFAULT_NAV_PANE).getAttribute('tabindex')).toBe('-1');

        expect(shell.panes.ieee754.classList.contains(NAV_ACTIVE_CLASS)).toBe(true);
        expect(shell.panes.ieee754.classList.contains(TAB_PANE_SHOW_CLASS)).toBe(true);
        expect(shell.panes[DEFAULT_NAV_PANE].classList.contains(NAV_ACTIVE_CLASS)).toBe(false);
        expect(shell.panes[DEFAULT_NAV_PANE].classList.contains(TAB_PANE_SHOW_CLASS)).toBe(false);
    });

    it('拦掉默认行为:触发器是 <a href="#窗格">,不能让它去改地址栏 hash', () => {
        const shell = setupTabs();
        const link = linkFor(shell, 'oled');
        // 控制器里的监听先注册,先执行;这里在它之后再挂一个,读 defaultPrevented 的结果
        let prevented: boolean | null = null;
        link.addEventListener('click', (event) => { prevented = event.defaultPrevented; });
        link.click();
        expect(prevented).toBe(true);
    });

    it('点已经是当前项的那一个:什么都不变(不重排,不掉 .show)', () => {
        const shell = setupTabs();
        const link = linkFor(shell, DEFAULT_NAV_PANE);
        const pane = shell.panes[DEFAULT_NAV_PANE];
        const before = pane.className;
        link.click();
        expect(pane.className).toBe(before);
        expect(activePane(shell)).toBe(DEFAULT_NAV_PANE);
    });

    it('切走再切回来,旧窗格恢复成 .show active', () => {
        const shell = setupTabs();
        linkFor(shell, 'rbt').click();
        linkFor(shell, DEFAULT_NAV_PANE).click();
        expect(activePane(shell)).toBe(DEFAULT_NAV_PANE);
        expect(shell.panes[DEFAULT_NAV_PANE].classList.contains(NAV_ACTIVE_CLASS)).toBe(true);
        expect(shell.panes[DEFAULT_NAV_PANE].classList.contains(TAB_PANE_SHOW_CLASS)).toBe(true);
        expect(shell.panes.rbt.classList.contains(NAV_ACTIVE_CLASS)).toBe(false);
        expect(shell.panes.rbt.classList.contains(TAB_PANE_SHOW_CLASS)).toBe(false);
    });
});

describe('标签页:方向键', () => {
    it('ArrowRight / ArrowLeft 前后移动,并环绕', () => {
        const shell = setupTabs();
        pressKey(linkFor(shell, DEFAULT_NAV_PANE), 'ArrowRight');
        expect(activePane(shell)).toBe(NAV_ITEMS[1].pane);

        pressKey(linkFor(shell, NAV_ITEMS[1].pane), 'ArrowLeft');
        expect(activePane(shell)).toBe(DEFAULT_NAV_PANE);

        // 从第一项往左环绕到最后一项
        pressKey(linkFor(shell, DEFAULT_NAV_PANE), 'ArrowLeft');
        expect(activePane(shell)).toBe(NAV_ITEMS[NAV_ITEMS.length - 1].pane);
    });

    it('ArrowDown / ArrowUp 与左右等价', () => {
        const shell = setupTabs();
        pressKey(linkFor(shell, DEFAULT_NAV_PANE), 'ArrowDown');
        expect(activePane(shell)).toBe(NAV_ITEMS[1].pane);
        pressKey(linkFor(shell, NAV_ITEMS[1].pane), 'ArrowUp');
        expect(activePane(shell)).toBe(DEFAULT_NAV_PANE);
    });

    it('Home / End 去首尾', () => {
        const shell = setupTabs();
        pressKey(linkFor(shell, DEFAULT_NAV_PANE), 'End');
        expect(activePane(shell)).toBe(NAV_ITEMS[NAV_ITEMS.length - 1].pane);
        pressKey(linkFor(shell, NAV_ITEMS[NAV_ITEMS.length - 1].pane), 'Home');
        expect(activePane(shell)).toBe(DEFAULT_NAV_PANE);
    });

    it('焦点跟着走(roving tabindex 的前提)', () => {
        const shell = setupTabs();
        const first = linkFor(shell, DEFAULT_NAV_PANE);
        first.focus();
        pressKey(first, 'ArrowRight');
        expect(document.activeElement).toBe(linkFor(shell, NAV_ITEMS[1].pane));
    });

    it('认方向键时才 preventDefault(否则页面滚动会被平白拦掉)', () => {
        const shell = setupTabs();
        const link = linkFor(shell, DEFAULT_NAV_PANE);
        // 认的键:拦掉(方向键默认会滚页面)
        expect(pressKey(link, 'ArrowRight').defaultPrevented).toBe(true);
        // 不认的键:不拦(交给浏览器,比如 Tab / Enter)
        expect(pressKey(link, 'Tab').defaultPrevented).toBe(false);
        expect(pressKey(link, 'a').defaultPrevented).toBe(false);
    });

    it('按键来自标签栏之外时不参与(不误吃外面的方向键)', () => {
        const shell = setupTabs();
        const outside = document.createElement('input');
        document.body.append(outside);
        const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
        outside.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(false);
        expect(activePane(shell)).toBe(DEFAULT_NAV_PANE);
    });
});

describe('标签页:接线错了要吵', () => {
    it('触发器数量与 NAV_ITEMS 不符时直接抛错', () => {
        document.body.innerHTML = '';
        const root = document.createElement('div');
        root.id = SITE_ROOT_ID;
        document.body.append(root);
        const shell = mountSiteShell();
        expect(() => mountTabs({
            list: shell.navList,
            links: shell.navLinks.slice(0, 2),
            panes: shell.panes,
        })).toThrow(TABS_MISMATCH_MESSAGE);
    });

    it('触发器顺序与窗格错位时直接抛错(而不是变成"点了没反应")', () => {
        document.body.innerHTML = '';
        const root = document.createElement('div');
        root.id = SITE_ROOT_ID;
        document.body.append(root);
        const shell = mountSiteShell();
        const shuffled = [...shell.navLinks].reverse();
        expect(() => mountTabs({ list: shell.navList, links: shuffled, panes: shell.panes }))
            .toThrow(TABS_MISMATCH_MESSAGE);
    });

    it('窗格缺失时直接抛错', () => {
        document.body.innerHTML = '';
        const root = document.createElement('div');
        root.id = SITE_ROOT_ID;
        document.body.append(root);
        const shell = mountSiteShell();
        const broken = { ...shell.panes } as Record<string, HTMLElement>;
        delete broken.oled;
        expect(() => mountTabs({
            list: shell.navList,
            links: shell.navLinks,
            panes: broken as unknown as typeof shell.panes,
        })).toThrow(TABS_MISMATCH_MESSAGE);
    });
});
