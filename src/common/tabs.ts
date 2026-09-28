// ================================================================
// 标签页:点击 / 键盘 / 显隐
//
// 这一层原先整个是 bootstrap 的标签页插件提供的(`data-bs-toggle="tab"` 的
// data-api + 文档级事件委托).bootstrap 移除后收进站点自己,行为逐条对齐.
//
// [它到底做了什么] -- 也就是必须原样接管的全部:
//   1. **点击触发器**:`preventDefault()`(地址栏的 hash 不变,页面也不按锚点跳),
//      旧项摘 `.active`,新项加 `.active`;
//   2. **淡入**:新窗格加 `.active` 时只上屏(display: block)还不透明 --
//      `public/css/index.css` 的 `.tab-pane.fade:not(.show) { opacity: 0 }`
//      让它停在 0,下一帧补上 `.show` 才过渡到 1.所以"加 .active" 与
//      "加 .show" 之间必须隔一次重排,否则浏览器把两次改动并进同一次样式计算,
//      过渡不会发生(观感上就是硬切);
//   3. **ARIA**:容器是 tablist,触发器是 tab,窗格是 tabpanel;触发器用
//      roving tabindex -- 只有当前项留在 Tab 顺序里,其余 `tabindex="-1"`;
//   4. **方向键 / Home / End**:在触发器之间移动并立刻切换.这一条不是装饰:
//      有了 roving tabindex 却不实现方向键,非当前标签页就成了键盘**完全够不到**
//      的死区.
//
// [为什么不写 `data-*` 再靠委托] bootstrap 必须靠文档级委托,所以它要求在标记里
// 写 `data-bs-toggle="tab"` 让它的选择器认出触发器 -- 属性名写错就是"点不动"
// 这种静默失效.现在骨架生成时就把触发器的**元素引用**交回来了(site_shell.ts),
// 直接绑在触发器上即可,少一个跨文件的字面量契约.
//
// [为什么可以没有"当前项"这个变量] 当前项就是"哪个触发器带 `.active`" --
// 骨架按 DEFAULT_NAV_PANE 写好初始类名,之后每次切换都同时改类名与 ARIA.
// 状态只有 DOM 一份,不存在"变量与 DOM 不一致"的中间态.
// ================================================================

import {
    NAV_ACTIVE_CLASS,
    NAV_ITEMS,
    TAB_PANE_SHOW_CLASS,
    type NavPaneId,
} from '@/common/site.config';

/**
 * 骨架交给本模块的东西(与 header_state.ts 的 HeaderStateTargets 同一约定:
 * 消费者声明自己要什么,site_shell 把引用给过来,双方都不按 id 查 DOM).
 */
export interface TabsTargets {
    /** 标签栏容器(ul.nav.nav-tabs):`role=tablist` 挂在这里,方向键也在这里收 */
    readonly list: HTMLElement;
    /** 触发器,顺序与 site.config.ts 的 NAV_ITEMS 一致 */
    readonly links: readonly HTMLAnchorElement[];
    /** 窗格:pane id -> 元素(OLED / RBT / IEEE754 直接把窗格当模块宿主) */
    readonly panes: Readonly<Record<NavPaneId, HTMLElement>>;
}

/**
 * 触发器与窗格对不上时的报错文案.
 * 骨架是"按 NAV_ITEMS 依次生成 li > a[href=#pane] + 同 id 窗格"的,所以两边
 * 天然一一对应;真对不上就是骨架改了而这里没跟上 -- 那时宁可启动即报错,
 * 也不要留下几个点不动的标签页(静默失效比报错难查得多).
 */
export const TABS_MISMATCH_MESSAGE =
    '标签栏的触发器与窗格对不上:site_shell.ts 生成的结构与 site.config.ts 的 NAV_ITEMS 不同步';

/** role 取值只有本模块用,没有第二处引用,所以就地写成常量 */
const ROLE_TABLIST = 'tablist';
const ROLE_TAB = 'tab';
const ROLE_TABPANEL = 'tabpanel';

/** 一个"触发器 + 它指向的窗格" */
interface TabPair {
    readonly link: HTMLAnchorElement;
    readonly pane: HTMLElement;
}

