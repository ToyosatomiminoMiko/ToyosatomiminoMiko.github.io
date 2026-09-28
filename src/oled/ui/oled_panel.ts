/*
OLED 像素画板的**标记组件**(声明式).

画板原先的标记写在 index.html 的 `#oled` 窗格里,再由 oled.ts 按 id 逐个取回
(`document.getElementById` / `querySelectorAll('input[name="tools"]')`) --
同一个 id 在 HTML 与 TS 里各写一份,改一处就静默失配.现在改成和地铁车窗
控制台,时钟同一条约定:宿主只提供空的标签页窗格,标记按 config.ts 的声明生成.

生成的结构与原 index.html **逐字对应**(标签名 / 类名 / id / 文本 / 属性都不变),
因为 public/css/index.css 直接命中这些类与 id(如
`canvas#pixelCanvas`,`#change-color`,`.oled-card`,`.tools`).**面板框体归库**:
标题栏与正文容器由 `miko_ui` 的 `createPanel` 建(`section.ui-panel.oled-card >
header.ui-panel-header > span.ui-panel-title` + `div.ui-panel-body`),本站只给
标题文案与作用域类 `.oled-card`.
**另有三个结构件也归库**:面板里的七颗按钮改由 `miko_ui` 的 `createButton` 生成
(基线类 `.ui-button`);三个绘图工具由库的 `createSegmented` 生成
(`div.segmented` + 三颗组内按钮),不再是 `input[name="tools"]` 那组 radio;
数据区原先的两块 `textarea.textarea-data` 换成库的 `createCodeEditor`
(`div.code-editor`:行号槽 + 真 textarea + 高亮层,装配见下面的 `createDataEditor`).
**数据区只有一颗框**:导出写进去的 C 源码本身就是 `0x??` 形式,导入正则
(`OLED_HEX_BYTE_PATTERN`)原样能解析回来,所以"导出 -> 改 / 粘 -> 导入"共用一个
缓冲即可;原先分给导出框 / 导入框的两颗按钮(复制 / 导入)随之上移到 `.tools`,
与"导出数据"相邻成组.编辑器 id 仍按下面的契约写上,`#change-color` 那条配色
规则已从 index.css 撤掉,`.textarea-data` 那条也已撤(本站样式表现在只给编辑器
补定高与可纵向拖动).

    section.ui-panel.oled-card                    面板框体(库的 createPanel)
      header.ui-panel-header > span.ui-panel-title   'OLED Canvas'
      div.ui-panel-body
        div#coordsDisplay.coords-display   'coordinate:(X:-,Y:-)'
        br
        canvas#pixelCanvas
        div#pixelIndicator.pixel-indicator
        br
        div.tools               按钮 + div.segmented(库的分段选择器) + 按钮 ...
        br
        div
          div.area-data > div.code-editor#oledData(库的编辑器)

本模块是纯函数:不读页面,不改全局,不绑事件,不查 DOM,只把"描述"变成元素并把
行为代码需要的引用一次交回(与 ui/settings.ts,clock/ui/clock_display.ts 的分工一致).
插进宿主与绑事件都是 oled.ts 的事.
*/

import {
    createButton,
    createCodeEditor,
    createPanel,
    createSegmented,
    create_element,
    type CodeEditorHandle,
    type SegmentedHandle,
} from 'miko_ui';

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
import type { DrawTool } from '@/oled/types';

