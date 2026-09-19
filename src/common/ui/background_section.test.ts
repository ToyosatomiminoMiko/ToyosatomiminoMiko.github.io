/**
 * SETTING 背景切换区的标记契约(进程内,跑在 happy-dom 里).
 *
 * 这一块的类名有一半是**行为契约**:`common/background.ts` 的点击委托用
 * `.bgimg` 找"被点的是哪张背景";另一半是 CSS(`.bgul` / `.bgli` / `.bgimg`
 * 的尺寸与浮动).所以这里既断言结构,也断言"缩略图清单换了以后选择器照样命中".
 *
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from 'vitest';

import {
    BACKGROUND_IMAGE_CLASS,
    BACKGROUND_IMAGE_ROUNDED_CLASS,
    BACKGROUND_ITEM_CLASS,
    BACKGROUND_LIST_CLASS,
    BACKGROUND_PRESETS,
    BACKGROUND_SECTION_TITLE,
} from '@/common/site.config';
import { createBackgroundSection } from '@/common/ui/background_section';

/** 把整块背景区插进 body,返回容器(组件只造节点,不负责挂载) */
function render(): HTMLElement {
    document.body.innerHTML = '';
    const container = document.createElement('div');
    container.append(...createBackgroundSection());
    document.body.append(container);
    return container;
}

describe('SETTING:背景切换区', () => {
    it('是"标题 + 列表"两块,标题文案来自 config', () => {
        const container = render();
        expect([...container.children].map((child) => child.tagName)).toEqual(['H4', 'UL']);
        expect(container.querySelector('h4')?.textContent).toBe(BACKGROUND_SECTION_TITLE);
    });

    it('列表与列表项用 CSS 约定的类名', () => {
        const container = render();
        const list = container.querySelector(`ul.${BACKGROUND_LIST_CLASS}`);
        expect(list).not.toBeNull();
        expect(list?.children).toHaveLength(BACKGROUND_PRESETS.length);
        for (const item of [...(list?.children ?? [])]) {
            expect(item.tagName).toBe('LI');
            expect(item.className).toBe(BACKGROUND_ITEM_CLASS);
        }
    });

    it('每张缩略图的地址 / 类名 / 文案与清单一一对应', () => {
        const container = render();
        const images = [...container.querySelectorAll(`img.${BACKGROUND_IMAGE_CLASS}`)];
        expect(images).toHaveLength(BACKGROUND_PRESETS.length);
        images.forEach((image, index) => {
            const preset = BACKGROUND_PRESETS[index];
            expect(image.getAttribute('src'), preset.label).toBe(preset.src);
            expect(image.className, preset.label)
                .toBe(`${BACKGROUND_IMAGE_ROUNDED_CLASS} ${BACKGROUND_IMAGE_CLASS}`);
            // 图名由紧邻的 span 报给读屏,图片本身是装饰性的(alt="")
            expect(image.getAttribute('alt'), preset.label).toBe('');
            expect(image.nextElementSibling?.textContent, preset.label).toBe(preset.label);
        });
    });

    it('background.ts 的点击委托选择器(.bgimg 的最近祖先)能命中缩略图', () => {
        const container = render();
        const image = container.querySelector(`.${BACKGROUND_IMAGE_CLASS}`);
        // 委托里是 event.target.closest('.bgimg'),所以命中的必须就是 <img> 本身
        expect(image?.closest(`.${BACKGROUND_IMAGE_CLASS}`)).toBe(image);
        expect(image).toBeInstanceOf(HTMLImageElement);
    });
});
