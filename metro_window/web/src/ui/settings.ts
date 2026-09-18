/*
地铁车窗的设置面板组件(声明式).

面板的全部结构来自 ../config.ts 的 SLIDER_GROUPS / STYLE_PRESETS /
TRANSPORT_BUTTONS 等模型,本模块只负责"把模型变成元素"并交回元素引用:

  - 每个组件都是一个纯函数:接收 props,返回刚建好的元素,不读页面,不改全局;
  - `createSettingsPanel()` 一次建出整块 <fieldset>,并把行为代码需要绑事件的
    元素(风格按钮 / 播放控制 / 每个滑块的 range 与 number / 状态 span)一起返回,
    因此 metro_window.ts 不再需要按 id 去 DOM 里"找"这些元素;
  - 滑块的新布局在 `createSlider()` 里一处定义:
        <div class="slider">            <- 最外层 div,样式统一由它控制
          <input class="slider-range">
          <div class="slider-meta">
            <label class="slider-label">名称</label>
            <input class="slider-value"> <- 数值靠右
          </div>
        </div>
*/

import {
    DEFAULT_STYLE_INDEX,
    LAYERS_NOTE,
    PANEL_ID,
    PANEL_LEGEND,
    SLIDER_GROUPS,
    SLIDER_WIDTH_DEFAULT,
    SLIDER_WIDTH_PROPERTY,
    STATUS_ID,
    STATUS_INITIAL,
    STATUS_LABEL,
    STYLE_BUTTON_ACTIVE_CLASS,
    STYLE_BUTTON_CLASS,
    STYLE_DATA_KEY,
    STYLE_PRESETS,
    TRANSPORT_BUTTONS,
    type SliderGroupSpec,
    type SliderSpec,
    type TransportAction,
} from '../config';
import { h, type DomChild } from './dom';

/** 一个滑块组件:根元素 + 两个输入框 + 它的声明式配置(行为代码按 spec 写参数) */
export interface SliderControl {
    readonly spec: SliderSpec;
    /** 最外层 <div class="slider"> */
    readonly root: HTMLDivElement;
    /** 上方的滑杆 <input type="range"> */
    readonly range: HTMLInputElement;
    /** 下方的数值框 <input type="number"> */
    readonly number: HTMLInputElement;
}

/** 整块设置面板,以及行为代码要绑事件的元素引用 */
export interface SettingsPanel {
    readonly root: HTMLFieldSetElement;
    readonly status: HTMLSpanElement;
    readonly styleButtons: readonly HTMLButtonElement[];
    readonly startButton: HTMLButtonElement;
    readonly pauseButton: HTMLButtonElement;
    readonly resetButton: HTMLButtonElement;
    readonly sliders: readonly SliderControl[];
}

/**
 * 一个实时滑块:上层滑杆,下层"名称(左) + 数值(右)".
 * 最外层是 div.slider,内边距/间距/圆角/底色/宽度都由这一层统一控制.
 */
function createSlider(spec: SliderSpec): SliderControl {
    const range = h('input', {
        class: 'slider-range',
        attrs: { id: spec.id, type: 'range', min: spec.min, max: spec.max, step: spec.step, value: spec.value },
    });
    const number = h('input', {
        class: 'slider-value',
        attrs: { type: 'number', min: spec.min, max: spec.max, step: spec.step, value: spec.value },
    });

    const labelChildren: DomChild[] = [spec.label];
    if (spec.hint !== undefined) {
        labelChildren.push(h('small', { text: spec.hint }));
    }
    const label = h('label', { class: 'slider-label', attrs: { for: spec.id } }, labelChildren);

    const root = h('div', { class: 'slider' }, [
        range,
        h('div', { class: 'slider-meta' }, [label, number]),
    ]);
    // 宽度:声明里写了 width 就用它,留空回落默认值(tokens.css 的 --metro-size-slider-width).
    // 这里只设一个 CSS 自定义属性,真正的布局规则仍留在 metro_window.css 的 .slider 里;
    // 因为默认所有声明都不写 width,所有滑块拿到同一个值,宽度自然统一.
    root.style.setProperty(SLIDER_WIDTH_PROPERTY, spec.width ?? SLIDER_WIDTH_DEFAULT);
    return { spec, root, range, number };
}

/** 一个可折叠分组:summary + 若干滑块 */
function createSliderGroup(group: SliderGroupSpec): { element: HTMLDetailsElement; controls: SliderControl[] } {
    const controls = group.sliders.map(createSlider);
    const details = h('details', { class: 'slider-group' }, [
        h('summary', { text: group.title }),
        h('div', { class: 'slider-grid' }, controls.map((control) => control.root)),
    ]);
    details.open = group.open;
    return { element: details, controls };
}

/** 三颗风格按钮;当前风格(DEFAULT_STYLE_INDEX)初始即高亮 */
function createStyleButtons(): HTMLButtonElement[] {
    return STYLE_PRESETS.map((preset) => {
        const active = preset.index === DEFAULT_STYLE_INDEX;
        return h('button', {
            class: active ? `${STYLE_BUTTON_CLASS} ${STYLE_BUTTON_ACTIVE_CLASS}` : STYLE_BUTTON_CLASS,
            text: preset.label,
            dataset: { [STYLE_DATA_KEY]: preset.index },
        });
    });
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
 *       <div class="controls">           <- 风格按钮 + .spacer + 播放控制
 *       <details class="slider-group">   <- 每个分组一个(来自 SLIDER_GROUPS)
 *       <div class="gpu_info">           <- 状态 span + 图层说明
 *     </fieldset>
 *
 * 所有内容都来自 config.ts 的声明式模型,本函数不写死任何文案或数值;
 * 返回的元素引用供 metro_window.ts 绑事件与切换状态,所以调用方无需再查 DOM.
 * 初始 disabled:wasm 与 WebGPU 就绪前不可操作,挂载流程完成后打开.
 */
export function createSettingsPanel(): SettingsPanel {
    // 三个滑块分组,顺序即 config.ts 里的声明顺序(各自带已建好的滑块控件).
    const groups = SLIDER_GROUPS.map(createSliderGroup);
    // 风格按钮与播放控制分开建:前者按 STYLE_PRESETS,后者按 TRANSPORT_BUTTONS.
    const styleButtons = createStyleButtons();
    const transport = createTransportButtons();

    // .spacer 是 flex:1 的空 span:把后面的播放/暂停/重置推到右边,与风格按钮分开.
    // 三颗播放按钮的顺序在这里显式写出,和 TRANSPORT_BUTTONS 的声明顺序保持一致.
    const controls = h('div', { class: 'controls' }, [
        ...styleButtons,
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
        styleButtons,
        startButton: transport.start,
        pauseButton: transport.pause,
        resetButton: transport.reset,
        sliders: groups.flatMap((group) => group.controls),
    };
}
