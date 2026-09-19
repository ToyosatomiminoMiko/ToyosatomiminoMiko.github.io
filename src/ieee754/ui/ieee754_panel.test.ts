/**
 * IEEE 754 面板的标记契约(进程内,跑在 happy-dom 里).
 *
 * 面板原先写在 index.html 的 `#ieee754` 窗格里,是首页最大的一块静态标记
 * (栅格 / 下拉框 / 图例 / 三个分区);现在由 `ui/ieee754_panel.ts` 生成.
 * `public/css/ieee754.css` 通篇按这里的类名命中,所以这一份测试相当于把
 * "CSS 与标记的接口"钉住:类名少一个,层级挪一层,样式就静默失效.
 *
 * 图例里那两个位数提示是**生成期就需要引用**的元素(行为代码要按精度改写它们),
 * 所以顺便断言"组件交回的引用就是文档里那两个 <b>".
 *
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from 'vitest';

import { FLOAT64 } from '@/ieee754/config';
import {
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
} from '@/ieee754/config';
import { createIeee754Panel, type Ieee754Panel } from '@/ieee754/ui/ieee754_panel';

/** 生成面板并挂到文档里(引用一致性要在文档里查) */
function render(): Ieee754Panel {
    document.body.innerHTML = '';
    const panel = createIeee754Panel();
    document.body.append(panel.root);
    return panel;
}

/** 按 CSS 选择器取元素,并断言它存在(选择器字符串直接写在用例里,与样式表一一对应) */
function mustQuery(selector: string): Element {
    const element = document.querySelector(selector);
    expect(element, selector).not.toBeNull();
    return element as Element;
}

describe('IEEE754:面板外壳与提示', () => {
    it('是 div.card,标题与提示段落文案来自 config', () => {
        const panel = render();
        expect(panel.root.className).toBe(IEEE754_CARD_CLASS);
        expect(panel.root.querySelector(`.${IEEE754_CARD_HEADER_CLASS} h4`)?.textContent)
            .toBe(IEEE754_PANEL_TITLE);
        const hint = panel.root.querySelector(`.${IEEE754_CARD_BODY_CLASS} > p.${IEEE754_HINT_CLASS}`);
        expect(hint?.textContent).toBe(IEEE754_HINT_TEXT);
    });

    it('文档里没有重复 id', () => {
        render();
        const ids = [...document.querySelectorAll('[id]')].map((element) => element.id);
        expect(new Set(ids).size).toBe(ids.length);
    });
});

describe('IEEE754:精度与输入那一行', () => {
    it('bootstrap 栅格类与原来一致(.row / .col-auto / .col-6 / .form-label)', () => {
        render();
        const row = mustQuery(`.${IEEE754_CARD_BODY_CLASS} > .row`);
        expect(row.className).toBe(IEEE754_CONTROLS_ROW_CLASS);
        expect([...row.children].map((child) => child.className))
            .toEqual([IEEE754_COL_AUTO_CLASS, IEEE754_COL_HALF_CLASS]);
        expect(row.querySelectorAll(`label.${IEEE754_LABEL_CLASS.split(' ')[0]}`)).toHaveLength(2);
    });

    it('两个 label 的 for 指向对应的控件', () => {
        render();
        const formatLabel = mustQuery(`label[for="${IEEE754_DOM.formatId}"]`);
        const inputLabel = mustQuery(`label[for="${IEEE754_DOM.inputId}"]`);
        expect(formatLabel.textContent).toBe(IEEE754_FORMAT_LABEL);
        expect(inputLabel.textContent).toBe(IEEE754_INPUT_LABEL);
        expect(document.getElementById(IEEE754_DOM.formatId)).not.toBeNull();
        expect(document.getElementById(IEEE754_DOM.inputId)).not.toBeNull();
    });

    it('精度下拉框:两项,f64 默认选中(属性与属性值都要在)', () => {
        const panel = render();
        const select = mustQuery(`select#${IEEE754_DOM.formatId}`);
        expect(select.className).toBe(IEEE754_SELECT_CLASS);
        expect(select).toBe(panel.formatSelect);
        const options = [...select.querySelectorAll('option')];
        expect(options.map((option) => option.getAttribute('value')))
            .toEqual(IEEE754_FORMAT_OPTIONS.map((option) => option.value));
        expect(options.map((option) => option.textContent))
            .toEqual(IEEE754_FORMAT_OPTIONS.map((option) => option.label));
        expect(options.map((option) => option.hasAttribute('selected')))
            .toEqual(IEEE754_FORMAT_OPTIONS.map((option) => option.selected));
        expect(panel.formatSelect.value).toBe(FLOAT64 === undefined ? '' : 'f64');
    });

    it('十进制输入框与转换按钮:初值 / 类名 / type 都与原来一致', () => {
        const panel = render();
        expect(panel.input.getAttribute('value')).toBe(IEEE754_INPUT_INITIAL_VALUE);
        expect(panel.input.className).toBe(IEEE754_INPUT_CLASS);
        expect(panel.input.getAttribute('spellcheck')).toBe(IEEE754_INPUT_SPELLCHECK);
        expect(panel.input.parentElement?.className).toBe(IEEE754_INPUT_GROUP_CLASS);
        expect(panel.convertButton.className).toBe(IEEE754_BUTTON_CLASS);
        expect(panel.convertButton.getAttribute('type')).toBe(IEEE754_BUTTON_TYPE);
        expect(panel.convertButton.textContent).toBe(IEEE754_CONVERT_LABEL);
        // 按钮与输入框在同一个 input-group 里(原标记如此)
        expect(panel.input.parentElement?.querySelector('button')).toBe(panel.convertButton);
    });

    it('错误提示初始隐藏', () => {
        const panel = render();
        const error = mustQuery(`.${IEEE754_ERROR_CLASS}#${IEEE754_DOM.errorId}`);
        expect(error).toBe(panel.error);
        expect(panel.error.hidden).toBe(true);
    });
});

