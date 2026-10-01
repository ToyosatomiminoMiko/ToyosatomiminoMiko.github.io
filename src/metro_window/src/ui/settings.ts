/*
地铁车窗的设置面板组件(声明式).

面板的全部结构来自 ../config.ts 的 SLIDER_GROUPS / STYLE_PRESETS /
TRANSPORT_BUTTONS 等模型,本模块只负责"把模型变成元素"并交回元素引用:

  - 每个组件都是一个纯函数:接收 props,返回刚建好的元素,不读页面,不改全局;
  - `fillSettingsPanel()` 往调用方给的**设置组 fieldset** 里长内容(legend +
    控制条 + 各分组 + 状态区),并把行为代码需要绑事件的元素(风格按钮 /
    播放控制 / 每个滑块的句柄 / 状态 span)一起返回,行为代码因此不用按 id 去
    DOM 里"找"这些元素;
  - **框体与 id 不归本模块**:那颗 fieldset 由 SETTING 页建(src/setting/
    setting_page.ts:`.setting-group` 类名,id,内边距 / 底色 / 描边),
    本模块只负责它的**内容**;实测不到宿主时由挂载函数自建一颗(见
    metro_window.ts 的 createPanelSink);
  - **滑块本身由 UI 库拼**:名称 + 滑杆 + 数值框 + 重置按钮是 UI 库的
    `createSlider`(`miko_ui`),本模块只把 config.ts 的声明翻译成它的选项,
    再把句柄摊平进返回值.结构与样式(类名 `.slider-field*`)都归库,本站不再
    维护第二份;控件在设置页里的观感(配色 / 字体)由 src/setting/setting.css
    的 `.setting-group .slider-field*` 统一给 -- 同一页里不可能有两种长相.
    库从 npm 装,本地联调与取用链路见 `scripts/dev_ui_link.py` 顶部.
  - **按钮同样归库**:风格按钮与播放-暂停开关 / 重置都由 `createButton` 生成(基线类
    `.ui-button`),本站只补声明里的 id 与 `data-*`,以及"当前风格"的激活类;
    按钮外观一律归库的基线,本模块不写任何外观规则.
*/

import { createButton, create_element, createSlider, type SliderHandle } from 'miko_ui';

import {
    DEFAULT_STYLE_INDEX,
    LAYERS_NOTE,
    PANEL_LEGEND,
    SLIDER_GROUPS,
    STATUS_INITIAL,
    STATUS_LABEL,
    STYLE_BUTTON_ACTIVE_CLASS,
    STYLE_DATA_KEY,
    STYLE_PRESETS,
    TRANSPORT_BUTTONS,
    type SliderGroupSpec,
    type SliderSpec,
    type TransportAction,
} from '@/metro_window/src/config';

/** 组标题:块级排版(宽度撑满 + 左浮动)按站点的 `legend` 基线走,只放文案 */
function createLegend(text: string): HTMLLegendElement {
    return create_element({ tag: 'legend' }, {}, text);
}

/**
 * 一个滑块组件:库交回的句柄 + 它的声明式配置(行为代码按 spec 写参数).
 *
 * `slider` 转发自 {@link SliderHandle},行为代码因此不必按 id 去 DOM 里找节点;
 * 另加一个 `spec`,让"这个控件对应哪个参数"与元素引用待在一起,
 * `pushSliderValues()` 也知道要推给哪个 wasm 参数.
 */
export interface SliderControl {
    readonly spec: SliderSpec;
    /** 库的滑块句柄(值源 / 名称标签 / 重置按钮 / 生命周期都在它上面). */
    readonly slider: SliderHandle;
    /** 根节点(`<div class="slider-field">`),插进分组用这个. */
    readonly root: HTMLDivElement;
}

/**
 * 风格按钮行:三颗 `data-style` 按钮 + 承载它们的 `<div class="style-row">`.
 * 它**不**由面板独占 -- 站点把风格按钮放在首屏底部时,
 * 面板里就不该再出现第二份,所以这里把它拆成独立组件,由挂载函数决定放哪.
 */
interface StyleRow {
    readonly root: HTMLDivElement;
    readonly buttons: readonly HTMLButtonElement[];
}

/**
 * 整块设置面板的内容,以及行为代码要绑事件的元素引用.
 *
 * `root` 就是调用方交进来的那颗设置组 fieldset(内容被本函数整体接管),
 * 它同时是"加载前统一禁用 / 就绪后统一解禁"的那一层(fieldset 的 disabled
 * 会拦下组里所有输入).
 */