/** 挂载标签页行为(site_shell 生成骨架后由 src/main.ts 调用一次) */
export function mountTabs({ list, links, panes }: TabsTargets): void {
    const pairs = pairTargets(links, panes);

    // 静态角色 + 把初始的当前项对齐到 ARIA(`.active` 由骨架写好,
    // 这里不碰窗格的 `.show` -- 默认窗格在标记里就带着它,没有"淡入"可言).
    list.setAttribute('role', ROLE_TABLIST);
    for (const pair of pairs) {
        pair.link.setAttribute('role', ROLE_TAB);
        pair.pane.setAttribute('role', ROLE_TABPANEL);
        applyState(pair, isActive(pair));
    }

    /** 切到某一项;点/选中的已经是当前项时是空操作(bootstrap 同样直接返回) */
    const show = (next: TabPair): void => {
        if (isActive(next)) return;
        activate(pairs, next);
    };

    for (const pair of pairs) {
        pair.link.addEventListener('click', (event) => {
            // 触发器是 `<a href="#窗格">`:不拦的话浏览器会改地址栏 hash,
            // 并按锚点把页面滚过去(bootstrap 的 data-api 对 A/AREA 同样拦掉).
            event.preventDefault();
            show(pair);
        });
    }

    list.addEventListener('keydown', (event) => {
        // event.target 而不是 document.activeElement:键事件本来就派给聚焦的
        // 触发器,拿它的引用更直接,也不必担心焦点被别处抢走.
        const index = pairs.findIndex((pair) => pair.link === event.target);
        if (index < 0) return;
        const next = indexForKey(event.key, index, pairs.length);
        if (next === null) return;
        // 方向键默认会滚动页面,必须拦掉;stopPropagation 与 bootstrap 一致
        // (免得外层再拿方向键做别的事).
        event.preventDefault();
        event.stopPropagation();
        // 先移焦点再切换:roving tabindex 要跟着焦点走,顺序反了会让焦点留在
        // 一个 `tabindex="-1"` 的元素上.
        pairs[next].link.focus();
        show(pairs[next]);
    });
}

/**
 * 把 `links` 与 `panes` 配成"触发器 + 窗格".
 * 配对关系来自 NAV_ITEMS(骨架就是按它 map 出来的),href 再核一遍:
 * 顺序错位这类问题在这里立刻炸出来,而不是变成"点了没反应".
 */
function pairTargets(
    links: readonly HTMLAnchorElement[],
    panes: Readonly<Record<NavPaneId, HTMLElement>>,
): readonly TabPair[] {
    if (links.length !== NAV_ITEMS.length) {
        throw new Error(TABS_MISMATCH_MESSAGE);
    }
    return links.map((link, index) => {
        const paneId = NAV_ITEMS[index].pane;
        if (link.getAttribute('href') !== `#${paneId}`) {
            throw new Error(TABS_MISMATCH_MESSAGE);
        }
        const pane = panes[paneId];
        if (!pane) {
            throw new Error(TABS_MISMATCH_MESSAGE);
        }
        return { link, pane };
    });
}

/** 当前项 = 带 `.active` 的触发器(状态只有 DOM 这一份) */
function isActive(pair: TabPair): boolean {
    return pair.link.classList.contains(NAV_ACTIVE_CLASS);
}

/**
 * 把"当前 / 非当前"写到类名与 ARIA 上,但**不碰窗格的 `.show`** --
 * `.show` 的加减是切换时的时序问题,见 activate().
 */
function applyState(pair: TabPair, active: boolean): void {
    pair.link.classList.toggle(NAV_ACTIVE_CLASS, active);
    pair.link.setAttribute('aria-selected', String(active));
    // roving tabindex:当前项回到自然 Tab 顺序,其余移出
    if (active) {
        pair.link.removeAttribute('tabindex');
    } else {
        pair.link.setAttribute('tabindex', '-1');
    }
    pair.pane.classList.toggle(NAV_ACTIVE_CLASS, active);
}

/**
 * 切换:新窗格先 `display: block`(靠 `.active`)但停在透明,强制一次重排之后
 * 再补 `.show` 让它真的淡入.
 */
function activate(pairs: readonly TabPair[], next: TabPair): void {
    for (const pair of pairs) {
        applyState(pair, pair === next);
        if (pair !== next) {
            // 旧窗格连 `.show` 一起摘掉.它的 display 已经是 none,留着 `.show`
            // 看不出问题,但下次切回来时"上一帧就带着 opacity: 1",淡入会失效.
            pair.pane.classList.remove(TAB_PANE_SHOW_CLASS);
        }
    }
    // 读一次布局属性强制重排,把"display: block + opacity: 0"这一帧先落地;
    // 少了它,下面那行 `.show` 会和上面的 `.active` 合并成一次样式计算.
    void next.pane.offsetHeight;
    next.pane.classList.add(TAB_PANE_SHOW_CLASS);
}

/**
 * 键 -> 下一个触发器的下标;不是本模块关心的键时返回 null.
 * 取值与 bootstrap 一致:左右上下环绕,Home / End 去首尾.
 */
function indexForKey(key: string, index: number, count: number): number | null {
    switch (key) {
        case 'ArrowLeft':
        case 'ArrowUp':
            return (index - 1 + count) % count;
        case 'ArrowRight':
        case 'ArrowDown':
            return (index + 1) % count;
        case 'Home':
            return 0;
        case 'End':
            return count - 1;
        default:
            return null;
    }
}
