/*
OLED 像素画板的**标记组件**(声明式).

画板原先的标记写在 index.html 的 `#oled` 窗格里,再由 oled.ts 按 id 逐个取回
(`document.getElementById` / `querySelectorAll('input[name="tools"]')`) --
同一个 id 在 HTML 与 TS 里各写一份,改一处就静默失配.现在改成和地铁车窗
控制台,时钟同一条约定:宿主只提供空的标签页窗格,标记按 config.ts 的声明生成.

生成的结构与原 index.html **逐字对应**(标签名 / 类名 / id / 文本 / 属性都不变),
因为 public/css/index.css 与 bootstrap 直接命中这些类与 id(如
`canvas#pixelCanvas`,`#change-color`,`.oled-card`,`.tools`,`.textarea-data`):

    div.card.oled-card
      div.card-header > h4       'OLED Canvas'
      div.card-body
        div#coordsDisplay.coords-display.card-text   'coordinate:(X:-,Y:-)'
        br
        canvas#pixelCanvas
        div#pixelIndicator.pixel-indicator
        br
        div.tools               按钮 + 工具 radio x3 + 按钮 ...
        br
        div
          div.area-data > textarea#exportOutput.textarea-data + br + button#output-button
          div.area-data > textarea#importData.textarea-data   + br + button#import-btn

本模块是纯函数:不读页面,不改全局,不绑事件,不查 DOM,只把"描述"变成元素并把
行为代码需要的引用一次交回(与 ui/settings.ts,clock/ui/clock_display.ts 的分工一致).
插进宿主与绑事件都是 oled.ts 的事.
*/

import { h, type DomChild } from '@/common/dom';
import {
    OLED_BYTE_ORDER_TEXT,
    OLED_COLOR_MODES,
    OLED_COPY_BUTTON_TEXT,
    OLED_DEFAULT_BYTE_ORDER,
    OLED_DEFAULT_COLOR_MODE,
    OLED_DEFAULT_CONFIG,
    OLED_DEFAULT_TOOL,
    OLED_DOM,
    OLED_PANEL_BUTTON_CLASS,
    OLED_PANEL_CARD_BODY_CLASS,
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
    type OledToolOption,
} from '@/oled/config';

/** 面板交回的元素引用:行为代码需要的元素**全部**在这里,不允许回头查 DOM */
export interface OledPanel {
    /** 整块面板:div.card.oled-card(插进挂载宿主的那一个) */
    readonly root: HTMLElement;
    /** 主画布(物理像素 128x64 由 oled.ts 写到 width/height 上) */
    readonly canvas: HTMLCanvasElement;
    /** 坐标文本显示 */
    readonly coordsDisplay: HTMLElement;
    /** 鼠标位置指示器(红框) */
    readonly indicator: HTMLElement;
    /** 颜色重置按钮 */
    readonly refillButton: HTMLButtonElement;
    /** 画笔颜色切换按钮 */
    readonly colorButton: HTMLButtonElement;
    /** 导出数据按钮 */
    readonly exportButton: HTMLButtonElement;
    /** 下载 PNG 按钮 */
    readonly pngButton: HTMLButtonElement;
    /** 字节序切换按钮 */
    readonly byteOrderButton: HTMLButtonElement;
    /** 复制到剪贴板按钮 */
    readonly copyButton: HTMLButtonElement;
    /** 导入数据按钮 */
    readonly importButton: HTMLButtonElement;
    /** 导出结果 textarea */
    readonly exportTextarea: HTMLTextAreaElement;
    /** 导入数据 textarea */
    readonly importTextarea: HTMLTextAreaElement;
    /** 绘图工具 radio(顺序与 OLED_PANEL_TOOL_OPTIONS 一致,默认项已 checked) */
    readonly toolRadios: readonly HTMLInputElement[];
}

/** 一个 bootstrap 按钮:type=button + .btn.btn-primary + id + 文案 */
function createButton(id: string, text: string): HTMLButtonElement {
    return h('button', {
        class: OLED_PANEL_BUTTON_CLASS,
        text,
        attrs: { type: 'button', id },
    });
}

/**
 * 一个工具 radio.
 * 靠 name 成组(见 OLED_DOM.toolRadioName);默认工具那一项带 checked,
 * 与原先 `value="free" checked` 一致.
 */