interface SettingsPanel {
    readonly root: HTMLFieldSetElement;
    readonly status: HTMLSpanElement;
    /** 播放-暂停开关(同一颗按钮,文案随状态切,见 config.ts 的 TRANSPORT_TOGGLE_LABEL) */
    readonly toggleButton: HTMLButtonElement;
    readonly resetButton: HTMLButtonElement;
    readonly sliders: readonly SliderControl[];
}

/**
 * 一个实时滑块:名称 + 滑杆 + 数值框 + 重置按钮,整条行由 UI 库的
 * `createSlider` 生成(值源是库内部的 signal,拖动 / 输入 / 重置都写回它).
 *
 * 本函数只做"声明 -> 选项"的翻译,再把句柄摊平成 {@link SliderControl}.
 * 库的滑块**不暴露 id**,`<label for>` 与两个输入框的关联由库内部接好,
 * 所以 config.ts 里的 `id` 在这里不再进 DOM(它仍用于声明自身的唯一性校验).
 */
function createSliderControl(spec: SliderSpec): SliderControl {
    /**
     * 数值框写回值源前的夹取:与滑杆落在同一个区间里.
     *
     * 只在数值框这条路上:**滑杆本身越不了界**(range 由浏览器按 min/max 夹住),
     * 再走一遍夹取是多余的.
     *
     * 时机:`input`(每次按键)与 `change`(失焦 / 回车)两次写回都会经过它(见库
     * `NumberField` 的 `pushToSource`),所以值源里**永远**是区间内的数,滑杆与
     * wasm 都不会拿到越界值.输入框里的文本是另一回事:控件在 `input` 阶段不改写
     * 用户正在编辑的文本(空串 / `1.` / `1e` 都不动),归一化后的文本要到
     * `change` 才落回输入框(库的滑块把这一步接在 `number.onCommit` 上).
     */
    const clampNumber = (value: number): number =>
        Math.min(spec.max, Math.max(spec.min, value));

    const slider = createSlider({
        // 区间与初值都从声明来:滑杆与数值框拿到的是同一份解析后的区间.
        value: spec.value,
        min: spec.min,
        max: spec.max,
        step: spec.step,
        label: spec.label,
        hint: spec.hint,
        // 重置目标 = 声明值:点一下回到 config.ts 里写的那一档.
        resetValue: spec.value,
        // 数值框的越界输入夹回区间(与 Rust 侧的 clamp 同区间,前端先夹一次).
        normalize: clampNumber,
    });

    // 宽度不在这里定:一块滑块在一排里占多宽是本站的口径,那条规则(连同它的
    // --metro-slider-field-width)只在 metro_window.css 的 `.slider-field` 上写一份.
    return {
        spec,
        slider,
        root: slider.element,
    };
}

/**
 * 一个滑块分组:**一行静态标题 + 若干滑块,不可折叠**.
 *
 * 实时参数一共两组 7 个滑块,都默认整组可见 -- 折叠只会多一层点击;标题只负责
 * 说明"这一排调的是什么",所以是静态的 `<div class="slider-group-title">`,
 * 不是可点击的 `<summary>`.
 */
function createSliderGroup(group: SliderGroupSpec): { element: HTMLDivElement; controls: SliderControl[] } {
    const controls = group.sliders.map(createSliderControl);
    const element = create_element(
        { tag: 'div' },
        { class: 'slider-group' },
        create_element({ tag: 'div' }, { class: 'slider-group-title' }, group.title),
        create_element({ tag: 'div' }, { class: 'slider-grid' }, ...controls.map((control) => control.root)),
    );
    return { element, controls };
}

/** 三颗风格按钮;当前风格(DEFAULT_STYLE_INDEX)初始即高亮 */
export function createStyleRow(): StyleRow {
    const buttons = STYLE_PRESETS.map((preset) => {
        const active = preset.index === DEFAULT_STYLE_INDEX;
        // 按钮本体(基线 `.ui-button`)归库;`.active` 是本站叠在基线之后的
        // 状态钩子(库的按钮没有"当前项"这个概念,见 metro_window.css 那一条).
        const button = createButton({
            text: preset.label,
            class: active ? STYLE_BUTTON_ACTIVE_CLASS : undefined,
        }).element;
        button.dataset[STYLE_DATA_KEY] = String(preset.index);
        return button;
    });
    return { root: create_element({ tag: 'div' }, { class: 'style-row' }, ...buttons), buttons };
}

