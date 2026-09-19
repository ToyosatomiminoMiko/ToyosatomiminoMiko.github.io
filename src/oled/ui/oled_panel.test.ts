/**
 * OLED 画板的标记契约(进程内,跑在 happy-dom 里).
 *
 * 面板原先写在 index.html 的 `#oled` 窗格里,再由 oled.ts 按 id 一个个取回;
 * 现在标记由 `ui/oled_panel.ts` 生成并把引用交回.这里断言两件事:
 *
 *   1) `public/css/index.css` 与 bootstrap 用到的选择器全部命中
 *      (`canvas#pixelCanvas` / `.oled-card` / `.coords-display` / `.pixel-indicator` /
 *      `.tools` / `.textarea-data` / `.area-data` / `#change-color`);
 *   2) 交回的引用就是文档里那一个(否则行为会绑到不在页面上的元素).
 *
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from 'vitest';

import {
    OLED_BYTE_ORDER_TEXT,
    OLED_COLOR_MODES,
    OLED_COPY_BUTTON_TEXT,
    OLED_DEFAULT_BYTE_ORDER,
    OLED_DEFAULT_COLOR_MODE,
    OLED_DEFAULT_CONFIG,
    OLED_DEFAULT_TOOL,
    OLED_DOM,
    OLED_PANEL_CARD_BODY_CLASS,
    OLED_PANEL_BUTTON_CLASS,
    OLED_PANEL_BRUSH_LABEL_TEXT,
    OLED_PANEL_CARD_CLASS,
    OLED_PANEL_CARD_HEADER_CLASS,
    OLED_PANEL_COORDS_CLASS,
    OLED_PANEL_COORDS_TEXT,
    OLED_PANEL_EXPORT_BUTTON_TEXT,
    OLED_PANEL_IMPORT_BUTTON_TEXT,
    OLED_PANEL_INDICATOR_CLASS,
    OLED_PANEL_PNG_BUTTON_TEXT,
    OLED_PANEL_REFILL_BUTTON_TEXT,
    OLED_PANEL_ROW_CLASS,
    OLED_PANEL_TEXTAREA_CLASS,
    OLED_PANEL_TITLE_TEXT,
    OLED_PANEL_TOOLS_CLASS,
    OLED_PANEL_TOOL_OPTIONS,
} from '@/oled/config';
import { createOledPanel, type OledPanel } from '@/oled/ui/oled_panel';

/** 生成面板并挂到文档里(引用一致性要在文档里查) */
function render(): OledPanel {
    document.body.innerHTML = '';
    const panel = createOledPanel();
    document.body.append(panel.root);
    return panel;
}

describe('OLED:面板外壳', () => {
    it('是 div.card.oled-card,标题文案来自 config(.oled-card 定宽)', () => {
        const panel = render();
        expect(panel.root.tagName).toBe('DIV');
        expect(panel.root.className).toBe(OLED_PANEL_CARD_CLASS);
        expect(panel.root.classList.contains('oled-card')).toBe(true);
        expect(panel.root.querySelector(`.${OLED_PANEL_CARD_HEADER_CLASS} h4`)?.textContent)
            .toBe(OLED_PANEL_TITLE_TEXT);
        expect(panel.root.querySelector(`.${OLED_PANEL_CARD_BODY_CLASS}`)).not.toBeNull();
    });

    it('文档里没有重复 id', () => {
        render();
        const ids = [...document.querySelectorAll('[id]')].map((element) => element.id);
        expect(new Set(ids).size).toBe(ids.length);
    });
});

describe('OLED:状态区与画布', () => {
    it('坐标行文案与类名逐字不变', () => {
        const panel = render();
        expect(panel.coordsDisplay.textContent).toBe(OLED_PANEL_COORDS_TEXT);
        expect(panel.coordsDisplay.id).toBe(OLED_DOM.coordsDisplayId);
        expect(panel.coordsDisplay.className).toBe(OLED_PANEL_COORDS_CLASS);
    });

    it('画布用 canvas#pixelCanvas 这个 CSS 契约,物理分辨率由行为代码写', () => {
        const panel = render();
        expect(document.querySelector(`canvas#${OLED_DEFAULT_CONFIG.canvasId}`)).toBe(panel.canvas);
        // 标记里不带 width/height:构造 OLEDCanvas 时才写 config 的 128×64
        expect(panel.canvas.hasAttribute('width')).toBe(false);
        expect(panel.canvas.hasAttribute('height')).toBe(false);
        expect(OLED_DEFAULT_CONFIG.width).toBe(128);
        expect(OLED_DEFAULT_CONFIG.height).toBe(64);
    });

    it('鼠标指示器类名不变(CSS 靠 .pixel-indicator 定位并默认隐藏)', () => {
        const panel = render();
        expect(panel.indicator.className).toBe(OLED_PANEL_INDICATOR_CLASS);
        expect(panel.indicator.id).toBe(OLED_DOM.indicatorId);
    });
});

