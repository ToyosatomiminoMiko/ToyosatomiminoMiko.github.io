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
          <div class="col-auto">
            精度 label(for 指触发按钮)
            div.menu-anchor                      精度菜单的锚点(库的定位参照)
              button#ieee-format.ui-button       触发按钮:显示当前精度
              div.menu-panel.menu-popover        菜单面板(role="menu",两项,当前项带 .is-active)
                button.menu-item                 主文案是 <code>float (32bit)</code>,行右弱色小字"单精度"
          </div>
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

**两处归 UI 库(`miko_ui`)**:转换按钮是 `createButton`(基线类 `.ui-button`),
精度那一列则由 `createMenu` 生成的**折叠菜单**替换了原来的 `<select>`
(触发按钮同样是库的按钮,菜单面板 / 分组 / 当前项 / 开合都归库,本站只给数据
与一个挂载锚点);站点不再给两者写外观,也没有 bootstrap 的 `.form-select` 了.
*/

import { createButton, createMenu, create_element, type Child, type MenuHandle } from 'miko_ui';

import {
    IEEE754_BITS_CLASS,
    IEEE754_BITSTRING_CLASS,
    IEEE754_BREAKDOWN_CLASS,
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
    type IEEE754LegendPart,
} from '@/ieee754/config';

/** 面板的全部结构,以及行为代码要用的元素引用 */
export interface Ieee754Panel {
    /** div.card */
    readonly root: HTMLElement;
    /** 精度菜单的句柄:开合 / 选中回调 / 当前项都在它上面 */
    readonly formatMenu: MenuHandle<string>;
    /** #ieee-format:显示当前精度的触发按钮(引用它来改文案) */
    readonly formatTrigger: HTMLButtonElement;
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

/**
 * 触发按钮上的文案:当前精度的标签(与菜单项文案同一份).
 *
 * 当前精度显示在按钮上(原来的 `<select>` 自带这个能力,菜单没有),所以行为代码
 * 换精度时要按同一条规则改写按钮文案 -- 规则只写在这里,组件与行为共用一份.
 * 取值不在声明里时原样显示(声明与状态不同步时看得见,而不是静默显示空白).
 */
export function formatTriggerText(value: string): string {
    const choice = IEEE754_FORMAT_CHOICES.find((spec) => spec.value === value);
    return choice?.label ?? value;
}

/** 图例里的一段:纯文本直接返回;位数提示生成 <b> 并把它登记进 sink(供调用方交回引用) */
function createLegendPart(part: IEEE754LegendPart, sink: Record<string, HTMLElement>): Child {
    if (!('bitsRole' in part)) {
        return part.text;
    }
    const label = create_element({ tag: 'b' }, { 'data-role': part.bitsRole }, String(part.bits));
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
    const legend = create_element(
        { tag: 'div' },
        { class: IEEE754_LEGEND_CLASS },
        ...IEEE754_LEGENDS.map((spec) => create_element(
            { tag: 'span' },
            { class: spec.className },
            ...spec.parts.map((part) => createLegendPart(part, bitsLabels)),
        )),
    );

    // 精度菜单:触发按钮 + 浮层面板都归库的 `createMenu`,本站给的是数据(分组 /
    // 菜单项 / 当前项)与一个锚点.按钮文案由 `formatTriggerText` 从当前项算出来;
    // 面板自身由库建(`.menu-panel.menu-popover`,role="menu"),插在锚点里等它定位.
    // 菜单项的小字(`hint`)是汉语名词,由库排在行右端(弱的 `.menu-item-hint`).
    const initialFormat = IEEE754_FORMAT_CHOICES.find((choice) => choice.active)
        ?? IEEE754_FORMAT_CHOICES[0];
    const formatTrigger = createButton({ text: formatTriggerText(initialFormat.value) }).element;
    formatTrigger.id = IEEE754_DOM.formatId;
    const formatMenu = createMenu<string>({
        groups: [{
            title: IEEE754_FORMAT_LABEL,
            entries: IEEE754_FORMAT_CHOICES.map((choice) => ({
                value: choice.value,
                text: choice.label,
                hint: choice.hint,
            })),
        }],
        ariaLabel: IEEE754_FORMAT_LABEL,
        trigger: formatTrigger,
    });
    // 菜单项的主文案用 `<code>` 包一层:显示的既然是类型名(float / double),
    // 就按代码字体排(站点样式把 bootstrap 给 code 的粉色改成继承,见 index.css).
    // 库的 `MenuEntry` 只收字符串,所以菜单建好后再把每项的**主文案文字节点**
    // 换成 `<code>`;行右的汉语小字是库追加的第二个子节点,原样不动.
    IEEE754_FORMAT_CHOICES.forEach((choice, index) => {
        const button = formatMenu.items[index].element;
        const label = button.firstChild;
        // 库一定先写主文案再追加小字,这里的判空只是满足类型(取不到就跳过)
        if (!label) return;
        button.replaceChild(create_element({ tag: 'code' }, {}, choice.label), label);
    });

    // 初始当前项:菜单只认"哪一项高亮",不自己记当前值(状态在行为代码那边).
    formatMenu.setActive(initialFormat.value);
    const formatAnchor = create_element({ tag: 'div' }, { class: IEEE754_FORMAT_ANCHOR_CLASS },
        formatTrigger,
        formatMenu.panel,
    );

    const input = create_element({ tag: 'input' }, {
        class: IEEE754_INPUT_CLASS,
        id: IEEE754_DOM.inputId,
        value: IEEE754_INPUT_INITIAL_VALUE,
        spellcheck: IEEE754_INPUT_SPELLCHECK,
    });
    // 转换按钮整颗由 UI 库(`miko_ui` 的 `createButton`)生成:基线类 `.ui-button`
    // 与 type="button" 都在库里,本站只补一个 id(CSS 与测试的定位契约).
    const convertButton = createButton({ text: IEEE754_CONVERT_LABEL }).element;
    convertButton.id = IEEE754_DOM.convertId;

    const error = create_element({ tag: 'div' }, {
        class: IEEE754_ERROR_CLASS,
        id: IEEE754_DOM.errorId,
        hidden: 'hidden',
    });

    const bits = create_element({ tag: 'div' }, { class: IEEE754_BITS_CLASS, id: IEEE754_DOM.bitsId });
    const bitstring = create_element(
        { tag: 'div' },
        { class: IEEE754_BITSTRING_CLASS, id: IEEE754_DOM.bitstringId },
    );
    const breakdown = create_element(
        { tag: 'div' },
        { class: IEEE754_BREAKDOWN_CLASS, id: IEEE754_DOM.breakdownId },
    );
    const formula = create_element(
        { tag: 'div' },
        { class: IEEE754_FORMULA_CLASS, id: IEEE754_DOM.formulaId },
    );
    const special = create_element(
        { tag: 'div' },
        { class: IEEE754_SPECIAL_CLASS, id: IEEE754_DOM.specialId },
    );

    // 精度 / 输入那一行:两列都按原标记的栅格类摆放.
    // 精度那一列的 label 仍指向 #ieee-format,只是它现在是菜单的触发按钮
    // (`<label for>` 认所有可标注元素,按钮是其中之一).
    const controlsRow = create_element({ tag: 'div' }, { class: IEEE754_CONTROLS_ROW_CLASS },
        create_element({ tag: 'div' }, { class: IEEE754_COL_AUTO_CLASS },
            create_element({ tag: 'label' }, {
                class: IEEE754_LABEL_CLASS,
                for: IEEE754_DOM.formatId,
            }, IEEE754_FORMAT_LABEL),
            formatAnchor,
        ),
        create_element({ tag: 'div' }, { class: IEEE754_COL_HALF_CLASS },
            create_element({ tag: 'label' }, {
                class: IEEE754_LABEL_CLASS,
                for: IEEE754_DOM.inputId,
            }, IEEE754_INPUT_LABEL),
            create_element({ tag: 'div' }, { class: IEEE754_INPUT_GROUP_CLASS }, input, convertButton),
        ),
    );

    // 三个分区:位图(S/E/M + 位串)/ 公式(KaTeX)/ 特殊值参考
    const root = create_element({ tag: 'div' }, { class: IEEE754_CARD_CLASS },
        create_element({ tag: 'div' }, { class: IEEE754_CARD_HEADER_CLASS },
            create_element({ tag: 'h4' }, {}, IEEE754_PANEL_TITLE)),
        create_element({ tag: 'div' }, { class: IEEE754_CARD_BODY_CLASS },
            create_element({ tag: 'p' }, { class: IEEE754_HINT_CLASS }, IEEE754_HINT_TEXT),
            controlsRow,
            error,
            create_element({ tag: 'div' }, { class: IEEE754_SECTION_CLASS }, legend, bits, bitstring),
            breakdown,
            create_element({ tag: 'div' }, { class: IEEE754_SECTION_CLASS },
                create_element({ tag: 'div' }, { class: IEEE754_FORMULA_TITLE_CLASS }, IEEE754_FORMULA_TITLE),
                formula,
            ),
            create_element({ tag: 'div' }, { class: IEEE754_SECTION_CLASS },
                create_element({ tag: 'div' }, { class: IEEE754_FORMULA_TITLE_CLASS }, IEEE754_SPECIAL_TITLE),
                special,
            ),
        ),
    );

    return {
        root,
        formatMenu,
        formatTrigger,
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
