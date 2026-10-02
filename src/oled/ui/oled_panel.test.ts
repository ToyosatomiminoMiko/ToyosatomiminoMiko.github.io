/**
 * OLED 画板的标记契约(进程内,跑在 happy-dom 里).
 *
 * 标记由 `ui/oled_panel.ts` 生成并把引用交回,这里断言两件事:
 *
 *   1) `public/css/index.css` 用到的选择器全部命中
 *      (`canvas#pixelCanvas` / `.oled-card` / `.coords-display` / `.pixel-indicator` /
 *      `.tools` / `.oled-card .code-editor` / `.area-data` / `#change-color`);
 *   2) 交回的引用就是文档里那一个(否则行为会绑到不在页面上的元素).
 *
 * 按钮由 UI 库(`miko_ui` 的 `createButton`)生成,带库的基线类 `.ui-button`;三个
 * 绘图工具由库的 `createSegmented` 生成(`div.segmented` + 组内按钮);数据区由库的
 * `createCodeEditor` 生成(`div.code-editor`:行号槽 + 真 textarea + 高亮层).
 * 数据区只有**一颗**编辑框(导出写它,导入读它),它的按钮都在 `.tools`.
 *
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    OLED_BYTE_ORDER_TEXT,
    OLED_COLOR_MODES,
    OLED_COPY_BUTTON_TEXT,
    OLED_DEFAULT_BYTE_ORDER,
    OLED_DEFAULT_COLOR_MODE,
    OLED_DEFAULT_CONFIG,
    OLED_DEFAULT_TOOL,
    OLED_DOM,
    OLED_PANEL_COORDS_CLASS,
    OLED_PANEL_COORDS_TEXT,
    OLED_PANEL_EDITOR_EXPAND_TEXT,
    OLED_PANEL_EDITOR_EXPANDED_CLASS,
    OLED_PANEL_EDITOR_GUTTER_WIDTH,
    OLED_PANEL_EXPORT_BUTTON_TEXT,
    OLED_PANEL_EXTRA_CLASS,
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
import { createOledPanel } from '@/oled/ui/oled_panel';
import { expectNoDuplicateIds, renderPanel } from '@/test_support/panel_test_helpers';

describe('OLED:面板外壳', () => {
    it('是 section.ui-panel.oled-card,标题文案来自 config(.oled-card 定宽)', () => {
        const panel = renderPanel(createOledPanel);
        expect(panel.root.tagName).toBe('SECTION');
        expect(panel.root.className).toBe(`ui-panel ${OLED_PANEL_EXTRA_CLASS}`);
        expect(panel.root.classList.contains('oled-card')).toBe(true);
        // 框体(标题栏 / 标题 / 正文容器)由库的 `createPanel` 建
        expect(panel.root.querySelector('.ui-panel-header .ui-panel-title')?.textContent)
            .toBe(OLED_PANEL_TITLE_TEXT);
        expect(panel.root.querySelector('.ui-panel-body')).not.toBeNull();
    });

    it('文档里没有重复 id', () => {
        renderPanel(createOledPanel);
        expectNoDuplicateIds();
    });
});

describe('OLED:状态区与画布', () => {
    it('坐标行文案与类名逐字不变', () => {
        const panel = renderPanel(createOledPanel);
        expect(panel.coordsDisplay.textContent).toBe(OLED_PANEL_COORDS_TEXT);
        expect(panel.coordsDisplay.id).toBe(OLED_DOM.coordsDisplayId);
        expect(panel.coordsDisplay.className).toBe(OLED_PANEL_COORDS_CLASS);
    });

    it('画布用 canvas#pixelCanvas 这个 CSS 契约,物理分辨率由行为代码写', () => {
        const panel = renderPanel(createOledPanel);
        expect(document.querySelector(`canvas#${OLED_DOM.canvasId}`)).toBe(panel.canvas);
        // 标记里不带 width/height:构造 OLEDCanvas 时才写 config 的 128×64
        expect(panel.canvas.hasAttribute('width')).toBe(false);
        expect(panel.canvas.hasAttribute('height')).toBe(false);
        expect(OLED_DEFAULT_CONFIG.width).toBe(128);
        expect(OLED_DEFAULT_CONFIG.height).toBe(64);
    });

    it('鼠标指示器类名不变(CSS 靠 .pixel-indicator 定位并默认隐藏)', () => {
        const panel = renderPanel(createOledPanel);
        expect(panel.indicator.className).toBe(OLED_PANEL_INDICATOR_CLASS);
        expect(panel.indicator.id).toBe(OLED_DOM.indicatorId);
    });
});

describe('OLED:工具控制区', () => {
    it('八个按钮的 id / 文案 / 库基线类与原来一致', () => {
        const panel = renderPanel(createOledPanel);
        const expected = [
            [panel.refillButton, OLED_DOM.refillBtnId, OLED_PANEL_REFILL_BUTTON_TEXT],
            [panel.colorButton, OLED_DOM.colorBtnId, OLED_COLOR_MODES[OLED_DEFAULT_COLOR_MODE].buttonText],
            [panel.exportButton, OLED_DOM.exportBtnId, OLED_PANEL_EXPORT_BUTTON_TEXT],
            [panel.pngButton, OLED_DOM.pngBtnId, OLED_PANEL_PNG_BUTTON_TEXT],
            [panel.byteOrderButton, OLED_DOM.byteOrderBtnId, OLED_BYTE_ORDER_TEXT[OLED_DEFAULT_BYTE_ORDER]],
            [panel.copyButton, OLED_DOM.copyBtnId, OLED_COPY_BUTTON_TEXT],
            [panel.importButton, OLED_DOM.importBtnId, OLED_PANEL_IMPORT_BUTTON_TEXT],
            [panel.editorToggleButton, OLED_DOM.editorToggleBtnId, OLED_PANEL_EDITOR_EXPAND_TEXT],
        ] as const;
        for (const [button, id, text] of expected) {
            expect(button.id, id).toBe(id);
            expect(button.textContent, id).toBe(text);
            // 库(`miko_ui`)给每颗按钮挂的基线类;`btn` 不是库的类名,不该出现
            expect(button.classList.contains('ui-button'), id).toBe(true);
            expect(button.classList.contains('btn'), id).toBe(false);
            expect(button.getAttribute('type'), id).toBe('button');
            expect(document.getElementById(id), id).toBe(button);
        }
        // 画笔按钮仍按 id 定位(CSS 与 oled.ts 都靠它)
        expect(document.querySelector(`#${OLED_DOM.colorBtnId}`)).toBe(panel.colorButton);
    });

    it('三个绘图工具由库的分段选择器承载,默认项已选中(顺序即清单顺序)', () => {
        const panel = renderPanel(createOledPanel);
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

    it('工具区与唯一一行数据区的类名不变', () => {
        const panel = renderPanel(createOledPanel);
        const tools = panel.root.querySelector(`.${OLED_PANEL_TOOLS_CLASS}`);
        expect(tools).not.toBeNull();
        // .tools 的直接子节点是 8 颗按钮(颜色重置 / 画笔颜色 / 导出数据 / 复制 /
        // 导入 / 展开-折叠 / 下载PNG / 字节序)再加 1 组分段选择器(组内另有 3 颗按钮)
        const directButtons = [...(tools?.children ?? [])].filter((child) => child.tagName === 'BUTTON');
        expect(directButtons).toHaveLength(8);
        expect(tools?.querySelector('.segmented')).toBe(panel.toolSelect.element);
        expect(tools?.querySelectorAll('input')).toHaveLength(0);
        expect(panel.root.querySelectorAll(`.${OLED_PANEL_ROW_CLASS}`)).toHaveLength(1);
        // 数据区是库 `createCodeEditor` 的**一套** `.code-editor` 外框:
        // 里面只有库自己那颗真 textarea,没有额外的站点 textarea
        expect(panel.root.querySelectorAll('.code-editor')).toHaveLength(1);
        expect(panel.root.querySelectorAll('textarea.textarea-data')).toHaveLength(0);
        expect(panel.root.querySelectorAll('.code-editor-textarea')).toHaveLength(1);
    });

    it('画笔颜色按钮紧跟在颜色重置按钮后面(工具区不再有"画笔:"说明文字)', () => {
        const panel = renderPanel(createOledPanel);
        expect(panel.colorButton.previousSibling).toBe(panel.refillButton);
        // 工具区里除按钮与分段选择器的文字外没有别的节点
        const tools = panel.root.querySelector(`.${OLED_PANEL_TOOLS_CLASS}`);
        expect(tools?.textContent).not.toContain('画笔');
    });
});

describe('OLED:数据区', () => {
    it('只有一颗库编辑器(.code-editor)承载导出与导入,三颗接口按钮同在 .tools', () =>  {
        const panel = renderPanel(createOledPanel);
        const editor = panel.dataEditor;
        const id = OLED_DOM.dataEditorId;
        // id 挂在外框上:库的选项里没有 id,句柄拿到元素后由本站补(与按钮同一条口径)
        expect(document.getElementById(id), id).toBe(editor.element);
        expect(editor.element.classList.contains('code-editor'), id).toBe(true);
        // 库的结构契约:行号槽 + 真 textarea + 高亮层,高亮层与 textarea 必须相邻
        expect(editor.element.querySelector('.code-editor-gutter'), id).toBe(editor.gutter);
        expect(editor.textarea.classList.contains('code-editor-textarea'), id).toBe(true);
        expect(editor.textarea.nextElementSibling, id).toBe(editor.highlightScroller);
        // 高亮层已就位:脚本跑通后库才加这个开关(文字透明 + 高亮层显示)
        expect(editor.textarea.classList.contains('is-highlighted'), id).toBe(true);
        // 槽宽不在标记里钉:面板只把常量交给库的 `gutterMinWidth`,真正生效的是
        // public/css/index.css 的 `--code-gutter-width: 48px !important`
        // (库随后写的普通内联值压不过它;由下面"行数进位"那条测试守着)
        // 唯一会滚的 textarea 挂库的滚动条规定(见 main.ts 引的 scrollbar.css)
        expect(editor.textarea.classList.contains('ui-scrollbar'), id).toBe(true);
        // 数据区只有这一行,且行内只有编辑器:按钮全在工具区(四颗数据按钮相邻)
        expect(editor.element.parentElement?.className).toBe(OLED_PANEL_ROW_CLASS);
        expect(editor.element.parentElement?.querySelector('button')).toBeNull();
        const tools = panel.root.querySelector(`.${OLED_PANEL_TOOLS_CLASS}`);
        expect(tools?.contains(panel.copyButton)).toBe(true);
        expect(tools?.contains(panel.importButton)).toBe(true);
        expect(tools?.contains(panel.editorToggleButton)).toBe(true);
        // 四颗数据按钮在工具区里相邻:导出 -> 复制 -> 导入 -> 展开/折叠
        expect(panel.copyButton.previousElementSibling).toBe(panel.exportButton);
        expect(panel.importButton.previousElementSibling).toBe(panel.copyButton);
        expect(panel.editorToggleButton.previousElementSibling).toBe(panel.importButton);
    });

    it('折叠 / 展开按钮:初值折叠态,带 aria-expanded / aria-controls', () => {
        const panel = renderPanel(createOledPanel);
        const button = panel.editorToggleButton;
        // 初值就是折叠态(面板只给文案,展开态类由 oled.ts 的 toggleEditorExpanded 切)
        expect(button.textContent).toBe(OLED_PANEL_EDITOR_EXPAND_TEXT);
        expect(button.getAttribute('aria-expanded')).toBe('false');
        // 控制关系指向那颗编辑器(库外框上的 id)
        expect(button.getAttribute('aria-controls')).toBe(OLED_DOM.dataEditorId);
        expect(panel.dataEditor.element.classList.contains(OLED_PANEL_EDITOR_EXPANDED_CLASS))
            .toBe(false);
    });

    it('程序化写值后 refresh():行号与高亮层跟上,源码里的尖括号只当文本', () => {
        const panel = renderPanel(createOledPanel);
        panel.dataEditor.textarea.value = '<a>\n<b>';
        panel.dataEditor.refresh();
        // 行号栏按 \n 计数(库的 EditorLineNumbers):两行 -> 1 / 2
        expect(panel.dataEditor.lines.textContent).toBe('1\n2');
        // 高亮注入只转义,不做词法:源码原样可见,`<b>` 不会被解析成标签
        expect(panel.dataEditor.highlightCode.innerHTML).toBe('&lt;a&gt;\n&lt;b&gt;');
        expect(panel.dataEditor.highlightCode.textContent).toBe('<a>\n<b>');
    });

    it('行数进位也改不动槽宽:库写的内联值无 !important,压不过样式表的 48px !important', async () => {
        /*
          库量槽宽要一块 2D context(happy-dom 默认给 null,库拿不到就早退,一条
          内联值都不写).这里补一块假 context 把真实度量路径走通 -- 少了这个桩,
          整条测试就是空测:断言的目标根本不会被写出来.
        */
        const measureText = vi.fn((text: string) => ({ width: text.length * 12 } as TextMetrics));
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
            font: '',
            measureText,
        } as unknown as CanvasRenderingContext2D);

        const panel = renderPanel(createOledPanel);
        // 三位行号:位数进位是库重量槽宽的触发条件(见库的 update())
        panel.dataEditor.textarea.value = Array.from({ length: 120 }, (_, i) => `line ${i}`).join('\n');
        panel.dataEditor.refresh();

        // (a) 桩生效了:库真的量过,并把结果写成了内联值(不是我们写的)
        expect(measureText).toHaveBeenCalled();
        const inlineWidth = panel.dataEditor.gutter.style.getPropertyValue('--code-gutter-width');
        expect(inlineWidth, '库没写内联槽宽,说明度量桩没走通').not.toBe('');
        // 3 位数字 × 12px + 15px 内边距 = 51px:确实是库量出来的,而不是我们钉的 48px
        expect(inlineWidth).toBe('51px');
        // (b) 库写的是**不带 priority** 的普通内联声明:只有作者样式表的 !important 压得住
        expect(panel.dataEditor.gutter.style.getPropertyPriority('--code-gutter-width')).toBe('');
        // (c) 样式表里真的钉着 48px !important(TS 与 CSS 的跨语言契约,静默失配的防线)
        const { readFile } = await import('node:fs/promises');
        /*
          用 `node:url` 的 URL 而不是全局 URL:happy-dom 环境把全局 URL 换成浏览器
          语义,`file:` 会被它改写成 `http://localhost/@fs/...`,node:fs 不认这种 scheme
          (报 "The URL must be of scheme file").这里要的是 Node 的 file: 解析.
        */
        const { URL: NodeURL } = await import('node:url');
        const css = await readFile(
            new NodeURL('../../../public/css/index.css', import.meta.url),
            'utf8',
        );
        const rule = css.match(/\.oled-card\s+\.code-editor-gutter\s*\{([^}]*)\}/);
        expect(rule?.[1], 'public/css/index.css 里没有 .oled-card .code-editor-gutter 规则')
            .toBeDefined();
        // 去掉注释再断言:把这条声明整行注释掉也算"钉住了"的话,这条测试就白写了
        const declarations = (rule?.[1] ?? '').replace(/\/\*[\s\S]*?\*\//g, '');
        expect(declarations).toMatch(
            new RegExp(`--code-gutter-width:\\s*${OLED_PANEL_EDITOR_GUTTER_WIDTH}px\\s*!important`),
        );
    });
});

// 度量桩装在整个 HTMLCanvasElement 原型上:无论上面哪条断言先失败都要还原,
// 否则同文件后面的用例会跟着"能拿到 2D context"(静默改变它们的运行环境).
afterEach(() => {
    vi.restoreAllMocks();
});
