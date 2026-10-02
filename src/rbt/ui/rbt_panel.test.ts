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

    it('错误提示初始隐藏,元素仍在 DOM 里', () => {
        const panel = renderPanel(createRbtPanel);
        expect(document.getElementById(RBT_DOM.errorId)).toBe(panel.error);
        expect(panel.error.hidden).toBe(true);
        expect(panel.error.hasAttribute('hidden')).toBe(true);
        expect(panel.error.textContent).toBe('');
    });

    it('空树提示初始隐藏且是空的(与错误提示分两个元素)', () => {
        const panel = renderPanel(createRbtPanel);
        expect(document.getElementById(RBT_DOM.hintId)).toBe(panel.hint);
        expect(panel.error).not.toBe(panel.hint);
        expect(panel.hint.className).toBe('');
        expect(panel.hint.hidden).toBe(true);
        expect(panel.hint.hasAttribute('hidden')).toBe(true);
        expect(panel.hint.textContent).toBe('');
    });

    it('性质检查清单初始隐藏且是空的(内容由 rbt.ts 逐条重建)', () => {
        const panel = renderPanel(createRbtPanel);
        expect(document.getElementById(RBT_DOM.diagnosticsId)).toBe(panel.diagnostics);
        // 容器只认 id(#treeProperties):不再挂没人消费的类名(类名契约只剩行 / 结论 / 抬头)
        expect(panel.diagnostics.className).toBe('');
        expect(panel.diagnostics.hidden).toBe(true);
        expect(panel.diagnostics.hasAttribute('hidden')).toBe(true);
        // 标记里不带性质条目:条数与文案都来自 config,由行为代码渲染
        expect(panel.diagnostics.children).toHaveLength(0);
        expect(panel.diagnostics.textContent).toBe('');
    });

    it('画布 1200×640,尺寸来自 config 而不是 HTML', () => {
        const panel = renderPanel(createRbtPanel);
        expect(document.querySelector(`canvas#${RBT_DOM.canvasId}`)).toBe(panel.canvas);
        expect(panel.canvas.getAttribute('width')).toBe(String(RBT_CANVAS_WIDTH));
        expect(panel.canvas.getAttribute('height')).toBe(String(RBT_CANVAS_HEIGHT));
    });

    it('提示区与各件都在 .ui-panel-body 里,顺序是 提示 -> 输入框 -> 空树提示 -> 错误提示 -> 性质清单 -> 画布', () => {
        const panel = renderPanel(createRbtPanel);
        const body = panel.root.querySelector('.ui-panel-body');
        expect([...(body?.children ?? [])].map((child) => child.id))
            .toEqual([
                '',
                RBT_DOM.inputId,
                RBT_DOM.hintId,
                RBT_DOM.errorId,
                RBT_DOM.diagnosticsId,
                RBT_DOM.canvasId,
            ]);
    });

    it('文档里没有重复 id', () => {
        renderPanel(createRbtPanel);
        expectNoDuplicateIds();
    });
});
