/*
IEEE 754 面板的**标记组件**(声明式).

面板原先写死在 index.html 的 `#ieee754` 窗格里,再由 ieee754.ts 按 id 一个个取回
(`getElementById` / `querySelector`),两处各写一份 id,改一处就静默失配.现在改成
和地铁车窗控制台同一条约定:宿主只提供空窗格(骨架里的 `.tab-pane#ieee754`),
标记按 config.ts 的声明生成,并把行为代码要用的**元素引用**一起交回:

    <div class="card">
      <div class="card-header"><h4>🧮 IEEE 754 浮点可视化</h4></div>
      <div class="card-body">
        <p class="ieee-hint">...</p>
        <div class="row g-3 align-items-center mb-3">
          <div class="col-auto">精度 label + select#ieee-format</div>
          <div class="col-6">十进制 label + input-group(input#ieee-input + button#ieee-convert)</div>
        </div>
        <div id="ieee-error" class="ieee-error" hidden></div>
        <div class="ieee-section">
          <div class="ieee-legend">S / E / M 三项(位数提示是 <b data-role="...">)</div>
          <div id="ieee-bits" class="ieee-bits"></div>
          <div id="ieee-bitstring" class="ieee-bitstring"></div>
        </div>
        <div id="ieee-breakdown" class="ieee-breakdown"></div>
        <div class="ieee-section">
          <div class="ieee-formula-title">公式 (KaTeX)</div>
          <div id="ieee-formula" class="ieee-formula"></div>
        </div>
        <div class="ieee-section">
          <div class="ieee-formula-title">特殊值参考 (点击载入)</div>
          <div id="ieee-special" class="ieee-special"></div>
        </div>
      </div>
    </div>

本模块是纯函数:不读页面,不改全局,不绑事件(`addEventListener` / 初始渲染都是
ieee754.ts 的事),只把"描述"变成元素并交回引用 -- 与 ui/settings.ts 的分工一致.
标记的形状与类名逐个照搬重构前的 index.html,`public/css/ieee754.css` 按这些
id / class 命中,不得合并或省略.
*/

import { h, type DomChild } from '@/common/dom';
import {
    IEEE754_BITS_CLASS,
    IEEE754_BITSTRING_CLASS,
    IEEE754_BREAKDOWN_CLASS,
    IEEE754_BUTTON_CLASS,
    IEEE754_BUTTON_TYPE,
    IEEE754_CARD_BODY_CLASS,
    IEEE754_CARD_CLASS,
    IEEE754_CARD_HEADER_CLASS,
    IEEE754_COL_AUTO_CLASS,
    IEEE754_COL_HALF_CLASS,
    IEEE754_CONTROLS_ROW_CLASS,
    IEEE754_CONVERT_LABEL,
    IEEE754_DOM,
    IEEE754_ERROR_CLASS,
    IEEE754_EXP_BITS_ROLE,
    IEEE754_FORMAT_LABEL,
    IEEE754_FORMAT_OPTIONS,
    IEEE754_FORMULA_CLASS,
    IEEE754_FORMULA_TITLE,
    IEEE754_FORMULA_TITLE_CLASS,
    IEEE754_FRAC_BITS_ROLE,
    IEEE754_HINT_CLASS,
    IEEE754_HINT_TEXT,
    IEEE754_INPUT_CLASS,
    IEEE754_INPUT_GROUP_CLASS,
    IEEE754_INPUT_INITIAL_VALUE,
    IEEE754_INPUT_LABEL,
    IEEE754_INPUT_SPELLCHECK,
    IEEE754_LABEL_CLASS,
    IEEE754_LEGEND_CLASS,
    IEEE754_LEGENDS,
    IEEE754_PANEL_TITLE,
    IEEE754_SECTION_CLASS,
    IEEE754_SELECT_CLASS,
    IEEE754_SPECIAL_CLASS,
    IEEE754_SPECIAL_TITLE,
    type IEEE754FormatOptionSpec,
    type IEEE754LegendPart,
} from '@/ieee754/config';

/** 面板的全部结构,以及行为代码要用的元素引用 */
export interface Ieee754Panel {
    /** div.card */
    readonly root: HTMLElement;
    /** #ieee-format */
    readonly formatSelect: HTMLSelectElement;
    /** #ieee-input */
    readonly input: HTMLInputElement;
    /** #ieee-convert */
    readonly convertButton: HTMLButtonElement;
    /** #ieee-bits */
    readonly bits: HTMLElement;
    /** #ieee-bitstring */
    readonly bitstring: HTMLElement;
    /** #ieee-breakdown */
    readonly breakdown: HTMLElement;
    /** #ieee-formula */
    readonly formula: HTMLElement;
    /** #ieee-error(初始 hidden) */
    readonly error: HTMLElement;
    /** #ieee-special */
    readonly special: HTMLElement;
    /** 图例里的指数位数提示 <b data-role="exp-bits"> */
    readonly expBitsLabel: HTMLElement;
    /** 图例里的尾数位数提示 <b data-role="frac-bits"> */
    readonly fracBitsLabel: HTMLElement;
}

/** 一个精度 option:selected 是布尔属性,按原标记的写法显式写出来 */
function createFormatOption(spec: IEEE754FormatOptionSpec): HTMLOptionElement {
    const attrs: Record<string, string> = { value: spec.value };
    if (spec.selected) {
        attrs.selected = 'selected';
    }
    return h('option', { text: spec.label, attrs });
}

