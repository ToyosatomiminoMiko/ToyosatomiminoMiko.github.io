/**
 * 背景切换的点击委托(见 `common/background.ts`).
 *
 * 缩略图整块是一颗库的按钮之后,"被点的"可能是那张 `<img>`,也可能是按钮自己
 * (文案 / 内边距 / 描边).委托必须按**按钮**命中,再从按钮里取出那张图 --
 * 只认 `<img>` 的话,点文案就静默失效,而且不会报错.这里把这三种目标各点一次.
 *
 * 真浏览器里的同一件事(整块 tile 可聚焦 / 点下去背景真的换)由
 * `scripts/smoke_home.mjs` 兜,那层要 dist 与 chromium;这里只钉"委托命中了谁".
 *
 * @vitest-environment happy-dom
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { mountBackgroundSwitcher } from '@/common/background';
import { BACKGROUND_IMAGE_VARIABLE, BACKGROUND_ROW_CLASS } from '@/common/site.config';
import { createBackgroundSection } from '@/common/ui/background_section';

/** 当前写进文档根的那张背景图(没写过时是空串) */
function activeBackground(): string {
    return document.documentElement.style.getPropertyValue(BACKGROUND_IMAGE_VARIABLE);
}

/** 与 background.ts 写入的格式一致:带引号的 url() */
function backgroundValue(source: string): string {
    return `url("${source}")`;
}

/** 本次挂载出来的缩略图按钮(顺序即 BACKGROUND_PRESETS 的顺序) */
function buttons(): HTMLButtonElement[] {
    return [...document.querySelectorAll<HTMLButtonElement>('button.bgbtn')];
}

/**
 * 第 `index` 颗按钮里那张图的地址.
 *
 * 直接读 `img.src` 而不是 BACKGROUND_PRESETS:DOM 上的 `src` 是**解析后的绝对地址**
 * (`background.ts` 取的就是它),拿声明里的 `/images/...` 比会在 happy-dom 的
 * base(`http://localhost:3000/`)上对不上.
 */
function thumbnailSource(index: number): string {
    const image = buttons()[index]?.querySelector('img');
    if (!(image instanceof HTMLImageElement)) throw new Error(`第 ${index} 颗按钮里没有缩略图`);
    return image.src;
}

describe('背景切换的点击委托', () => {
    /*
      委托挂在 document 上,而且没有退订接口(页面只在 main.ts 里挂一次),
      所以这里也只挂一次:每次 beforeEach 挂一份会让后面的点击叠加好几层监听.
    */
    beforeAll(() => {
        mountBackgroundSwitcher();
    });

    beforeEach(() => {
        document.body.innerHTML = '';
        document.documentElement.style.removeProperty(BACKGROUND_IMAGE_VARIABLE);
        document.body.append(createBackgroundSection());
    });

    it('点缩略图本身切到那一张', () => {
        const source = thumbnailSource(1);
        buttons()[1].querySelector('img')?.click();
        expect(activeBackground()).toBe(backgroundValue(source));
    });

    it('点按钮自己(文案 / 内边距)也切到那一张', () => {
        const source = thumbnailSource(0);
        buttons()[0].click();
        expect(activeBackground()).toBe(backgroundValue(source));
    });

    it('点行上的空白处(不在按钮里)不改背景', () => {
        document.querySelector<HTMLElement>(`.${BACKGROUND_ROW_CLASS}`)?.click();
        expect(activeBackground()).toBe('');
    });
});
