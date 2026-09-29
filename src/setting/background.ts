/**
 * 背景切换:点 SETTING 标签页的缩略图,换整站背景图.
 *
 * 整站背景图只有一处真值:文档根上的 CSS 自定义属性 `--bg-image-active`
 * (默认值在 public/css/tokens.css,消费方是 index.css 的 body 规则).
 * 点缩略图只改写这一个令牌,所以 JS 侧不存状态,也就没有"状态与画面不一致".
 *
 * 监听落在 document 上,不逐张绑到缩略图:这样增删缩略图(标记由
 * background_section.ts 生成,整组会被换掉),或面板被重建,都不用重新挂监听.
 */

import {
    BACKGROUND_BUTTON_CLASS,
    BACKGROUND_IMAGE_CLASS,
    BACKGROUND_IMAGE_VARIABLE,
} from '@/setting/config';

/** 缩略图按钮选择器:命中的元素就是被点的那块 tile */
const BUTTON_SELECTOR = `.${BACKGROUND_BUTTON_CLASS}`;

/**
 * CSS `url()` 的引号.地址来自 img.src,通常没有空格或括号,
 * 但带引号才符合 <url> 语法,也不会被文件名里的特殊字符截断.
 */
const URL_QUOTE = '"';

/** 挂载背景切换(站点入口 main.ts 在 DOMContentLoaded 时调用一次) */
export function mountBackgroundSwitcher(): void {
    document.addEventListener('click', (event) => {
        const source = findThumbnailSource(event.target);
        if (!source) return;
        setActiveBackgroundImage(source);
    });
}

/**
 * 从事件目标向上找最近的缩略图按钮,再取出它里面那张图的地址;不在按钮里返回 null.
 *
 * 找的是按钮而不是 `<img>`:缩略图整块包在一颗库按钮里(见 background_section.ts),
 * 被点的可能是图,也可能是按钮自己的文案 / 内边距 / 描边.只认 `<img>` 的话,
 * 点文案就静默无效.
 */
function findThumbnailSource(target: EventTarget | null): string | null {
    if (!(target instanceof Element)) return null;
    const button = target.closest(BUTTON_SELECTOR);
    if (button === null) return null;
    const image = button.querySelector(`.${BACKGROUND_IMAGE_CLASS}`);
    if (!(image instanceof HTMLImageElement)) return null;
    return image.currentSrc || image.src;
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