/** 面板交回的元素引用:行为代码需要的元素**全部**在这里,不允许回头查 DOM */
export interface OledPanel {
    /** 整块面板:库的 `createPanel` 建的 `section.ui-panel.oled-card`(插进挂载宿主的那一个) */
    readonly root: HTMLElement;
    /** 主画布:canvas#pixelCanvas(128x64 物理像素由 oled.ts 写到 width/height 上) */
    readonly canvas: HTMLCanvasElement;
    /** 坐标文本显示:div#coordsDisplay */
    readonly coordsDisplay: HTMLElement;
    /** 鼠标位置指示器(跟随光标的红框):div#pixelIndicator */
    readonly indicator: HTMLElement;
    /** 重置按钮:清空画布,文案 = OLED_PANEL_REFILL_BUTTON_TEXT,id 'refill-btn' */
    readonly refillButton: HTMLButtonElement;
    /** 画笔颜色按钮:文案 = 当前模式的 buttonText(0 / 1),id 'change-color' */
    readonly colorButton: HTMLButtonElement;
    /** 导出按钮:生成 C 源码,文案 = OLED_PANEL_EXPORT_BUTTON_TEXT,id 'export-btn' */
    readonly exportButton: HTMLButtonElement;
    /** PNG 按钮:下载画布,文案 = OLED_PANEL_PNG_BUTTON_TEXT,id 'output-png-btn' */
    readonly pngButton: HTMLButtonElement;
    /** 字节序按钮:LSB / MSB 切换,文案 = OLED_BYTE_ORDER_TEXT,id 'byte-order-btn' */
    readonly byteOrderButton: HTMLButtonElement;
    /** 复制按钮:把数据框里的文本送进剪贴板,文案 = OLED_COPY_BUTTON_TEXT,id 'output-button' */
    readonly copyButton: HTMLButtonElement;
    /** 导入按钮:解析数据框里的十六进制字节,文案 = OLED_PANEL_IMPORT_BUTTON_TEXT,id 'import-btn' */
    readonly importButton: HTMLButtonElement;
    /**
     * 数据编辑器:库的 `.code-editor`(句柄的 textarea **同时**是导出目标与导入来源,
     * id 'oledData';导出往里写生成的 C 源码,导入从里面抠 1024 个十六进制字节)
     */
    readonly dataEditor: CodeEditorHandle;
    /** 绘图工具分段选择器:`miko_ui` 的 `createSegmented`(顺序 = OLED_PANEL_TOOL_OPTIONS,默认项已选中) */
    readonly toolSelect: SegmentedHandle<DrawTool>;
}

/**
 * 一颗面板按钮:整颗由 UI 库(`miko_ui` 的 `createButton`)生成.
 *
 * 库给的是**按钮本身**:`<button type="button" class="ui-button">` + 文案,外观
 * 归库的 `styles/widgets.css`,本站不再写按钮外观(原先那份是 bootstrap 的
 * `.btn.btn-primary`).这里只补本站的两件事:
 *   - **id**:CSS 与测试的定位契约(库的选项里没有 id,句柄拿到元素后补上);
 *   - 元素引用:行为代码按引用绑事件,不查 DOM.
 */
function createPanelButton(id: string, text: string): HTMLButtonElement {
    const button = createButton({ text });
    button.element.id = id;
    return button.element;
}

/**
 * 绘图工具分段选择器:整组由 UI 库(`miko_ui` 的 `createSegmented`)生成.
 *
 * 库给的是 `<div class="segmented" role="group">` + 每项一颗
 * `<button type="button">`(选中项带 `.active` 与 `aria-pressed="true"`),
 * 布局 / 高亮 / 键盘与读屏语义都归库;本站只把 config.ts 的清单原样喂进去,
 * 并把**句柄**交回(行为代码用 `onChange` 接选中,不再按 name 查 radio).
 * 列数取清单长度:三项排一行.
 */
function createToolSelect(): SegmentedHandle<DrawTool> {
    return createSegmented<DrawTool>({
        columns: OLED_PANEL_TOOL_OPTIONS.length,
        ariaLabel: OLED_PANEL_TOOL_GROUP_LABEL,
        value: OLED_DEFAULT_TOOL,
        items: OLED_PANEL_TOOL_OPTIONS,
    });
}

/** 高亮层要转义的三个字符:唯一一处把源码变成 HTML 的地方(见 highlightSource) */
const HIGHLIGHT_ESCAPES: Readonly<Record<string, string>> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
};

/**
 * 高亮注入:`source -> HTML` 的函数,整颗由 UI 库(`miko_ui` 的
 * `createCodeEditor`)要求消费者提供 -- 库不认识任何具体语言的词法.
 *
 * 本站**不做词法分析**:OLED 数据区放的是导出出来的 C 数组源码与粘贴进来的
 * 十六进制字节,没有值得着色的词法类别.所以这里只把 `&` / `<` / `>` 转义,
 * 高亮层于是等价于"与 textarea 逐像素重叠的一层纯文本",不改变输入行为的
 * 前提下拿到库的行号栏与滚动同步(见库 `editor/EditorHighlight.ts` 的文件头).
 * 以后要加 C 语法高亮,只换这一个函数(配色类名由本站样式表给),编辑器结构
 * 与行为代码一行都不用动.
 */
