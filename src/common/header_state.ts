// ================================================================
// 导航条的"隐形 / 实底"状态
//
// 结论:**每个标签页**都一样 -- 导航条底下没有内容压着时它是**隐形**的
// (没有底色,没有边框,没有磨砂,只有站名与导航文字);一旦有内容滑到它下面,
// 立刻变实底.这是"首屏要覆盖整个屏幕"的直接结果:导航条必须离开文档流
// (position: fixed),否则首屏只能从它下沿开始,顶部那一条盖不住.代价是它盖在
// 内容上,于是必须知道"现在底下压着什么" -- 就是本模块的全部职责.
//
// "底下有没有内容"分两种情况,判据不同:
//
//   [HOME] 首屏(hero)本身就是内容,而且是一整屏画面,所以沿用原来那套:
//          首屏还压在导航条上时保持隐形(整个首屏滚过去之前都隐形),首屏底边
//          越过导航条下沿之后变实底.判据由 IntersectionObserver 给.
//   [别的标签页] 窗格顶部留了 --nav-height 的内边距(见 index.css 的 .tab-pane),
//          卡片正好从导航条下沿开始排,所以**页面在顶端时底下是空的**(只有全站
//          背景图),隐形;一滚动(scrollY > 0)卡片就压到导航条下面了,变实底.
//          判据由 window.scrollY 给.
//
// 两条判据取"或":任一条成立就隐形,于是 HOME 的行为与从前逐字一致,其它标签页
// 也拿到了同一套观感.切标签页不需要额外监听事件(src/common/tabs.ts 只改类名)--
// 首屏在非 HOME 窗格里是 display:none,它的观察结果自然是"不相交",由另一条判据接管.
//
// [为什么首屏那条用 IntersectionObserver 而不是 scroll 事件]
//   - scroll 每次滚动都要跑回调,还要读 layout,主线程白白多一份开销,
//     而且很容易写出"每帧都写 class"的抖动;
//   - IO 由浏览器在合成阶段算,回调只在状态**真的翻转**时触发一次.
//   这和 metro_window 用 IO 判"画布还在不在视口里"是同一个理由.
//
// [为什么滚动那条可以直接读 scrollY]
//   scrollY 是浏览器已经算好的滚动位置,读它**不触发布局重排**(这点与
//   getBoundingClientRect / getComputedStyle 不同);滚动事件本身也已按帧合并,
//   回调里只有一次 classList.toggle(值没变时是空操作),不必再套 rAF 节流.
//
// [rootMargin 为什么是 -导航条高度]
//   观察窗口是整个视口时,首屏要**完全**离开视口才会翻转,于是最后约一个
//   导航条高度的滚动距离里,文字是没有底色,又不在画面上("两头不靠")的.
//   把观察窗口的顶边下压一个导航条高度,翻转点就正好落在"首屏底边越过导航条
//   下沿"的那一刻 -- 也就是画面刚好不再给文字当背景的那一刻.
//   高度从 tokens.css 的令牌读,不在 JS 里再写一个数字.
//
// [默认状态]
//   默认(不加类)是**实底**:没有 JS,或拿不准底下有什么的时候必须可读;
//   只有确认底下是空的/是首屏画面时才切成隐形.
//
// [元素从哪来]
//   导航条与首屏都由 src/common/ui/site_shell.ts 生成,骨架把这两个元素的引用
//   交回来,本模块直接用 -- 不再按选择器/id 去 DOM 里找("找不到"这种失败
//   模式因此被整类消掉:拿不到引用就挂不上,不会出现"静默不生效").
// ================================================================

import {
    HEADER_OVER_HERO_CLASS,
    NAV_HEIGHT_FALLBACK,
    NAV_HEIGHT_VARIABLE,
} from '@/common/site.config';

/** 骨架交给本模块的两个元素 */
export interface HeaderStateTargets {
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
        // 页面在顶端:非 HOME 的窗格顶上只有全站背景图,卡片还在导航条下沿以下;
        // 一旦滚动(scrollY > 0)卡片就压上来了.用 <= 0 是为了吃掉橡皮筋回弹的负值.
        const pageAtTop = window.scrollY <= 0;
        header.classList.toggle(HEADER_OVER_HERO_CLASS, heroUnderHeader || pageAtTop);
    };

    const observer = new IntersectionObserver(
        (entries) => {
            const entry = entries[entries.length - 1];
            if (!entry) return;
            // 首屏还在观察窗口(导航条下沿以下)里 => 文字底下就是画面 => 隐形
            heroUnderHeader = entry.isIntersecting;
            sync();
        },
        { rootMargin: `-${navHeight()}px 0px 0px 0px` },
    );
    observer.observe(hero);

    window.addEventListener('scroll', sync, { passive: true });
    // 先按当前状态定一次:直接落在非 HOME 标签页(带 #pane 的地址)或滚动位置
    // 已经被浏览器恢复时,不必等第一次滚动.
    sync();
}

/**
 * 从 CSS 令牌读导航条高度(px).
 * 令牌是 `<length>`,用 parseFloat 取数值部分;读不到(自定义属性没定义)
 * 时回退到 NAV_HEIGHT_FALLBACK,不让导航条状态整个失效.
 */
function navHeight(): number {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(NAV_HEIGHT_VARIABLE);
    const value = Number.parseFloat(raw);
    return Number.isFinite(value) ? value : NAV_HEIGHT_FALLBACK;
}
