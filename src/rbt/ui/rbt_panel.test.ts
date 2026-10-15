/**
 * 红黑树面板的标记契约(进程内,跑在 happy-dom 里).
 *
 * `public/css/index.css` 按 `#treeInput` 命中(宽度 / 等宽字体 / 最小高度),
 * 树的 viewBox 1200×640 来自 config.这里把这些契约连同**逐字文案**一起钉住
 * (两行提示里的 U+00A0 与「黒」是界面上真实写的字,顺手改掉就会变成静默的文案漂移).
 *
 * 树那块从 canvas 换成 SVG 之后,契约变了三条,都在这里钉住:
 * - 元素是 `<svg>` 而不是 `<canvas>`,所以查的是 `svg#rbtTree`(标签名也一起断言,
 *   否则将来谁把它换回 canvas 而 id 没动,这一层看不出来);
 * - 尺寸是 `viewBox` 而不是 width / height 属性 -- 前者是**坐标系**(布局算出来的
 *   x / y 就在这个坐标系里),后者只用来给出宽高比让 CSS 的 `height: auto` 算得出来;
 * - 它必须是**空的**:每轮要画什么由 rbt.ts 整批重建(这一层不认识树).
 *
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from 'vitest';

import {
    RBT_DOM,
    RBT_HINT_COLOR_LEGEND,
    RBT_HINT_SHORTHAND,
    RBT_INPUT_PLACEHOLDER,
    RBT_INPUT_SPELLCHECK,
    RBT_PANEL_TITLE,
    RBT_VIEW_BOX,
    RBT_VIEW_BOX_HEIGHT,
    RBT_VIEW_BOX_WIDTH,
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

describe('红黑树:输入与树', () => {
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

    it('树是 svg#rbtTree,viewBox 1200×640 来自 config,且初始是空的', () => {
        const panel = renderPanel(createRbtPanel);
        // 标签名一起断言:换成 canvas 而只改 id 的话,这一条会红
        expect(panel.tree.tagName.toLowerCase()).toBe('svg');
        expect(document.querySelector(`svg#${RBT_DOM.treeId}`)).toBe(panel.tree);
        expect(panel.tree.getAttribute('viewBox')).toBe(RBT_VIEW_BOX);
        expect(RBT_VIEW_BOX).toBe(`0 0 ${RBT_VIEW_BOX_WIDTH} ${RBT_VIEW_BOX_HEIGHT}`);
        // 画布只给宽高比,实际显示尺寸由 CSS 给(`width: 100%` + `height: auto`)
        expect(panel.tree.getAttribute('width')).toBe(String(RBT_VIEW_BOX_WIDTH));
        expect(panel.tree.getAttribute('height')).toBe(String(RBT_VIEW_BOX_HEIGHT));
        // 空:每轮画什么由 rbt.ts 重建,这一层不认识树
        expect(panel.tree.children).toHaveLength(0);
    });

    it('提示区与各件都在 .ui-panel-body 里,顺序是 提示 -> 输入框 -> 输出区 -> 树', () => {
        const panel = renderPanel(createRbtPanel);
        const body = panel.root.querySelector('.ui-panel-body');
        expect([...(body?.children ?? [])].map((child) => child.id))
            .toEqual(['', RBT_DOM.inputId, RBT_DOM.outputId, RBT_DOM.treeId]);
    });

    it('文档里没有重复 id', () => {
        renderPanel(createRbtPanel);
        expectNoDuplicateIds();
    });
});