describe('OLED:工具控制区', () => {
    it('七个按钮的 id / 文案 / bootstrap 类名与原来一致', () => {
        const panel = render();
        const expected = [
            [panel.refillButton, OLED_DOM.refillBtnId, OLED_PANEL_REFILL_BUTTON_TEXT],
            [panel.colorButton, OLED_DOM.colorBtnId, OLED_COLOR_MODES[OLED_DEFAULT_COLOR_MODE].buttonText],
            [panel.exportButton, OLED_DOM.exportBtnId, OLED_PANEL_EXPORT_BUTTON_TEXT],
            [panel.pngButton, OLED_DOM.pngBtnId, OLED_PANEL_PNG_BUTTON_TEXT],
            [panel.byteOrderButton, OLED_DOM.byteOrderBtnId, OLED_BYTE_ORDER_TEXT[OLED_DEFAULT_BYTE_ORDER]],
            [panel.copyButton, OLED_DOM.copyBtnId, OLED_COPY_BUTTON_TEXT],
            [panel.importButton, OLED_DOM.importBtnId, OLED_PANEL_IMPORT_BUTTON_TEXT],
        ] as const;
        for (const [button, id, text] of expected) {
            expect(button.id, id).toBe(id);
            expect(button.textContent, id).toBe(text);
            expect(button.className, id).toBe(OLED_PANEL_BUTTON_CLASS);
            expect(button.getAttribute('type'), id).toBe('button');
            expect(document.getElementById(id), id).toBe(button);
        }
        // #change-color 的配色覆盖规则在 index.css 里,按 id 命中
        expect(document.querySelector(`#${OLED_DOM.colorBtnId}`)).toBe(panel.colorButton);
    });

    it('三个工具 radio 成组,默认项已选中(顺序即清单顺序)', () => {
        const panel = render();
        const radios = [...document.querySelectorAll<HTMLInputElement>(`input[name="${OLED_DOM.toolRadioName}"]`)];
        expect(radios).toHaveLength(OLED_PANEL_TOOL_OPTIONS.length);
        expect(panel.toolRadios).toEqual(radios);
        radios.forEach((radio, index) => {
            const option = OLED_PANEL_TOOL_OPTIONS[index];
            expect(radio.value, option.value).toBe(option.value);
            expect(radio.checked, option.value).toBe(option.value === OLED_DEFAULT_TOOL);
            // 原标记里文字是 radio 后面的兄弟文本节点
            expect(radio.nextSibling?.textContent, option.value).toBe(option.label);
        });
    });

    it('工具区与两块数据区的类名不变', () => {
        const panel = render();
        const tools = panel.root.querySelector(`.${OLED_PANEL_TOOLS_CLASS}`);
        expect(tools).not.toBeNull();
        // .tools 里是 5 颗按钮(refill / color / export / png / byte-order)加 3 个 radio;
        // 复制与导入那两颗按钮属于下面的数据区,不在这里(原标记即如此)
        expect(tools?.querySelectorAll('button')).toHaveLength(5);
        expect(tools?.querySelectorAll('input[type="radio"]')).toHaveLength(OLED_PANEL_TOOL_OPTIONS.length);
        expect(panel.root.querySelectorAll(`.${OLED_PANEL_ROW_CLASS}`)).toHaveLength(2);
        expect(panel.root.querySelectorAll(`textarea.${OLED_PANEL_TEXTAREA_CLASS}`)).toHaveLength(2);
    });

    it('画笔颜色按钮左边紧挨说明文字(它是"画笔"的按钮,不是又一个工具)', () => {
        const panel = render();
        expect(panel.colorButton.previousSibling?.textContent).toBe(OLED_PANEL_BRUSH_LABEL_TEXT);
        // 说明文字是纯文本节点,不是按钮/元素
        expect(panel.colorButton.previousSibling?.nodeType).toBe(3);
    });
});

describe('OLED:数据输入输出区', () => {
    it('两块 textarea 的 id / 类名 / 相邻按钮对得上', () => {
        const panel = render();
        expect(document.getElementById(OLED_DOM.exportTextareaId)).toBe(panel.exportTextarea);
        expect(document.getElementById(OLED_DOM.importTextareaId)).toBe(panel.importTextarea);
        for (const textarea of [panel.exportTextarea, panel.importTextarea]) {
            expect(textarea.className).toBe(OLED_PANEL_TEXTAREA_CLASS);
            expect(textarea.parentElement?.className).toBe(OLED_PANEL_ROW_CLASS);
        }
        // 导出区:textarea + br + 复制按钮;导入区:textarea + br + 导入按钮
        expect(panel.exportTextarea.nextElementSibling?.tagName).toBe('BR');
        expect(panel.exportTextarea.parentElement?.querySelector('button')).toBe(panel.copyButton);
        expect(panel.importTextarea.parentElement?.querySelector('button')).toBe(panel.importButton);
    });
});