/** 图例里的一段:纯文本直接返回;位数提示生成 <b> 并把它登记进 sink(供调用方交回引用) */
function createLegendPart(part: IEEE754LegendPart, sink: Record<string, HTMLElement>): DomChild {
    if (!('bitsRole' in part)) {
        return part.text;
    }
    const label = h('b', { dataset: { role: part.bitsRole }, text: String(part.bits) });
    sink[part.bitsRole] = label;
    return label;
}

/**
 * 生成整块面板并交回元素引用.
 *
 * 位数提示两个 <b> 的引用:组件在这里把它们按 data-role 收进 sink,再按 config 里
 * 声明的角色取回,所以不需要 querySelector.角色是同一份模型里的字面量,
 * 声明里少一项就等于模型自身不完整 -- 这是构造上的保证,不再有运行期缺失分支.
 */
export function createIeee754Panel(): Ieee754Panel {
    const bitsLabels: Record<string, HTMLElement> = {};
    const legend = h('div', { class: IEEE754_LEGEND_CLASS }, IEEE754_LEGENDS.map((spec) =>
        h('span', { class: spec.className }, spec.parts.map((part) => createLegendPart(part, bitsLabels))),
    ));

    const formatSelect = h('select', { class: IEEE754_SELECT_CLASS, attrs: { id: IEEE754_DOM.formatId } },
        IEEE754_FORMAT_OPTIONS.map(createFormatOption));

    const input = h('input', {
        class: IEEE754_INPUT_CLASS,
        attrs: {
            id: IEEE754_DOM.inputId,
            value: IEEE754_INPUT_INITIAL_VALUE,
            spellcheck: IEEE754_INPUT_SPELLCHECK,
        },
    });
    const convertButton = h('button', {
        class: IEEE754_BUTTON_CLASS,
        text: IEEE754_CONVERT_LABEL,
        attrs: { type: IEEE754_BUTTON_TYPE, id: IEEE754_DOM.convertId },
    });

    const error = h('div', {
        class: IEEE754_ERROR_CLASS,
        attrs: { id: IEEE754_DOM.errorId, hidden: 'hidden' },
    });

    const bits = h('div', { class: IEEE754_BITS_CLASS, attrs: { id: IEEE754_DOM.bitsId } });
    const bitstring = h('div', { class: IEEE754_BITSTRING_CLASS, attrs: { id: IEEE754_DOM.bitstringId } });
    const breakdown = h('div', { class: IEEE754_BREAKDOWN_CLASS, attrs: { id: IEEE754_DOM.breakdownId } });
    const formula = h('div', { class: IEEE754_FORMULA_CLASS, attrs: { id: IEEE754_DOM.formulaId } });
    const special = h('div', { class: IEEE754_SPECIAL_CLASS, attrs: { id: IEEE754_DOM.specialId } });

    // 精度 / 输入那一行:两列都按原标记的栅格类摆放
    const controlsRow = h('div', { class: IEEE754_CONTROLS_ROW_CLASS }, [
        h('div', { class: IEEE754_COL_AUTO_CLASS }, [
            h('label', {
                class: IEEE754_LABEL_CLASS,
                text: IEEE754_FORMAT_LABEL,
                attrs: { for: IEEE754_DOM.formatId },
            }),
            formatSelect,
        ]),
        h('div', { class: IEEE754_COL_HALF_CLASS }, [
            h('label', {
                class: IEEE754_LABEL_CLASS,
                text: IEEE754_INPUT_LABEL,
                attrs: { for: IEEE754_DOM.inputId },
            }),
            h('div', { class: IEEE754_INPUT_GROUP_CLASS }, [input, convertButton]),
        ]),
    ]);

    // 三个分区:位图(S/E/M + 位串)/ 公式(KaTeX)/ 特殊值参考
    const root = h('div', { class: IEEE754_CARD_CLASS }, [
        h('div', { class: IEEE754_CARD_HEADER_CLASS }, [h('h4', { text: IEEE754_PANEL_TITLE })]),
        h('div', { class: IEEE754_CARD_BODY_CLASS }, [
            h('p', { class: IEEE754_HINT_CLASS, text: IEEE754_HINT_TEXT }),
            controlsRow,
            error,
            h('div', { class: IEEE754_SECTION_CLASS }, [legend, bits, bitstring]),
            breakdown,
            h('div', { class: IEEE754_SECTION_CLASS }, [
                h('div', { class: IEEE754_FORMULA_TITLE_CLASS, text: IEEE754_FORMULA_TITLE }),
                formula,
            ]),
            h('div', { class: IEEE754_SECTION_CLASS }, [
                h('div', { class: IEEE754_FORMULA_TITLE_CLASS, text: IEEE754_SPECIAL_TITLE }),
                special,
            ]),
        ]),
    ]);

    return {
        root,
        formatSelect,
        input,
        convertButton,
        bits,
        bitstring,
        breakdown,
        formula,
        error,
        special,
        expBitsLabel: bitsLabels[IEEE754_EXP_BITS_ROLE],
        fracBitsLabel: bitsLabels[IEEE754_FRAC_BITS_ROLE],
    };
}