function createToolRadio(value: string): HTMLInputElement {
    return h('input', {
        attrs: {
            type: 'radio',
            name: OLED_DOM.toolRadioName,
            value,
            ...(value === OLED_DEFAULT_TOOL ? { checked: 'checked' } : {}),
        },
    });
}

/**
 * 一个工具 radio 及其后面的文字:原标记里文字是 radio 的兄弟文本节点,
 * 所以这里返回两个节点(调用方用 flatMap 摊平).
 */
function createToolToggle(option: OledToolOption, radio: HTMLInputElement): DomChild[] {
    return [radio, option.label];
}

/** 按 config.ts 的 DOM 契约生成整块 OLED 面板,并把所有引用交给调用方 */
export function createOledPanel(): OledPanel {
    // --- 工具控制区:按钮与 radio 按原标记的先后次序 ---
    const refillButton = createButton(OLED_DOM.refillBtnId, OLED_PANEL_REFILL_BUTTON_TEXT);
    const colorButton = createButton(
        OLED_DOM.colorBtnId,
        OLED_COLOR_MODES[OLED_DEFAULT_COLOR_MODE].buttonText,
    );
    const exportButton = createButton(OLED_DOM.exportBtnId, OLED_PANEL_EXPORT_BUTTON_TEXT);
    const pngButton = createButton(OLED_DOM.pngBtnId, OLED_PANEL_PNG_BUTTON_TEXT);
    const byteOrderButton = createButton(
        OLED_DOM.byteOrderBtnId,
        OLED_BYTE_ORDER_TEXT[OLED_DEFAULT_BYTE_ORDER],
    );

    // radio 与交回的引用共用同一批元素(不能建两份)
    const toolOptions = OLED_PANEL_TOOL_OPTIONS.map((option) => ({
        option,
        radio: createToolRadio(option.value),
    }));
    const toolRadios = toolOptions.map(({ radio }) => radio);

    // --- 状态指示区 / 主画布 ---
    const coordsDisplay = h('div', {
        class: OLED_PANEL_COORDS_CLASS,
        text: OLED_PANEL_COORDS_TEXT,
        attrs: { id: OLED_DOM.coordsDisplayId },
    });
    const canvas = h('canvas', { attrs: { id: OLED_DEFAULT_CONFIG.canvasId } });
    const indicator = h('div', {
        class: OLED_PANEL_INDICATOR_CLASS,
        attrs: { id: OLED_DOM.indicatorId },
    });

    // --- 数据输入输出区 ---
    const exportTextarea = h('textarea', {
        class: OLED_PANEL_TEXTAREA_CLASS,
        attrs: { id: OLED_DOM.exportTextareaId },
    });
    const importTextarea = h('textarea', {
        class: OLED_PANEL_TEXTAREA_CLASS,
        attrs: { id: OLED_DOM.importTextareaId },
    });
    const copyButton = createButton(OLED_DOM.copyBtnId, OLED_COPY_BUTTON_TEXT);
    const importButton = createButton(OLED_DOM.importBtnId, OLED_PANEL_IMPORT_BUTTON_TEXT);

    const exportRow = h('div', { class: OLED_PANEL_ROW_CLASS }, [
        exportTextarea,
        h('br'),
        copyButton,
    ]);
    const importRow = h('div', { class: OLED_PANEL_ROW_CLASS }, [
        importTextarea,
        h('br'),
        importButton,
    ]);

    const tools = h('div', { class: OLED_PANEL_TOOLS_CLASS }, [
        refillButton,
        colorButton,
        ...toolOptions.flatMap(({ option, radio }) => createToolToggle(option, radio)),
        exportButton,
        pngButton,
        byteOrderButton,
    ]);

    const body = h('div', { class: OLED_PANEL_CARD_BODY_CLASS }, [
        coordsDisplay,
        h('br'),
        canvas,
        indicator,
        h('br'),
        tools,
        h('br'),
        h('div', {}, [exportRow, importRow]),
    ]);

    const header = h('div', { class: OLED_PANEL_CARD_HEADER_CLASS }, [
        h('h4', { text: OLED_PANEL_TITLE_TEXT }),
    ]);

    const root = h('div', { class: OLED_PANEL_CARD_CLASS }, [header, body]);

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
        exportTextarea,
        importTextarea,
        toolRadios,
    };
}
