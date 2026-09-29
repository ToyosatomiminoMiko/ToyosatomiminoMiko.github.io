/**
 * SETTING 背景切换区的标记契约(进程内,跑在 happy-dom 里).
 *
 * 这一块的类名有一半是**行为契约**:`background.ts` 的点击委托先按 `.bgbtn` 命中
 * "被点的是哪一颗按钮",再从按钮里按 `.bgimg` 取出要切的那张图;另一半是布局与
 * 设置页样式:宿主**本身就是**那颗公共框体 `fieldset.setting-group`(见
 * setting_page.ts),组里那条 flex 行 `.bgrow` 把两颗缩略图与"页面透明度"滑块并排
 * 摆开.所以这里既断言结构,也断言"缩略图清单换了以后选择器照样命中".
 *
 * 挂载函数与设置页的分工也在这一层钉住:宿主必须是**空 fieldset**,挂载用
 * `replaceChildren` 整体接管(重复挂载不会插两份),且只碰内容不碰框体与 id.
 *
 * 委托本身的行为(点图 / 点文案各自切到哪一张)在 `background.test.ts`.
 *
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it } from 'vitest';

import {
    BACKGROUND_BUTTON_CLASS,
    BACKGROUND_GROUP_LEGEND,
    BACKGROUND_IMAGE_CLASS,
    BACKGROUND_PRESETS,
    BACKGROUND_ROW_CLASS,
    SETTING_GROUP_CLASS,
} from '@/setting/config';
import { mountBackgroundSection } from '@/setting/background_section';

/** 本次用例的宿主(设置页交回的那颗设置组)与挂载交回的行 */
let host: HTMLFieldSetElement;
let row: HTMLDivElement;

/** 建一颗空设置组并挂载一次(与 setting_page.ts + main.ts 的分工一致) */
function mount(): void {
    document.body.innerHTML = '';
    host = document.createElement('fieldset');
    host.className = SETTING_GROUP_CLASS;
    document.body.append(host);
    row = mountBackgroundSection(host);
}

beforeEach(mount);

describe('SETTING:背景切换区', () => {
    it('宿主就是设置组本身,内容只有 legend + 那条行(不抢整页面板的标题)', () => {
        // 宿主只带设置组类名:框体与 id 是设置页给的,挂载函数一个都不加
        expect([...host.classList]).toEqual([SETTING_GROUP_CLASS]);
        expect([...host.children].map((child) => child.tagName)).toEqual(['LEGEND', 'DIV']);
        // legend 是组标题;SETTING 页标题("设置")属于整页面板的 .ui-panel-header,
        // 不在这里出现第二份
        expect(host.querySelector(':scope > legend')?.textContent).toBe(BACKGROUND_GROUP_LEGEND);
        expect(host.querySelector('.ui-panel-header')).toBeNull();
        expect(host.querySelector('.ui-panel-title')).toBeNull();
        // 列表语义已撤:只有两颗并排的按钮,不再包一层 ul/li
        expect(host.querySelector('ul, li')).toBeNull();
    });

    it('组里是一条 flex 行,行的直接子节点就是各颗按钮(没有列表项夹在中间)', () => {
        expect(row).toBeInstanceOf(HTMLDivElement);
        expect([...row.classList]).toEqual([BACKGROUND_ROW_CLASS]);
        // 交回的就是组里那一条:页面透明度滑块按这个引用往行里追加
        expect(row.parentElement).toBe(host);
        expect(host.querySelector(`:scope > .${BACKGROUND_ROW_CLASS}`)).toBe(row);
        const children = [...row.children];
        expect(children).toHaveLength(BACKGROUND_PRESETS.length);
        for (const child of children) {
            expect(child.tagName, child.className).toBe('BUTTON');
            expect(child.classList.contains(BACKGROUND_BUTTON_CLASS), child.className).toBe(true);
        }
    });

    it('重复挂载不插两份(宿主是空 fieldset,挂载用 replaceChildren 整体接管)', () => {
        const firstRow = row;
        // 再挂一次:整组内容被替换掉,不是追加一份
        const secondRow = mountBackgroundSection(host);
        expect(host.querySelectorAll(`.${BACKGROUND_ROW_CLASS}`)).toHaveLength(1);
        expect(host.querySelectorAll('legend')).toHaveLength(1);
        expect(secondRow).not.toBe(firstRow);
        expect(host.querySelector(`.${BACKGROUND_ROW_CLASS}`)).toBe(secondRow);
    });

    it('每颗按钮都是库的按钮(基线 .ui-button + 本站 .bgbtn),type=button', () => {
        const buttons = [...host.querySelectorAll<HTMLButtonElement>(`button.${BACKGROUND_BUTTON_CLASS}`)];
        expect(buttons).toHaveLength(BACKGROUND_PRESETS.length);
        for (const button of buttons) {
            // 按钮本体归库:基线类由 createButton 补,本站的类只叠在它后面
            expect(button.classList.contains('ui-button'), button.className).toBe(true);
            // 显式 type 才不会在将来被塞进 <form> 时变成提交按钮
            expect(button.getAttribute('type')).toBe('button');
            // 按钮直接挂在行上:委托按 .bgbtn 命中它,取图也只往按钮里找
            expect(button.parentElement).toBe(row);
        }
    });

    it('每张缩略图的地址 / 类名 / 文案与清单一一对应', () => {
        const images = [...host.querySelectorAll(`img.${BACKGROUND_IMAGE_CLASS}`)];
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
        const image = host.querySelector(`.${BACKGROUND_IMAGE_CLASS}`);
        const button = host.querySelector(`.${BACKGROUND_BUTTON_CLASS}`);
        expect(button).toBeInstanceOf(HTMLButtonElement);
        // 点图(或点按钮自己的内边距)时,event.target.closest('.bgbtn') 都落到按钮上,
        // 取出要切的那张图就是按钮里的 .bgimg
        expect(image?.closest(`.${BACKGROUND_BUTTON_CLASS}`)).toBe(button);
        expect(button?.querySelector(`.${BACKGROUND_IMAGE_CLASS}`)).toBe(image);
    });

    it('行本身不是控件(点行上的空白不会落到任何一颗按钮里)', () => {
        expect(row.closest(`.${BACKGROUND_BUTTON_CLASS}`)).toBeNull();
    });

    it('组本身是常驻可操作的(挂载不设 disabled)', () => {
        expect(host).toBeInstanceOf(HTMLFieldSetElement);
        // 车窗那两块面板加载前是 disabled(等 WebGPU 就绪),背景组没有这个前置条件
        expect(host.disabled).toBe(false);
    });
});
