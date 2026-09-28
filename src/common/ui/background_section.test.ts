/**
 * SETTING 背景切换区的标记契约(进程内,跑在 happy-dom 里).
 *
 * 这一块的类名有一半是**行为契约**:`common/background.ts` 的点击委托先按
 * `.bgbtn` 命中"被点的是哪一颗按钮",再从按钮里按 `.bgimg` 取出要切的那张图;
 * 另一半是 CSS(`.bgul` 的 flow-root,`.bgli` 的浮动,`.bgbtn` / `.bgimg` 的盒子).
 * 所以这里既断言结构,也断言"缩略图清单换了以后选择器照样命中".
 *
 * 委托本身的行为(点图 / 点文案各自切到哪一张)在 `common/background.test.ts`.
 *
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from 'vitest';

import {
    BACKGROUND_BUTTON_CLASS,
    BACKGROUND_IMAGE_CLASS,
    BACKGROUND_ITEM_CLASS,
    BACKGROUND_LIST_CLASS,
    BACKGROUND_PRESETS,
} from '@/common/site.config';
import { createBackgroundSection } from '@/common/ui/background_section';

/** 把背景区节点插进 body,返回容器(组件只造节点,不负责挂载) */
function render(): HTMLElement {
    document.body.innerHTML = '';
    const container = document.createElement('div');
    container.append(createBackgroundSection());
    document.body.append(container);
    return container;
}

describe('SETTING:背景切换区', () => {
    it('只交出一个 ul(SETTING 的标题属于整页面板的 .ui-panel-header,不在这里)', () => {
        const container = render();
        expect([...container.children].map((child) => child.tagName)).toEqual(['UL']);
        expect(container.querySelector('.ui-panel-header')).toBeNull();
        expect(container.querySelector('.ui-panel-title')).toBeNull();
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

    it('每项是一颗库的按钮(基线 .ui-button + 本站 .bgbtn),type=button', () => {
        const container = render();
        const buttons = [...container.querySelectorAll(`li.${BACKGROUND_ITEM_CLASS} > button`)];
        expect(buttons).toHaveLength(BACKGROUND_PRESETS.length);
        for (const button of buttons) {
            // 按钮本体归库:基线类由 createButton 补,本站的类只叠在它后面
            expect(button.classList.contains('ui-button'), button.className).toBe(true);
            expect(button.classList.contains(BACKGROUND_BUTTON_CLASS), button.className).toBe(true);
            // 显式 type 才不会在将来被塞进 <form> 时变成提交按钮
            expect(button.getAttribute('type')).toBe('button');
        }
    });

    it('每张缩略图的地址 / 类名 / 文案与清单一一对应', () => {
        const container = render();
        const images = [...container.querySelectorAll(`img.${BACKGROUND_IMAGE_CLASS}`)];
        expect(images).toHaveLength(BACKGROUND_PRESETS.length);
        images.forEach((image, index) => {
            const preset = BACKGROUND_PRESETS[index];
            expect(image.getAttribute('src'), preset.label).toBe(preset.src);
            // 缩略图只有站点自己的那一个类,圆角写在 .bgimg 规则里
            expect(image.className, preset.label).toBe(BACKGROUND_IMAGE_CLASS);
            // 图名由按钮本身的文案报给读屏,图片本身是装饰性的(alt="")
            expect(image.getAttribute('alt'), preset.label).toBe('');
            // 图在按钮里面:委托命中按钮后再取它,所以祖先必须正好是那颗按钮
            const button = image.parentElement;
            expect(button?.tagName, preset.label).toBe('BUTTON');
            expect(button?.classList.contains(BACKGROUND_BUTTON_CLASS), preset.label).toBe(true);
            // 可访问名 = 按钮的文字(图在前,文案在后)
            expect(button?.textContent, preset.label).toBe(preset.label);
        });
    });

    it('background.ts 的委托选择器(.bgbtn)命中的是按钮本身', () => {
        const container = render();
        const image = container.querySelector(`.${BACKGROUND_IMAGE_CLASS}`);
        const button = container.querySelector(`.${BACKGROUND_BUTTON_CLASS}`);
        expect(button).toBeInstanceOf(HTMLButtonElement);
        // 点图(或点按钮自己的内边距)时,event.target.closest('.bgbtn') 都落到按钮上,
        // 取出要切的那张图就是按钮里的 .bgimg
        expect(image?.closest(`.${BACKGROUND_BUTTON_CLASS}`)).toBe(button);
        expect(button?.querySelector(`.${BACKGROUND_IMAGE_CLASS}`)).toBe(image);
    });
});
