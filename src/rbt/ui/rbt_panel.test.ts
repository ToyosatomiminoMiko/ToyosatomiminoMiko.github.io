/**
 * 红黑树面板的标记契约(进程内,跑在 happy-dom 里).
 *
 * 面板原先写在 index.html 的 `#rbt` 窗格里;`public/css/index.css` 按
 * `#treeInput` 命中(宽度 / 等宽字体 / 最小高度),canvas 的 1200×640 原先写在
 * HTML 属性上,现在来自 config.这里把这些契约连同**逐字文案**一起钉住
 * (两行提示里的 U+00A0 与「黒」是原标记的写法,顺手改掉就会变成静默的文案漂移).
 *
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from 'vitest';

import {
    RBT_CANVAS_HEIGHT,
    RBT_CANVAS_WIDTH,
    RBT_DOM,
    RBT_HINT_COLOR_LEGEND,
    RBT_HINT_SHORTHAND,
    RBT_INPUT_PLACEHOLDER,
    RBT_INPUT_SPELLCHECK,
    RBT_PANEL_BODY_CLASS,
    RBT_PANEL_HEADER_CLASS,
    RBT_PANEL_ROOT_CLASS,
    RBT_PANEL_TITLE,
} from '@/rbt/config';
import { createRbtPanel, type RbtPanel } from '@/rbt/ui/rbt_panel';

/** 生成面板并挂到文档里(引用一致性要在文档里查) */
function render(): RbtPanel {
    document.body.innerHTML = '';
    const panel = createRbtPanel();
    document.body.append(panel.root);
    return panel;
}

describe('红黑树:面板结构', () => {
    it('是 div.card,标题与提示区在卡片主体之前', () => {
        const panel = render();
        expect(panel.root.className).toBe(RBT_PANEL_ROOT_CLASS);
        expect(panel.root.querySelector(`.${RBT_PANEL_HEADER_CLASS} h4`)?.textContent)
            .toBe(RBT_PANEL_TITLE);
        const children = [...panel.root.children];
        expect(children[0].className).toBe(RBT_PANEL_HEADER_CLASS);
        // 第二块是无类名的提示 div,第三块才是 card-body
        expect(children[1].tagName).toBe('DIV');
        expect(children[1].className).toBe('');
        expect(children[2].className).toBe(RBT_PANEL_BODY_CLASS);
    });

    it('两行提示逐字保留(含不换行空格 U+00A0 与「黒」)', () => {
        const panel = render();
        const hintBox = panel.root.children[1];
        expect(hintBox.className).toBe('');
        const spans = [...hintBox.querySelectorAll('span')];
        expect(spans.map((span) => span.textContent))
            .toEqual([RBT_HINT_SHORTHAND, RBT_HINT_COLOR_LEGEND]);
        // &nbsp; 在不换行语义上有意义,不能退化成普通空格
        expect(RBT_HINT_COLOR_LEGEND).toContain('\u00a0');
        expect(RBT_HINT_COLOR_LEGEND).toContain('黒');
        // 两行各自以 <br> 结束(原标记如此)
        expect(panel.root.children[1].querySelectorAll('br')).toHaveLength(2);
    });
});

describe('红黑树:输入与画布', () => {
    it('输入框的 id / spellcheck / placeholder 与原来一致', () => {
        const panel = render();
        expect(document.getElementById(RBT_DOM.inputId)).toBe(panel.input);
        expect(panel.input.getAttribute('spellcheck')).toBe(RBT_INPUT_SPELLCHECK);
        expect(panel.input.getAttribute('placeholder')).toBe(RBT_INPUT_PLACEHOLDER);
        // 表达式是"代码",初始值由挂载函数写(标记里不带 value)
        expect(panel.input.value).toBe('');
    });

    it('错误提示初始隐藏,元素仍在 DOM 里', () => {
        const panel = render();
        expect(document.getElementById(RBT_DOM.errorId)).toBe(panel.error);
        expect(panel.error.hidden).toBe(true);
        expect(panel.error.hasAttribute('hidden')).toBe(true);
        expect(panel.error.textContent).toBe('');
    });

    it('画布 1200×640,尺寸来自 config 而不是 HTML', () => {
        const panel = render();
        expect(document.querySelector(`canvas#${RBT_DOM.canvasId}`)).toBe(panel.canvas);
        expect(panel.canvas.getAttribute('width')).toBe(String(RBT_CANVAS_WIDTH));
        expect(panel.canvas.getAttribute('height')).toBe(String(RBT_CANVAS_HEIGHT));
    });

    it('三件套都在 card-body 里,顺序是 输入框 -> 错误提示 -> 画布', () => {
        const panel = render();
        const body = panel.root.querySelector(`.${RBT_PANEL_BODY_CLASS}`);
        expect([...(body?.children ?? [])].map((child) => child.id))
            .toEqual([RBT_DOM.inputId, RBT_DOM.errorId, RBT_DOM.canvasId]);
    });

    it('文档里没有重复 id', () => {
        render();
        const ids = [...document.querySelectorAll('[id]')].map((element) => element.id);
        expect(new Set(ids).size).toBe(ids.length);
    });
});
