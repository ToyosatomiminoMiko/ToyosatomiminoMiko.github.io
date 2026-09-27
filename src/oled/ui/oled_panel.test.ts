/**
 * OLED 画板的标记契约(进程内,跑在 happy-dom 里).
 *
 * 面板原先写在 index.html 的 `#oled` 窗格里,再由 oled.ts 按 id 一个个取回;
 * 现在标记由 `ui/oled_panel.ts` 生成并把引用交回.这里断言两件事:
 *
 *   1) `public/css/index.css` 用到的选择器全部命中
 *      (`canvas#pixelCanvas` / `.oled-card` / `.coords-display` / `.pixel-indicator` /
 *      `.tools` / `.oled-card .code-editor` / `.area-data` / `#change-color`);
 *   2) 交回的引用就是文档里那一个(否则行为会绑到不在页面上的元素).
 *
 * 按钮本身现在归 UI 库(`miko_ui` 的 `createButton`):带库的基线类 `.ui-button`,
 * 不再带本站原来的 bootstrap 类 `btn btn-primary`;三个绘图工具归库的
 * `createSegmented`(`div.segmented` + 组内按钮),不再有 `input[name="tools"]`;
 * 数据区两块输入框归库的 `createCodeEditor`(`div.code-editor`:行号槽 + 真
 * textarea + 高亮层),不再有 `textarea.textarea-data`.
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
    OLED_PANEL_CARD_CLASS,
    OLED_PANEL_CARD_HEADER_CLASS,
    OLED_PANEL_COORDS_CLASS,
    OLED_PANEL_COORDS_TEXT,
    OLED_PANEL_EDITOR_GUTTER_WIDTH,
    OLED_PANEL_EXPORT_BUTTON_TEXT,
    OLED_PANEL_IMPORT_BUTTON_TEXT,
    OLED_PANEL_INDICATOR_CLASS,
    OLED_PANEL_PNG_BUTTON_TEXT,
    OLED_PANEL_REFILL_BUTTON_TEXT,
    OLED_PANEL_ROW_CLASS,
    OLED_PANEL_TITLE_TEXT,
    OLED_PANEL_TOOLS_CLASS,
    OLED_PANEL_TOOL_GROUP_LABEL,
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
    it('七个按钮的 id / 文案 / 库基线类与原来一致', () => {
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
            // 库(`miko_ui`)给每颗按钮挂的基线类;站点原来的 `btn btn-primary` 已不用
            expect(button.classList.contains('ui-button'), id).toBe(true);
            expect(button.classList.contains('btn'), id).toBe(false);
            expect(button.getAttribute('type'), id).toBe('button');
            expect(document.getElementById(id), id).toBe(button);
        }
        // 画笔按钮仍按 id 定位(CSS 与 oled.ts 都靠它)
        expect(document.querySelector(`#${OLED_DOM.colorBtnId}`)).toBe(panel.colorButton);
    });

    it('三个绘图工具由库的分段选择器承载,默认项已选中(顺序即清单顺序)', () => {
        const panel = render();
        const group = panel.toolSelect.element;
        // `segmented` 是库(`miko_ui` 的 `createSegmented`)的类名,不是站点类
        expect(group.className).toBe('segmented');
        expect(group.getAttribute('role')).toBe('group');
        expect(group.getAttribute('aria-label')).toBe(OLED_PANEL_TOOL_GROUP_LABEL);
        // 列数由控件按清单长度写进 --segmented-columns(三项排一行)
        expect(group.style.getPropertyValue('--segmented-columns'))
            .toBe(String(OLED_PANEL_TOOL_OPTIONS.length));
        // 句柄交回的就是文档里那一组,初值 = 默认工具
        expect(panel.root.querySelector('.segmented')).toBe(group);
        expect(panel.toolSelect.get()).toBe(OLED_DEFAULT_TOOL);

        const buttons = [...group.querySelectorAll('button')];
        expect(buttons).toHaveLength(OLED_PANEL_TOOL_OPTIONS.length);
        buttons.forEach((button, index) => {
            const option = OLED_PANEL_TOOL_OPTIONS[index];
            expect(button.textContent, option.value).toBe(option.label);
            expect(button.getAttribute('type'), option.value).toBe('button');
            const active = option.value === OLED_DEFAULT_TOOL;
            expect(button.classList.contains('active'), option.value).toBe(active);
            expect(button.getAttribute('aria-pressed'), option.value).toBe(String(active));
        });
    });

    it('工具区与两块数据区的类名不变', () => {
        const panel = render();
        const tools = panel.root.querySelector(`.${OLED_PANEL_TOOLS_CLASS}`);
        expect(tools).not.toBeNull();
        // .tools 的直接子节点是 5 颗独立按钮(refill / color / export / png / byte-order)
        // 加 1 组分段选择器(组内另有 3 颗按钮);radio 已全部去掉;
        // 复制与导入那两颗按钮属于下面的数据区,不在这里(原标记即如此)
        const directButtons = [...(tools?.children ?? [])].filter((child) => child.tagName === 'BUTTON');
        expect(directButtons).toHaveLength(5);
        expect(tools?.querySelector('.segmented')).toBe(panel.toolSelect.element);
        expect(tools?.querySelectorAll('input')).toHaveLength(0);
        expect(panel.root.querySelectorAll(`.${OLED_PANEL_ROW_CLASS}`)).toHaveLength(2);
        // 数据区两块输入框是库 `createCodeEditor` 的 `.code-editor` 外框:
        // 本站的 `textarea.textarea-data` 已撤,库自己那颗真 textarea 在里面
        expect(panel.root.querySelectorAll('.code-editor')).toHaveLength(2);
        expect(panel.root.querySelectorAll('textarea.textarea-data')).toHaveLength(0);
        expect(panel.root.querySelectorAll('.code-editor-textarea')).toHaveLength(2);
    });

    it('画笔颜色按钮紧跟在颜色重置按钮后面(工具区不再有"画笔:"说明文字)', () => {
        const panel = render();
        expect(panel.colorButton.previousSibling).toBe(panel.refillButton);
        // 说明文字已删:工具区里除按钮与分段选择器的文字外没有别的节点
        const tools = panel.root.querySelector(`.${OLED_PANEL_TOOLS_CLASS}`);
        expect(tools?.textContent).not.toContain('画笔');
    });
});

describe('OLED:数据输入输出区', () => {
    it('两块数据区各是一套库编辑器(.code-editor)的 id / 结构 / 相邻按钮对得上', () => {
        const panel = render();
        const editors = [panel.exportEditor, panel.importEditor] as const;
        const ids = [OLED_DOM.exportEditorId, OLED_DOM.importEditorId] as const;
        editors.forEach((editor, index) => {
            const id = ids[index];
            // id 挂在外框上:库的选项里没有 id,句柄拿到元素后由本站补(与按钮同一条口径)
            expect(document.getElementById(id), id).toBe(editor.element);
            expect(editor.element.classList.contains('code-editor'), id).toBe(true);
            // 库的结构契约:行号槽 + 真 textarea + 高亮层,高亮层与 textarea 必须相邻
            expect(editor.element.querySelector('.code-editor-gutter'), id).toBe(editor.gutter);
            expect(editor.textarea.classList.contains('code-editor-textarea'), id).toBe(true);
            expect(editor.textarea.nextElementSibling, id).toBe(editor.highlightScroller);
            // 高亮层已就位:脚本跑通后库才加这个开关(文字透明 + 高亮层显示)
            expect(editor.textarea.classList.contains('is-highlighted'), id).toBe(true);
            // 行号槽宽度钉成常量:库按字体量的内联值被 !important 压住,
            // 两个编辑器(以及行数变化前后)永远同宽,行号栏自己不滚
            expect(editor.gutter.style.getPropertyValue('--code-gutter-width'), id)
                .toBe(`${OLED_PANEL_EDITOR_GUTTER_WIDTH}px`);
            expect(editor.gutter.style.getPropertyPriority('--code-gutter-width'), id)
                .toBe('important');
            // 唯一会滚的 textarea 挂库的滚动条规定(见 main.ts 引的 scrollbar.css)
            expect(editor.textarea.classList.contains('ui-scrollbar'), id).toBe(true);
        });
        // 导出区:.code-editor + br + 复制按钮;导入区:.code-editor + br + 导入按钮
        expect(panel.exportEditor.element.parentElement?.className).toBe(OLED_PANEL_ROW_CLASS);
        expect(panel.importEditor.element.parentElement?.className).toBe(OLED_PANEL_ROW_CLASS);
        expect(panel.exportEditor.element.nextElementSibling?.tagName).toBe('BR');
        expect(panel.exportEditor.element.parentElement?.querySelector('button')).toBe(panel.copyButton);
        expect(panel.importEditor.element.parentElement?.querySelector('button')).toBe(panel.importButton);
    });

    it('程序化写值后 refresh():行号与高亮层跟上,源码里的尖括号只当文本', () => {
        const panel = render();
        panel.exportEditor.textarea.value = '<a>\n<b>';
        panel.exportEditor.refresh();
        // 行号栏按 \n 计数(库的 EditorLineNumbers):两行 -> 1 / 2
        expect(panel.exportEditor.lines.textContent).toBe('1\n2');
        // 高亮注入只转义,不做词法:源码原样可见,`<b>` 不会被解析成标签
        expect(panel.exportEditor.highlightCode.innerHTML).toBe('&lt;a&gt;\n&lt;b&gt;');
        expect(panel.exportEditor.highlightCode.textContent).toBe('<a>\n<b>');
    });

    it('行数进位也改不动行号槽宽度(库重量后仍是我们钉的常量)', () => {
        const panel = render();
        // 三位行号:库会重量一次并写内联值,但压不过我们带 !important 的那一份
        panel.exportEditor.textarea.value = Array.from({ length: 120 }, (_, i) => `line ${i}`).join('\n');
        panel.exportEditor.refresh();
        for (const editor of [panel.exportEditor, panel.importEditor]) {
            expect(editor.gutter.style.getPropertyValue('--code-gutter-width'))
                .toBe(`${OLED_PANEL_EDITOR_GUTTER_WIDTH}px`);
            expect(editor.gutter.style.getPropertyPriority('--code-gutter-width')).toBe('important');
        }
    });
});