/** 播放-暂停开关 + 重置;加载前的禁用由外层 fieldset 统一负责(见 fillSettingsPanel) */
function createTransportButtons(): Record<TransportAction, HTMLButtonElement> {
    const entries = TRANSPORT_BUTTONS.map((spec) => {
        const button = createButton({ text: spec.label }).element;
        button.id = spec.id;
        return [spec.action, button] as const;
    });
    return Object.fromEntries(entries) as Record<TransportAction, HTMLButtonElement>;
}

/**
 * 把设置面板的内容长进给定的设置组 fieldset,文档流顺序即这里写出的顺序:
 *
 *     <fieldset class="setting-group" id="metro-params">   <- host,由 SETTING 页建
 *       <legend>实时参数</legend>                            <- 本函数放最前
 *       <div class="controls">           <- [风格按钮行?] + 播放控制(按文档流排)
 *       <div class="slider-group">       <- 每个分组一个(来自 SLIDER_GROUPS)
 *         <div class="slider-group-title">  <- 静态标题,不可折叠
 *         <div class="slider-grid">        <- 该组的滑块
 *       <div class="gpu_info">           <- 状态 span + 图层说明
 *     </fieldset>
 *
 * 所有内容都来自 config.ts 的声明式模型,本函数不写死任何文案或数值;
 * 返回的元素引用供 metro_window.ts 绑事件与切换状态,所以调用方无需再查 DOM.
 *
 * **整体接管宿主内容**(replaceChildren):重复挂载不会把面板插两遍,宿主里
 * 也不会残留上一次的标记.初始 disabled:wasm 与 WebGPU 就绪前不可操作,
 * 挂载流程完成后由行为代码打开.
 *
 * `styleRow` 是**传进来**的,不在这里新建:风格按钮行可能被挂到首屏底部
 * (切风格属于"看",与时钟同排更顺手),那时面板里就不该再多出第二份.
 * 传 null 表示风格按钮行挂在别处 -- 此时控制条只剩播放控制(开关 + 重置).
 */
export function fillSettingsPanel(
    host: HTMLFieldSetElement,
    styleRow: StyleRow | null,
): SettingsPanel {
    // 两组滑块分组,顺序即 config.ts 里的声明顺序(各自带已建好的滑块控件).
    const groups = SLIDER_GROUPS.map(createSliderGroup);
    const transport = createTransportButtons();

    // 播放控制直接按文档流排:两颗按钮的顺序在这里显式写出,和 TRANSPORT_BUTTONS
    // 的声明顺序一致(两个按钮之间的间距由 metro_window.css 的 `.controls button + button` 给).
    const controls = create_element(
        { tag: 'div' },
        { class: 'controls' },
        ...(styleRow ? [styleRow.root] : []),
        transport.toggle,
        transport.reset,
    );

    // 状态 span 先带上初始文案;启动失败时由 metro_window.ts 改写 innerHTML
    // 追加启用 WebGPU 的帮助步骤(所以这里只给 textContent,不预先塞 HTML).
    const status = create_element({ tag: 'span' }, {}, STATUS_INITIAL);
    // 状态区 = 粗体标签 + 一个空格文本节点 + 状态 span + 图层说明;
    // 中间那个 ' ' 不能省:它是 <strong> 与 <span> 之间的可见间隔.
    const gpuInfo = create_element(
        { tag: 'div' },
        { class: 'gpu_info' },
        create_element({ tag: 'strong' }, {}, STATUS_LABEL),
        ' ',
        status,
        create_element({ tag: 'div' }, { class: 'layers' }, LAYERS_NOTE),
    );

    // 内容整体接管:legend -> 控制条 -> 各分组 -> 状态区.
    // 框体 / id / 类名都在宿主上(由 SETTING 页给),这里一个都不碰.
    host.replaceChildren(
        createLegend(PANEL_LEGEND),
        controls,
        ...groups.map((group) => group.element),
        gpuInfo,
    );
    // 浏览器会自动置灰 disabled 的 fieldset 并拦下所有输入,
    // boot() 成功后由行为代码置回 false.
    host.disabled = true;

    // 摊平所有分组里的滑块,行为代码按这一份清单逐个绑事件(顺序即界面顺序).
    return {
        root: host,
        status,
        toggleButton: transport.toggle,
        resetButton: transport.reset,
        sliders: groups.flatMap((group) => group.controls),
    };
}
