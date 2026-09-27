/*
OLED 像素画板的**标记组件**(声明式).

画板原先的标记写在 index.html 的 `#oled` 窗格里,再由 oled.ts 按 id 逐个取回
(`document.getElementById` / `querySelectorAll('input[name="tools"]')`) --
同一个 id 在 HTML 与 TS 里各写一份,改一处就静默失配.现在改成和地铁车窗
控制台,时钟同一条约定:宿主只提供空的标签页窗格,标记按 config.ts 的声明生成.

生成的结构与原 index.html **逐字对应**(标签名 / 类名 / id / 文本 / 属性都不变),
因为 public/css/index.css 与 bootstrap 直接命中这些类与 id(如
`canvas#pixelCanvas`,`#change-color`,`.oled-card`,`.tools`,`.textarea-data`).
**两处例外都归库**:面板里的七颗按钮改由 `miko_ui` 的 `createButton` 生成
(基线类 `.ui-button`);三个绘图工具由库的 `createSegmented` 生成
(`div.segmented` + 三颗组内按钮),不再是 `input[name="tools"]` 那组 radio.
id 仍按下面的契约写上,`#change-color` 那条配色规则已从 index.css 撤掉.

    div.card.oled-card
      div.card-header > h4       'OLED Canvas'
      div.card-body
        div#coordsDisplay.coords-display.card-text   'coordinate:(X:-,Y:-)'
        br
        canvas#pixelCanvas
        div#pixelIndicator.pixel-indicator
        br
        div.tools               按钮 + div.segmented(库的分段选择器) + 按钮 ...
        br
        div
          div.area-data > textarea#exportOutput.textarea-data + br + button#output-button
          div.area-data > textarea#importData.textarea-data   + br + button#import-btn

本模块是纯函数:不读页面,不改全局,不绑事件,不查 DOM,只把"描述"变成元素并把
行为代码需要的引用一次交回(与 ui/settings.ts,clock/ui/clock_display.ts 的分工一致).
插进宿主与绑事件都是 oled.ts 的事.
*/

import { createButton, createSegmented, type SegmentedHandle } from 'miko_ui';

import { h } from '@/common/dom';
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
    OLED_PANEL_EXPORT_BUTTON_TEXT,
    OLED_PANEL_IMPORT_BUTTON_TEXT,
    OLED_PANEL_INDICATOR_CLASS,
    OLED_PANEL_PNG_BUTTON_TEXT,
    OLED_PANEL_REFILL_BUTTON_TEXT,
    OLED_PANEL_ROW_CLASS,
    OLED_PANEL_TEXTAREA_CLASS,
    OLED_PANEL_TITLE_TEXT,
    OLED_PANEL_TOOLS_CLASS,
    OLED_PANEL_TOOL_GROUP_LABEL,
    OLED_PANEL_TOOL_OPTIONS,
} from '@/oled/config';
import type { DrawTool } from '@/oled/types';

/** 面板交回的元素引用:行为代码需要的元素**全部**在这里,不允许回头查 DOM */
export interface OledPanel {
    /** 整块面板:div.card.oled-card(插进挂载宿主的那一个) */
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
    /** 复制按钮:把导出文本送进剪贴板,文案 = OLED_COPY_BUTTON_TEXT,id 'output-button' */
    readonly copyButton: HTMLButtonElement;
    /** 导入按钮:解析导入框里的十六进制字节,文案 = OLED_PANEL_IMPORT_BUTTON_TEXT,id 'import-btn' */
    readonly importButton: HTMLButtonElement;
    /** 导出结果输入框:textarea#exportOutput(放生成的 C 源码) */
    readonly exportTextarea: HTMLTextAreaElement;
    /** 导入输入框:textarea#importData(粘贴 1024 个十六进制字节) */
    readonly importTextarea: HTMLTextAreaElement;
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

/** 按 config.ts 的 DOM 契约生成整块 OLED 面板,并把所有引用交给调用方 */
export function createOledPanel(): OledPanel {
    // --- 工具控制区:按钮与 radio 按原标记的先后次序 ---
    // 屏幕上这一排从左到右:重置按钮 -> 画笔颜色按钮 -> 三个工具 radio -> 导出按钮 -> PNG 按钮 -> 字节序按钮
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
    const coordsDisplay = h('div', {
        class: OLED_PANEL_COORDS_CLASS,
        text: OLED_PANEL_COORDS_TEXT,
        attrs: { id: OLED_DOM.coordsDisplayId },
    });
    /** 主画布:128x64 物理像素(width/height 由 oled.ts 写上),id 'pixelCanvas' */
    const canvas = h('canvas', { attrs: { id: OLED_DEFAULT_CONFIG.canvasId } });
    /** 鼠标位置指示器(跟随光标的红框,不属于画布像素),id 'pixelIndicator' */
    const indicator = h('div', {
        class: OLED_PANEL_INDICATOR_CLASS,
        attrs: { id: OLED_DOM.indicatorId },
    });

    // --- 数据输入输出区 ---
    /** 导出结果输入框:放导出按钮生成的 C 源码,id 'exportOutput' */
    const exportTextarea = h('textarea', {
        class: OLED_PANEL_TEXTAREA_CLASS,
        attrs: { id: OLED_DOM.exportTextareaId },
    });
    /** 导入输入框:粘贴 1024 个十六进制字节,id 'importData' */
    const importTextarea = h('textarea', {
        class: OLED_PANEL_TEXTAREA_CLASS,
        attrs: { id: OLED_DOM.importTextareaId },
    });
    /** 复制按钮:把导出文本送进剪贴板,文案 = OLED_COPY_BUTTON_TEXT,id 'output-button' */
    const copyButton = createPanelButton(OLED_DOM.copyBtnId, OLED_COPY_BUTTON_TEXT);
    /** 导入按钮:解析导入框里的十六进制字节,文案 = OLED_PANEL_IMPORT_BUTTON_TEXT,id 'import-btn' */
    const importButton = createPanelButton(OLED_DOM.importBtnId, OLED_PANEL_IMPORT_BUTTON_TEXT);

    /** 导出区一行:导出输入框 + 换行 + 复制按钮 */
    const exportRow = h('div', { class: OLED_PANEL_ROW_CLASS }, [
        exportTextarea,
        h('br'),
        copyButton,
    ]);
    /** 导入区一行:导入输入框 + 换行 + 导入按钮 */
    const importRow = h('div', { class: OLED_PANEL_ROW_CLASS }, [
        importTextarea,
        h('br'),
        importButton,
    ]);

    /** 工具控制区:按屏幕上的从左到右顺序排(上面的按钮声明顺序即此顺序) */
    const tools = h('div', { class: OLED_PANEL_TOOLS_CLASS }, [
        refillButton,
        colorButton,
        toolSelect.element,
        exportButton,
        pngButton,
        byteOrderButton,
    ]);

    /** 卡片主体:坐标显示 -> 画布 -> 指示器 -> 工具区 -> 数据区(自上而下) */
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

    /** 卡片标题栏:只有 <h4>'OLED Canvas' */
    const header = h('div', { class: OLED_PANEL_CARD_HEADER_CLASS }, [
        h('h4', { text: OLED_PANEL_TITLE_TEXT }),
    ]);

    /** 整块面板:div.card.oled-card,由 oled.ts 插进宿主窗格 */
    const root = h('div', { class: OLED_PANEL_CARD_CLASS }, [header, body]);

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
        exportTextarea,
        importTextarea,
        toolSelect,
    };
}
