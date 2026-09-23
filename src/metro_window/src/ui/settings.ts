/*
地铁车窗的设置面板组件(声明式).

面板的全部结构来自 ../config.ts 的 SLIDER_GROUPS / STYLE_PRESETS /
TRANSPORT_BUTTONS 等模型,本模块只负责"把模型变成元素"并交回元素引用:

  - 每个组件都是一个纯函数:接收 props,返回刚建好的元素,不读页面,不改全局;
  - `createSettingsPanel()` 一次建出整块 <fieldset>,并把行为代码需要绑事件的
    元素(风格按钮 / 播放控制 / 每个滑块的滑杆与数值框 / 状态 span)一起返回,
    因此 metro_window.ts 不再需要按 id 去 DOM 里"找"这些元素;
  - **滑块本身不再由本模块拼**:名称 + 滑杆 + 数值框 + 重置按钮是 UI 库的
    `createSlider`(`@miko/ui`),本模块只把 config.ts 的声明翻译成它的选项,
    再把句柄摊平进返回值.结构与样式(类名 `.slider-field*`)都归库,本站不再
    维护第二份;库的取用链路见 `scripts/fetch_ui.sh` 顶部.
*/

import { createSlider, type SliderHandle } from '@miko/ui';

import {
    DEFAULT_STYLE_INDEX,
    LAYERS_NOTE,
    PANEL_ID,
    PANEL_LEGEND,
    SLIDER_GROUPS,
    SLIDER_WIDTH_PROPERTY,
    STATUS_ID,
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
import { h } from '@/common/dom';

/**
 * 一个滑块组件:库交回的句柄 + 它的声明式配置(行为代码按 spec 写参数).
 *
 * 后面四个字段都是转发自 {@link SliderHandle} 的**元素引用**,行为代码因此不必
 * 按 id 去 DOM 里找节点;另加一个 `spec`,让"这个控件对应哪个参数"与元素引用
 * 待在一起,`pushSliderValues()` 也知道要推给哪个 wasm 参数.
 */
export interface SliderControl {
    readonly spec: SliderSpec;
    /** 库的滑块句柄(值源 / 名称标签 / 重置按钮 / 生命周期都在它上面). */
    readonly slider: SliderHandle;
    /** 根节点(`<div class="slider-field">`),插进分组用这个. */
    readonly root: HTMLDivElement;
    /** 原生滑杆 `<input type="range">`. */
    readonly range: HTMLInputElement;
    /** 数值框句柄:`read` / `readText` / `write` 在它上面,`min`/`max` 在 `.input` 上. */
    readonly number: SliderHandle['number'];
}

/**
 * 风格按钮行:三颗 `data-style` 按钮 + 承载它们的 `<div class="style-row">`.
 * 它**不**由面板独占 -- 站点把风格按钮放在首屏底部(与 LED 时钟同排)时,
 * 面板里就不该再出现第二份,所以这里把它拆成独立组件,由挂载函数决定放哪.
 */
export interface StyleRow {
    readonly root: HTMLDivElement;
    readonly buttons: readonly HTMLButtonElement[];
}

/** 整块设置面板,以及行为代码要绑事件的元素引用 */
export interface SettingsPanel {
    readonly root: HTMLFieldSetElement;
    readonly status: HTMLSpanElement;
    readonly startButton: HTMLButtonElement;
    readonly pauseButton: HTMLButtonElement;
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
     * 时机:`input` 与 `change`(失焦 / 回车)两次写回都会经过它(见库
     * `NumberField` 的 `pushToSource`),所以值源里**永远**是区间内的数,
     * 滑杆与 wasm 都不会拿到越界值;输入框里那串原始文本要到 `change` 才被
     * 回填成夹取后的文本.注意别照抄库注释里"归一化只在 change"的说法 --
     * 那是过期描述,库自己的实现与注释在这一点上不一致.
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

    // 宽度:声明里写了 width 才覆盖,留空时用库的默认值(styles/widgets.css 里
    // `.slider-field` 的 --slider-field-width 口径).这里只设一个 CSS 自定义属性,
    // 布局规则仍留在库的样式表里;默认所有声明都不写 width,宽度自然统一.
    if (spec.width !== undefined) {
        slider.element.style.setProperty(SLIDER_WIDTH_PROPERTY, spec.width);
    }

    return {
        spec,
        slider,
        root: slider.element,
        range: slider.input,
        number: slider.number,
    };
}

/** 一个可折叠分组:summary + 若干滑块 */
function createSliderGroup(group: SliderGroupSpec): { element: HTMLDetailsElement; controls: SliderControl[] } {
    const controls = group.sliders.map(createSliderControl);
    const details = h('details', { class: 'slider-group' }, [
        h('summary', { text: group.title }),
        h('div', { class: 'slider-grid' }, controls.map((control) => control.root)),
    ]);
    details.open = group.open;
    return { element: details, controls };
}

/** 三颗风格按钮;当前风格(DEFAULT_STYLE_INDEX)初始即高亮 */
export function createStyleRow(): StyleRow {
    const buttons = STYLE_PRESETS.map((preset) => {
        const active = preset.index === DEFAULT_STYLE_INDEX;
        return h('button', {
            class: active ? STYLE_BUTTON_ACTIVE_CLASS : '',
            text: preset.label,
            dataset: { [STYLE_DATA_KEY]: preset.index },
        });
    });
    return { root: h('div', { class: 'style-row' }, buttons), buttons };
}

/** 播放 / 暂停 / 重置;初始禁用状态由配置决定 */
function createTransportButtons(): Record<TransportAction, HTMLButtonElement> {
    const entries = TRANSPORT_BUTTONS.map((spec) => {
        const button = h('button', { attrs: { id: spec.id }, text: spec.label });
        button.disabled = spec.disabled;
        return [spec.action, button] as const;
    });
    return Object.fromEntries(entries) as Record<TransportAction, HTMLButtonElement>;
}

/**
 * 建出整块设置面板,顺序与重构前的 HTML 完全一致:
 *
 *     <fieldset class="sliders">         <- root,初始 disabled
 *       <legend>🎚 实时参数</legend>
 *       <div class="controls">           <- [风格按钮行?] + .spacer + 播放控制
 *       <details class="slider-group">   <- 每个分组一个(来自 SLIDER_GROUPS)
 *       <div class="gpu_info">           <- 状态 span + 图层说明
 *     </fieldset>
 *
 * 所有内容都来自 config.ts 的声明式模型,本函数不写死任何文案或数值;
 * 返回的元素引用供 metro_window.ts 绑事件与切换状态,所以调用方无需再查 DOM.
 * 初始 disabled:wasm 与 WebGPU 就绪前不可操作,挂载流程完成后打开.
 *
 * `styleRow` 是**传进来**的,不在这里新建:风格按钮行可能被挂到首屏底部
 * (切风格属于"看",与时钟同排更顺手),那时面板里就不该再多出第二份.
 * 传 null 表示风格按钮行挂在别处 -- 此时控制条只剩 .spacer 与播放控制.
 */
export function createSettingsPanel(styleRow: StyleRow | null): SettingsPanel {
    // 三个滑块分组,顺序即 config.ts 里的声明顺序(各自带已建好的滑块控件).
    const groups = SLIDER_GROUPS.map(createSliderGroup);
    const transport = createTransportButtons();

    // .spacer 是 flex:1 的空 span:把后面的播放/暂停/重置推到右边.
    // 三颗播放按钮的顺序在这里显式写出,和 TRANSPORT_BUTTONS 的声明顺序保持一致.
    const controls = h('div', { class: 'controls' }, [
        ...(styleRow ? [styleRow.root] : []),
        h('span', { class: 'spacer' }),
        transport.start,
        transport.pause,
        transport.reset,
    ]);

    // 状态 span 先带上 id 与初始文案;启动失败时由 metro_window.ts 改写 innerHTML
    // 追加启用 WebGPU 的帮助步骤(所以这里只给 textContent,不预先塞 HTML).
    const status = h('span', { attrs: { id: STATUS_ID }, text: STATUS_INITIAL });
    // 状态区 = 粗体标签 + 一个空格文本节点 + 状态 span + 图层说明;
    // 中间那个 ' ' 不能省:它是 <strong> 与 <span> 之间的可见间隔.
    const gpuInfo = h('div', { class: 'gpu_info' }, [
        h('strong', { text: STATUS_LABEL }),
        ' ',
        status,
        h('div', { class: 'layers', text: LAYERS_NOTE }),
    ]);

    // 整块 fieldset:legend -> 控制条 -> 各分组 -> 状态区.
    // 外层类名 .sliders 是 CSS 的作用域锚点,id 只用于调试/自动化定位.
    const root = h('fieldset', { class: 'sliders', attrs: { id: PANEL_ID } }, [
        h('legend', { text: PANEL_LEGEND }),
        controls,
        ...groups.map((group) => group.element),
        gpuInfo,
    ]);
    // 加载完成前整块禁用(浏览器会自动置灰并拦下所有输入),boot() 成功后置回 false.
    root.disabled = true;

    // 摊平所有分组里的滑块,行为代码按这一份清单逐个绑事件(顺序即界面顺序).
    return {
        root,
        status,
        startButton: transport.start,
        pauseButton: transport.pause,
        resetButton: transport.reset,
        sliders: groups.flatMap((group) => group.controls),
    };
}
