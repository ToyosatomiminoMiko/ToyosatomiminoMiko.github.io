/**
 * IEEE 754 面板的标记契约(进程内,跑在 happy-dom 里).
 *
 * 面板整块由 `ui/ieee754_panel.ts` 生成,而 `public/css/ieee754.css` 通篇按这里的
 * 类名命中,所以这份测试相当于把"CSS 与标记的接口"钉住:类名少一个,层级挪一层,
 * 样式就静默失效.
 *
 * 图例里那两个位数提示是**生成期就需要引用**的元素(行为代码要按精度改写它们),
 * 所以顺便断言"组件交回的引用就是文档里那两个 <b>".精度那一列是库的折叠菜单
 * (`createMenu`),所以这里也把"锚点 / 触发按钮 / 面板 / 当前项"四件套钉住 --
 * 少一个锚点类,面板就会相对别的定位祖先飘走.
 *
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from 'vitest';

import {
    FLOAT64,
    IEEE754_BITSTRING_CLASS,
    IEEE754_BREAKDOWN_CLASS,
    IEEE754_CONTROLS_FORMAT_CLASS,
    IEEE754_CONTROLS_INPUT_CLASS,
    IEEE754_CONTROLS_ROW_CLASS,
    IEEE754_CONVERT_LABEL,
    IEEE754_DEFAULT_FORMAT_VALUE,
    IEEE754_DOM,
    IEEE754_ERROR_CLASS,
    IEEE754_EXP_BITS_ROLE,
    IEEE754_FORMAT_ANCHOR_CLASS,
    IEEE754_FORMAT_CHOICES,
    IEEE754_FORMAT_LABEL,
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
    IEEE754_SPECIAL_CLASS,
    IEEE754_SPECIAL_TITLE,
} from '@/ieee754/config';
import {
    createIeee754Panel,
    formatTriggerText,
    type Ieee754Panel,
} from '@/ieee754/ui/ieee754_panel';

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
    it('是 section.ui-panel,标题与提示段落文案来自 config', () => {
        const panel = render();
        expect(panel.root.tagName).toBe('SECTION');
        expect(panel.root.className).toBe('ui-panel');
        // 框体(标题栏 / 标题 / 正文容器)由库的 `createPanel` 建
        expect(panel.root.querySelector('.ui-panel-header .ui-panel-title')?.textContent)
            .toBe(IEEE754_PANEL_TITLE);
        const hint = panel.root.querySelector(`.ui-panel-body > p.${IEEE754_HINT_CLASS}`);
        expect(hint?.textContent).toBe(IEEE754_HINT_TEXT);
    });

    it('文档里没有重复 id', () => {
        render();
        const ids = [...document.querySelectorAll('[id]')].map((element) => element.id);
        expect(new Set(ids).size).toBe(ids.length);
    });
});

describe('IEEE754:精度与输入那一行', () => {
    it('精度 / 输入那一行的站点布局类与原来一致(.ieee-controls / 两列 / 两个标签)', () => {
        render();
        const row = mustQuery(`.ui-panel-body > .${IEEE754_CONTROLS_ROW_CLASS}`);
        expect(row.className).toBe(IEEE754_CONTROLS_ROW_CLASS);
        expect([...row.children].map((child) => child.className))
            .toEqual([IEEE754_CONTROLS_FORMAT_CLASS, IEEE754_CONTROLS_INPUT_CLASS]);
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

    it('精度菜单:触发按钮 + 库的浮层面板(<code> 主文案 + 小字),两项,f64 默认是当前项', () => {
        const panel = render();
        // 触发按钮:库的按钮(基线类 .ui-button),id 仍是 #ieee-format(label 指向它)
        const trigger = mustQuery(`button#${IEEE754_DOM.formatId}`);
        expect(trigger).toBe(panel.formatTrigger);
        expect(trigger.classList.contains('ui-button')).toBe(true);
        expect(trigger.textContent).toBe(formatTriggerText(IEEE754_DEFAULT_FORMAT_VALUE));
        expect(trigger.getAttribute('aria-expanded')).toBe('false');
        // 锚点:面板靠 `.menu-anchor`(库样式给 position: relative)挂在按钮下沿,
        // 两个子节点就是"按钮 + 面板",顺序即层叠关系
        const anchor = mustQuery(`.${IEEE754_FORMAT_ANCHOR_CLASS}`);
        expect([...anchor.children]).toEqual([trigger, panel.formatMenu.panel]);
        // 面板:库建的 role="menu",初始收着(is-open 由库的 Popover 写)
        const menuPanel = mustQuery('.menu-panel');
        expect(menuPanel).toBe(panel.formatMenu.panel);
        expect(menuPanel.getAttribute('role')).toBe('menu');
        expect(menuPanel.getAttribute('aria-label')).toBe(IEEE754_FORMAT_LABEL);
        expect(menuPanel.classList.contains('menu-popover')).toBe(true);
        expect(menuPanel.classList.contains('is-open')).toBe(false);
        expect(trigger.getAttribute('aria-controls')).toBe(menuPanel.id);
        // 菜单项:顺序 / 主文案 / 右侧小字都来自声明,当前项由 setActive 标成
        // .is-active + aria-current.主文案包在 `<code>` 里(类型名按代码字体排),
        // 小字是库的 `.menu-item-hint`,排在它后面 -- 所以 textContent 是两者拼起来.
        const items = [...menuPanel.querySelectorAll('.menu-item')];
        expect(items).toHaveLength(IEEE754_FORMAT_CHOICES.length);
        expect(items.map((item) => item.querySelector('code')?.textContent))
            .toEqual(IEEE754_FORMAT_CHOICES.map((choice) => choice.label));
        expect(items.map((item) => item.querySelector('.menu-item-hint')?.textContent))
            .toEqual(IEEE754_FORMAT_CHOICES.map((choice) => choice.hint));
        expect(items.map((item) => item.classList.contains('is-active')))
            .toEqual(IEEE754_FORMAT_CHOICES.map((choice) => choice.active));
        expect(items.map((item) => item.hasAttribute('aria-current')))
            .toEqual(IEEE754_FORMAT_CHOICES.map((choice) => choice.active));
    });

    it('十进制输入框改用站点样式类,转换按钮是库按钮:初值 / 类名 / type 都对得上', () => {
        const panel = render();
        expect(panel.input.getAttribute('value')).toBe(IEEE754_INPUT_INITIAL_VALUE);
        expect(panel.input.className).toBe(IEEE754_INPUT_CLASS);
        expect(panel.input.getAttribute('spellcheck')).toBe(IEEE754_INPUT_SPELLCHECK);
        expect(panel.input.parentElement?.className).toBe(IEEE754_INPUT_GROUP_CLASS);
        // 转换按钮归 UI 库(`miko_ui` 的 `createButton`):`.ui-button` 是库的基线类,
        // 站点旧表单类 `.btn` / `.form-control` 都不该出现在这里(负向断言),
        // type="button" 也由库给
        expect(panel.convertButton.classList.contains('ui-button')).toBe(true);
        expect(panel.convertButton.classList.contains('btn')).toBe(false);
        expect(panel.convertButton.getAttribute('type')).toBe('button');
        expect(panel.convertButton.textContent).toBe(IEEE754_CONVERT_LABEL);
        // 输入框与按钮同在一个 `.ieee-input-group` 里(样式依赖这个层级)
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
        // 位图容器与位串同在一个 .ieee-section 里(样式依赖这个层级)
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
