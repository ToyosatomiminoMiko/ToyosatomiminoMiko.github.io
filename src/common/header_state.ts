/**
 * 导航条的"隐形 / 实底"状态.
 *
 * 导航条是 position: fixed,所以它压在内容上,必须自己判断"底下有没有内容":
 * 底下是空的(或只有首屏画面)就隐形 -- 没有底色,边框,磨砂,只剩站名与导航文字;
 * 一旦有内容滑到它下面立刻变实底.首屏要盖满整屏,导航条就不能占位,这是代价.
 *
 * "底下有没有内容"每个标签页的判据不同:
 *   - HOME:首屏本身就是内容.首屏底边越过导航条下沿之前都隐形,之后变实底,
 *     判据由 IntersectionObserver 给;
 *   - 其它标签页:窗格顶部留了 --nav-height 的内边距(见 index.css 的 .tab-pane),
 *     卡片从导航条下沿开始排,所以页面停在顶端时底下只有背景图,隐形;
 *     一滚动(scrollY > 0)卡片就压上来,变实底,判据由 window.scrollY 给.
 * 两条判据取"或":任一成立就隐形.切标签页不需要额外监听 -- 首屏在非 HOME 窗格里是
 * display: none,观察结果自然是"不相交",由 scrollY 那条接管.
 *
 * 首屏那条用 IntersectionObserver 而不是 scroll 事件:IO 由浏览器在合成阶段算,
 * 只在状态真的翻转时回调一次;scroll 每条都要跑回调并读布局.滚动那条则可以直接读
 * scrollY -- 它是浏览器已算好的值,读它不触发重排,且滚动事件本身已按帧合并,
 * 回调里只有一次 classList.toggle(值没变时是空操作),不必再套 rAF 节流.
 *
 * 默认(不加类)是实底:没有 JS,或拿不准底下有什么的时候,文字必须可读.
 *
 * 导航条与首屏的元素引用由 src/common/ui/site_shell.ts 生成骨架时交回,
 * 本模块不按选择器去 DOM 里找 -- 拿不到引用就挂不上,不会静默失效.
 */

import {
    HEADER_OVER_HERO_CLASS,
    NAV_HEIGHT_FALLBACK,
    NAV_HEIGHT_VARIABLE,
} from '@/common/site.config';

/** 骨架交给本模块的两个元素 */
interface HeaderStateTargets {
    /** 导航条(header.site-header) */
    readonly header: HTMLElement;
    /** 首屏(section.hero#hero;只有 HOME 窗格里有,别的标签页里它被隐藏) */
    readonly hero: HTMLElement;
}

/** 挂载导航条状态(site_shell 生成骨架后由 src/main.ts 调用一次) */
export function mountHeaderState({ header, hero }: HeaderStateTargets): void {
    // 首屏是否还压在导航条下沿以下(只有 HOME 成立:别的标签页里首屏 display:none,
    // 交集为空,这个值自然是 false).
    let heroUnderHeader = false;

    /** 两条判据取"或",写进 .is-over-hero(隐形态) */
    const sync = (): void => {
        // 用 <= 0 而不是 === 0:吃掉橡皮筋回弹时的负值
        const pageAtTop = window.scrollY <= 0;
        header.classList.toggle(HEADER_OVER_HERO_CLASS, heroUnderHeader || pageAtTop);
    };

    // rootMargin 下压一个导航条高度:观察窗口是整个视口时,首屏要完全离开视口才翻转,
    // 于是最后约一个导航条高度的滚动距离里文字"两头不靠"(没底色,也不在画面上).
    // 下压之后翻转点正好落在"首屏底边越过导航条下沿"的那一刻.
    // 高度从 tokens.css 的令牌读,不在 JS 里再写一个数字.
    const observer = new IntersectionObserver(
        (entries) => {
            const entry = entries[entries.length - 1];
            if (!entry) return;
            heroUnderHeader = entry.isIntersecting;
            sync();
        },
        { rootMargin: `-${navHeight()}px 0px 0px 0px` },
    );
    observer.observe(hero);

    window.addEventListener('scroll', sync, { passive: true });
    // 先按当前状态定一次:地址里带着 #pane 直接落到非 HOME 标签页,或浏览器已恢复
    // 滚动位置时,不必等第一次滚动.
    sync();
}

/**
 * 从 CSS 令牌读导航条高度(px).令牌是 `<length>`,用 parseFloat 取数值部分;
 * 读不到(自定义属性没定义)时回退到 NAV_HEIGHT_FALLBACK,不让导航条状态整个失效.
 */
function navHeight(): number {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(NAV_HEIGHT_VARIABLE);
    const value = Number.parseFloat(raw);
    return Number.isFinite(value) ? value : NAV_HEIGHT_FALLBACK;
}