function highlightSource(source: string): string {
    return source.replace(/[&<>]/g, (char) => HIGHLIGHT_ESCAPES[char] ?? char);
}

/**
 * 数据区那颗编辑器:整颗由 UI 库(`miko_ui` 的 `createCodeEditor`)生成.
 *
 * 库给的是 `div.code-editor`(行号槽 + 真 textarea + 高亮层 + 滚动/尺寸同步),
 * 结构 / 交互 / 外观都归库的 `styles/editor.css`;本站只补四件事:
 *   - **id**:CSS 与测试的定位契约(库的选项里没有 id,句柄拿到外框后补上);
 *   - **槽宽**:钉成常量,不让它随行数变(见下面与 config.ts 的同名常量);
 *   - **高亮注入**:库不认识本站放的是什么语言(见上面的 highlightSource);
 *   - **滚动条**:唯一会滚的 textarea 挂上库的 `.ui-scrollbar`.
 * 句柄整颗交回:行为代码用 `textarea` 读写值,程序化写值后调 `refresh()`
 * 让行号栏与高亮层跟上(直接写 `.value` 不派发 `input`,见 oled.ts 的 exportData).
 * 面板里只有这一套编辑器,所以"两颗框的槽宽要对齐"这条顾虑已随之消失,常量仍
 * 留着是为了行数进位时槽宽不跳.
 */
function createDataEditor(id: string): CodeEditorHandle {
    const editor = createCodeEditor({
        gutterMinWidth: OLED_PANEL_EDITOR_GUTTER_WIDTH,
        highlight: highlightSource,
    });
    editor.element.id = id;
    // 行号槽宽度钉死:库在构造时与"最大行号位数进位"时都会按当前字体重量一遍,
    // 再把结果写成 gutter 的内联 `--code-gutter-width`(实测在 32px / 35px 之间
    // 跳).内联 `!important` 压得住库随后的内联普通值,行号槽于是永不忽宽忽窄;
    // 行号栏自己不滚动(overflow: hidden,见 index.css).
    editor.gutter.style.setProperty(
        '--code-gutter-width',
        `${OLED_PANEL_EDITOR_GUTTER_WIDTH}px`,
        'important',
    );
    // 编辑器里唯一该滚的地方是 textarea(固定高度下竖着滚导出的 C 源码,长行
    // 横着滚):挂上库的滚动条规定(`styles/scrollbar.css`,由 main.ts 引入).
    editor.textarea.classList.add('ui-scrollbar');
    return editor;
}

