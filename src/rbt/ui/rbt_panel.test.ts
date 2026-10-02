/**
 * 红黑树面板的标记契约(进程内,跑在 happy-dom 里).
 *
 * `public/css/index.css` 按 `#treeInput` 命中(宽度 / 等宽字体 / 最小高度),
 * canvas 的 1200×640 来自 config.这里把这些契约连同**逐字文案**一起钉住
 * (两行提示里的 U+00A0 与「黒」是界面上真实写的字,顺手改掉就会变成静默的文案漂移).
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
    RBT_PANEL_TITLE,
} from '@/rbt/config';
import { createRbtPanel } from '@/rbt/ui/rbt_panel';
import { expectNoDuplicateIds, renderPanel } from '@/test_support/panel_test_helpers';

describe('红黑树:面板结构', () => {
    it('是 section.ui-panel,标题在 .ui-panel-header,提示区在正文最前', () => {
        const panel = renderPanel(createRbtPanel);
        expect(panel.root.tagName).toBe('SECTION');
        expect(panel.root.className).toBe('ui-panel');
        // 框体(标题栏 / 标题 / 正文容器)由库的 `createPanel` 建
        expect(panel.root.querySelector('.ui-panel-header .ui-panel-title')?.textContent)
            .toBe(RBT_PANEL_TITLE);
        const children = [...panel.root.children];
        expect(children[0].className).toBe('ui-panel-header');
        expect(children[1].className).toBe('ui-panel-body');
    });

    it('两行提示逐字保留(含不换行空格 U+00A0 与「黒」)', () => {
        const panel = renderPanel(createRbtPanel);
        // 提示区是正文容器的第一个孩子(顺序契约之一,见 rbt_panel.ts)
        const hintBox = panel.root.querySelector('.ui-panel-body')?.children[0];
        expect(hintBox?.className).toBe('');
        const spans = [...(hintBox?.querySelectorAll('span') ?? [])];
        expect(spans.map((span) => span.textContent))
            .toEqual([RBT_HINT_SHORTHAND, RBT_HINT_COLOR_LEGEND]);
        // &nbsp; 在不换行语义上有意义,不能退化成普通空格
        expect(RBT_HINT_COLOR_LEGEND).toContain('\u00a0');
        expect(RBT_HINT_COLOR_LEGEND).toContain('黒');
        // 两行各自以 <br> 结束
        expect(hintBox?.querySelectorAll('br')).toHaveLength(2);
    });
});

describe('红黑树:输入与画布', () => {
    it('输入框的 id / spellcheck / placeholder 与原来一致', () => {
        const panel = renderPanel(createRbtPanel);
        expect(document.getElementById(RBT_DOM.inputId)).toBe(panel.input);
        expect(panel.input.getAttribute('spellcheck')).toBe(RBT_INPUT_SPELLCHECK);
        expect(panel.input.getAttribute('placeholder')).toBe(RBT_INPUT_PLACEHOLDER);
        // 表达式是"代码",初始值由挂载函数写(标记里不带 value)
        expect(panel.input.value).toBe('');
    });

    it('唯一输出区初始隐藏且是空的(提示 / 错误 / 清单共用这一个元素)', () => {
        const panel = renderPanel(createRbtPanel);
        expect(document.getElementById(RBT_DOM.outputId)).toBe(panel.output);
        // 容器只认 id(#treeOutput):自己不挂类名(类名契约只剩提示行 / 错误行 / 抬头的类)
        expect(panel.output.className).toBe('');
        expect(panel.output.hidden).toBe(true);
        expect(panel.output.hasAttribute('hidden')).toBe(true);
        // 标记里不带任何输出内容:写什么由 rbt.ts 每轮重建
        expect(panel.output.children).toHaveLength(0);
        expect(panel.output.textContent).toBe('');
    });

    it('画布 1200×640,尺寸来自 config 而不是 HTML', () => {
        const panel = renderPanel(createRbtPanel);
        expect(document.querySelector(`canvas#${RBT_DOM.canvasId}`)).toBe(panel.canvas);
        expect(panel.canvas.getAttribute('width')).toBe(String(RBT_CANVAS_WIDTH));
        expect(panel.canvas.getAttribute('height')).toBe(String(RBT_CANVAS_HEIGHT));
    });

    it('提示区与各件都在 .ui-panel-body 里,顺序是 提示 -> 输入框 -> 输出区 -> 画布', () => {
        const panel = renderPanel(createRbtPanel);
        const body = panel.root.querySelector('.ui-panel-body');
        expect([...(body?.children ?? [])].map((child) => child.id))
            .toEqual(['', RBT_DOM.inputId, RBT_DOM.outputId, RBT_DOM.canvasId]);
    });

    it('文档里没有重复 id', () => {
        renderPanel(createRbtPanel);
        expectNoDuplicateIds();
    });
});
