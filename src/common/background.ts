// ================================================================
// 背景切换(SETTING 标签页的缩略图 -> 整站背景图)
//
// 结论:整站背景图只能有一个"真值来源".现在这个来源是 CSS 自定义属性
// `--bg-image-active`(默认值在 tokens.css, 消费方是 index.css 的 body 规则),
// 点击缩略图只改写这一个令牌.
//
// [旧实现为什么会反复失效]
// 旧代码是 `document.body.style.cssText = "background-image: <url> !important"`:
//   - 内联 `!important` 的唯一意义是压过样式表里那条 `!important`, 属于层叠战争;
//     body 的 background-image 因此有两个作者(样式表 !important + 内联 !important),
//     谁最后写谁赢.任何第三方(扩展注入, 别的组件)补一次内联就把它静默夺走,
//     页面显示的背景与 JS 以为的状态从此不一致, 而且不会有任何报错;
//   - `style.cssText=` 是整体覆盖, 会连带抹掉别人写在 body 上的内联样式
//     (Dark Reader 的 `--darkreader-inline-*`, 滚动锁的 padding-right 等);
//   - 缩略图在 DOMContentLoaded 时逐个 addEventListener, 面板一旦动态重建就掉监听.
//
// [现在的做法]
//   - 点击 -> documentElement.style.setProperty('--bg-image-active', url(缩略图));
//   - 样式表侧不写 `!important`:站内唯一的竞争者是 * 的 background: none, 权重更低,
//     天然被压过;对外不再和浏览器扩展抢 body 的内联样式, 深色模式交给用户自己的
//     Dark Reader 选择;
//   - 监听委托到 document, 增删 / 重建缩略图都不会掉.
// 这也是 README "CSS 一律用自定义属性引用" 的直接应用.
// ================================================================

import { BACKGROUND_IMAGE_CLASS, BACKGROUND_IMAGE_VARIABLE } from '@/common/site.config';

/** 缩略图选择器:命中的最内层元素就是被点的背景缩略图 */
const THUMBNAIL_SELECTOR = `.${BACKGROUND_IMAGE_CLASS}`;

/**
 * CSS `url()` 的引号.URL 来自 img.src,虽然通常没有空格 / 括号,
 * 但带上引号才符合 <url> 的书写规范,也不会被文件名里的特殊字符截断.
 */
const URL_QUOTE = '"';

/** 挂载背景切换(站点入口 main.ts 在 DOMContentLoaded 时调用一次) */
export function mountBackgroundSwitcher(): void {
    document.addEventListener('click', (event) => {
        const thumbnail = findThumbnail(event.target);
        if (!thumbnail) return;
        setActiveBackgroundImage(thumbnail.currentSrc || thumbnail.src);
    });
}

/** 从事件目标向上找最近的背景缩略图;点击目标不是缩略图时返回 null */
function findThumbnail(target: EventTarget | null): HTMLImageElement | null {
    if (!(target instanceof Element)) return null;
    const hit = target.closest(THUMBNAIL_SELECTOR);
    return hit instanceof HTMLImageElement ? hit : null;
}

/**
 * 把背景图写到文档根的自定义属性上.
 * 优先用 currentSrc:srcset 命中时它才是浏览器真正选中的那张,
 * src 只是没有 srcset 时的回退.
 */
function setActiveBackgroundImage(imageUrl: string): void {
    document.documentElement.style.setProperty(
        BACKGROUND_IMAGE_VARIABLE,
        `url(${URL_QUOTE}${imageUrl}${URL_QUOTE})`,
    );
}