/** 按 config.ts 的 DOM 契约生成整块 OLED 面板,并把所有引用交给调用方 */
export function createOledPanel(): OledPanel {
    // --- 工具控制区:七颗按钮 + 分段选择器,屏幕上的先后由下面 `tools` 的实参顺序定 ---
    // 从左到右:颜色重置 -> 画笔颜色 -> 三个绘图工具 -> 导出数据 -> 复制到剪贴板 -> 导入数据 -> 下载PNG -> 字节序
    // (复制 / 导入原在数据区各自一行,合并成一颗数据框之后上移到这一排,见文件头)
    /** 重置按钮:清空画布,文案 = OLED_PANEL_REFILL_BUTTON_TEXT,id 'refill-btn' */
    const refillButton = createPanelButton(OLED_DOM.refillBtnId, OLED_PANEL_REFILL_BUTTON_TEXT);
    /** 画笔颜色按钮:文案 = 当前模式的 buttonText(由 oled.ts 切换),id 'change-color' */
    const colorButton = createPanelButton(
        OLED_DOM.colorBtnId,
        OLED_COLOR_MODES[OLED_DEFAULT_COLOR_MODE].buttonText,
    );
    /** 导出按钮:生成 C 源码,文案 = OLED_PANEL_EXPORT_BUTTON_TEXT,id 'export-btn' */
    const exportButton = createPanelButton(OLED_DOM.exportBtnId, OLED_PANEL_EXPORT_BUTTON_TEXT);
    /** PNG 按钮:下载画布,文案 = OLED_PANEL_PNG_BUTTON_TEXT,id 'output-png-btn' */
    const pngButton = createPanelButton(OLED_DOM.pngBtnId, OLED_PANEL_PNG_BUTTON_TEXT);
    /** 字节序按钮:LSB / MSB 切换,文案 = OLED_BYTE_ORDER_TEXT,id 'byte-order-btn' */
    const byteOrderButton = createPanelButton(
        OLED_DOM.byteOrderBtnId,
        OLED_BYTE_ORDER_TEXT[OLED_DEFAULT_BYTE_ORDER],
    );

    // 工具选择器整组由库生成,句柄直接交回 oled.ts(不建第二份)
    /** 绘图工具分段选择器(绘制 / 直线 / 矩形,清单见 OLED_PANEL_TOOL_OPTIONS;默认 'free' 已选中) */
    const toolSelect = createToolSelect();

    // --- 状态指示区 / 主画布 ---
    /** 坐标文本:'coordinate:(X:-,Y:-)' 起,鼠标移动时由 oled.ts 改写,id 'coordsDisplay' */
    const coordsDisplay = create_element(
        { tag: 'div' },
        { class: OLED_PANEL_COORDS_CLASS, id: OLED_DOM.coordsDisplayId },
        OLED_PANEL_COORDS_TEXT,
    );
    /** 主画布:128x64 物理像素(width/height 由 oled.ts 写上),id 'pixelCanvas' */
    const canvas = create_element({ tag: 'canvas' }, { id: OLED_DEFAULT_CONFIG.canvasId });
    /** 鼠标位置指示器(跟随光标的红框,不属于画布像素),id 'pixelIndicator' */
    const indicator = create_element(
        { tag: 'div' },
        { class: OLED_PANEL_INDICATOR_CLASS, id: OLED_DOM.indicatorId },
    );

    // --- 数据区 ---
    /** 数据编辑器:导出往里写 C 源码,导入从里面抠字节(同一颗,id 'oledData') */
    const dataEditor = createDataEditor(OLED_DOM.dataEditorId);
    /** 复制按钮:把数据框里的文本送进剪贴板,文案 = OLED_COPY_BUTTON_TEXT,id 'output-button' */
    const copyButton = createPanelButton(OLED_DOM.copyBtnId, OLED_COPY_BUTTON_TEXT);
    /** 导入按钮:解析数据框里的十六进制字节,文案 = OLED_PANEL_IMPORT_BUTTON_TEXT,id 'import-btn' */
    const importButton = createPanelButton(OLED_DOM.importBtnId, OLED_PANEL_IMPORT_BUTTON_TEXT);

    /** 数据区:唯一一颗编辑器(外框由库生成),上下外边距由 `.area-data` 给 */
    const dataRow = create_element(
        { tag: 'div' },
        { class: OLED_PANEL_ROW_CLASS },
        dataEditor.element,
    );

    /**
     * 工具控制区:按屏幕上的从左到右顺序排(上面的按钮声明顺序即此顺序).
     * 数据的三颗按钮相邻成组 -- 导出 / 复制 / 导入作用于同一颗数据框(见上),
     * 中间不夹画布按钮;下载 PNG 与字节序跟在后面.
     */
    const tools = create_element(
        { tag: 'div' },
        { class: OLED_PANEL_TOOLS_CLASS },
        refillButton,
        colorButton,
        toolSelect.element,
        exportButton,
        copyButton,
        importButton,
        pngButton,
        byteOrderButton,
    );

    /**
     * 整块面板:库的 `createPanel` 建(`section.ui-panel.oled-card`),由 oled.ts
     * 插进宿主窗格.框体(标题栏 / 正文容器 / 标题文案)归库,本站只给作用域类与
     * 正文节点:坐标显示 -> 画布 -> 指示器 -> 工具区 -> 数据区(自上而下).
     */
    const root = createPanel({
        title: OLED_PANEL_TITLE_TEXT,
        class: OLED_PANEL_EXTRA_CLASS,
        body: [
            coordsDisplay,
            create_element({ tag: 'br' }),
            canvas,
            indicator,
            create_element({ tag: 'br' }),
            tools,
            create_element({ tag: 'br' }),
            create_element({ tag: 'div' }, {}, dataRow),
        ],
    }).element;

    // 交回的引用与上面创建的变量一一对应(名字相同,不另起别名)
    return {
        root,
        canvas,
        coordsDisplay,
        indicator,
        refillButton,
        colorButton,
        exportButton,
        pngButton,
        byteOrderButton,
        copyButton,
        importButton,
        dataEditor,
        toolSelect,
    };
}