describe('IEEE754:图例与三个分区', () => {
    it('图例三项的类名与文案逐字一致(ieee754.css 按 .ieee-s/-e/-m 上色)', () => {
        const panel = render();
        const legend = panel.root.querySelector(`.${IEEE754_LEGEND_CLASS}`);
        const items = [...(legend?.children ?? [])];
        expect(items.map((item) => item.className))
            .toEqual(IEEE754_LEGENDS.map((spec) => spec.className));
        expect(items.map((item) => item.textContent))
            .toEqual(IEEE754_LEGENDS.map((spec) => spec.parts
                .map((part) => ('text' in part ? part.text : String(part.bits))).join('')));
    });

    it('两个位数提示是 <b data-role=...>,组件交回的引用就是它们', () => {
        const panel = render();
        const exp = panel.root.querySelector(`b[data-role="${IEEE754_EXP_BITS_ROLE}"]`);
        const frac = panel.root.querySelector(`b[data-role="${IEEE754_FRAC_BITS_ROLE}"]`);
        expect(exp).toBe(panel.expBitsLabel);
        expect(frac).toBe(panel.fracBitsLabel);
        expect(panel.expBitsLabel.textContent).toBe(String(FLOAT64.exponentBits));
        expect(panel.fracBitsLabel.textContent).toBe(String(FLOAT64.fractionBits));
    });

    it('位图 / 位串 / 分解 / 公式 / 特殊值五个容器都在,类名即 CSS 契约', () => {
        const panel = render();
        expect(mustQuery(`.${IEEE754_BITSTRING_CLASS}#${IEEE754_DOM.bitstringId}`)).toBe(panel.bitstring);
        expect(mustQuery(`.${IEEE754_BREAKDOWN_CLASS}#${IEEE754_DOM.breakdownId}`)).toBe(panel.breakdown);
        expect(mustQuery(`.${IEEE754_FORMULA_CLASS}#${IEEE754_DOM.formulaId}`)).toBe(panel.formula);
        expect(mustQuery(`.${IEEE754_SPECIAL_CLASS}#${IEEE754_DOM.specialId}`)).toBe(panel.special);
        expect(mustQuery(`#${IEEE754_DOM.bitsId}`)).toBe(panel.bits);
        // 位图容器与位串同在一个 .ieee-section 里(原标记如此)
        expect(panel.bits.parentElement?.className).toBe(IEEE754_SECTION_CLASS);
        expect(panel.bits.parentElement).toBe(panel.bitstring.parentElement);
    });

    it('三个 .ieee-section,两个小标题,顺序与原标记一致', () => {
        const panel = render();
        const sections = [...panel.root.querySelectorAll(`.${IEEE754_SECTION_CLASS}`)];
        expect(sections).toHaveLength(3);
        expect(sections.map((section) => section.querySelector(`.${IEEE754_FORMULA_TITLE_CLASS}`)?.textContent))
            .toEqual([undefined, IEEE754_FORMULA_TITLE, IEEE754_SPECIAL_TITLE]);
        // 位图区在最前,公式与特殊值各占一个分区
        expect(sections[0].contains(panel.bits)).toBe(true);
        expect(sections[1].contains(panel.formula)).toBe(true);
        expect(sections[2].contains(panel.special)).toBe(true);
    });
});
