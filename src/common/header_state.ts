// ================================================================
// 导航条的"透明 / 实底"状态
//
// 结论:导航条压在首屏(hero)画面上时是**隐形**的 -- 没有底色,没有边框,
// 没有磨砂,只有站名与导航文字;首屏滚过去(或切到别的标签页)之后变实底.
//
// 这是"首屏要覆盖整个屏幕"的直接结果:导航条必须离开文档流(position: fixed),
// 否则首屏只能从它下沿开始,顶部那一条盖不住.代价是它盖在内容上,于是必须
// 知道"现在底下是不是首屏画面" -- 就是本模块的全部职责.
//
// [为什么用 IntersectionObserver 而不是 scroll 事件]
//   - scroll 每次滚动都要跑回调,还要读 layout,主线程白白多一份开销,
//     而且很容易写出"每帧都写 class"的抖动;
//   - IO 由浏览器在合成阶段算,回调只在状态**真的翻转**时触发一次.
//   这和 metro_window 用 IO 判"画布还在不在视口里"是同一个理由.
//
// [rootMargin 为什么是 -导航条高度]
//   观察窗口是整个视口时,首屏要**完全**离开视口才会翻转,于是最后约一个
//   导航条高度的滚动距离里,文字是没有底色,又不在画面上("两头不靠")的.
//   把观察窗口的顶边下压一个导航条高度,翻转点就正好落在"首屏底边越过导航条
//   下沿"的那一刻 -- 也就是画面刚好不再给文字当背景的那一刻.
//   高度从 tokens.css 的令牌读,不在 JS 里再写一个数字.
//
// [默认状态]
//   默认(不加类)是**实底**:没有 JS,或不在首屏上时必须可读;只有确认压在
//   首屏画面上时才切成透明.宁可多一条底色,也不要一片读不出来的字.
// ================================================================

import {
    HEADER_OVER_HERO_CLASS,
    HEADER_SELECTOR,
    HEADER_STATE_MISSING_MESSAGE,
    HERO_ID,
    NAV_HEIGHT_FALLBACK,
    NAV_HEIGHT_VARIABLE,
} from '@/common/site.config';

/** 挂载导航条状态(站点入口 main.ts 在 DOMContentLoaded 时调用一次) */
export function mountHeaderState(): void {
    const header = document.querySelector<HTMLElement>(HEADER_SELECTOR);
    const hero = document.getElementById(HERO_ID);
    if (!header || !hero) {
        throw new Error(HEADER_STATE_MISSING_MESSAGE);
    }

    const observer = new IntersectionObserver(
        (entries) => {
            const entry = entries[entries.length - 1];
            if (!entry) return;
            // 首屏还在观察窗口(导航条下沿以下)里 => 文字底下就是画面 => 隐形
            header.classList.toggle(HEADER_OVER_HERO_CLASS, entry.isIntersecting);
        },
        { rootMargin: `-${navHeight()}px 0px 0px 0px` },
    );
    // 切到别的标签页时 #home 是 display:none,交集为空 => 自动回到实底,
    // 不需要额外监听 bootstrap 的标签页事件.
    observer.observe(hero);
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
