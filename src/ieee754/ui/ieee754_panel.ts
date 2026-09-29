/*
IEEE 754 面板的标记组件(声明式).

宿主只提供空窗格(骨架里的 `.tab-pane#ieee754`),本模块按 config.ts 的声明生成整块
标记,并把行为代码要用的**元素引用**一起交回 -- 行为代码不查 DOM,只认交回的引用:

    <section class="ui-panel">                       面板框体(库的 createPanel)
      <header class="ui-panel-header"><span class="ui-panel-title">IEEE 754 浮点可视化</span></header>
      <div class="ui-panel-body">
        <p class="ieee-hint">...</p>
        <div class="ieee-controls">
          <div class="ieee-controls__format">
            精度 label(for 指触发按钮)
            div.menu-anchor                      精度菜单的锚点(库的定位参照)
              button#ieee-format.ui-button       触发按钮:显示当前精度(<code>类型名</code>)
              div.menu-panel.menu-popover        菜单面板(role="menu",两项,当前项带 .is-active)
                button.menu-item                 主文案是 <code>float (32bit)</code>,行右弱色小字"单精度"
          </div>
          <div class="ieee-controls__input">十进制 label + div.ieee-input-group(input#ieee-input + button#ieee-convert)</div>
        </div>
        <div id="ieee-error" class="ieee-error" hidden></div>
        <div class="ieee-section">div.ieee-legend(位数提示是 <b data-role="...">) + #ieee-bits + #ieee-bitstring</div>
        <div id="ieee-breakdown" class="ieee-breakdown"></div>
        <div class="ieee-section">div.ieee-formula-title(公式 (KaTeX)) + #ieee-formula</div>
        <div class="ieee-section">div.ieee-formula-title(特殊值参考 (点击载入)) + #ieee-special</div>
      </div>
    </section>

这些 id / class 是 `public/css/ieee754.css` 的命中条件,不得合并或省略.三处部件归
UI 库(`miko_ui`):面板框体是 `createPanel`,转换按钮是 `createButton`,精度那一列是
`createMenu` 的折叠菜单(触发按钮 / 面板 / 分组 / 当前项 / 开合都归库,本站只给数据
与挂载锚点).本模块是纯函数:不读页面,不改全局,不绑事件(`addEventListener` /
初始渲染都是 ieee754.ts 的事).
*/

import { createButton, createMenu, createPanel, create_element, type Child, type MenuHandle } from 'miko_ui';

import {
    IEEE754_BITS_CLASS,
    IEEE754_BITSTRING_CLASS,
    IEEE754_BREAKDOWN_CLASS,
    IEEE754_CONTROLS_FORMAT_CLASS,
    IEEE754_CONTROLS_INPUT_CLASS,
    IEEE754_CONTROLS_ROW_CLASS,
    IEEE754_CONVERT_LABEL,
    IEEE754_DEFAULT_FORMAT_CHOICE,
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
    /** div.ui-panel(库的 `createPanel` 建的框体) */
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
 * 菜单件不把当前精度显示在触发按钮上,所以组件初始化与行为代码换精度时都得调这里,
 * 规则只此一份.取值不在声明里时原样显示 -- 声明与状态不同步时看得见,而不是显示空白.
 */
export function formatTriggerText(value: string): string {
    const choice = IEEE754_FORMAT_CHOICES.find((spec) => spec.value === value);
    return choice?.label ?? value;
}

/**
 * 把精度文案写进触发按钮,并按代码字体排:内容是 `<code>标签</code>`.
 *
 * 与菜单项同一套排法(类型名 float / double 是代码,不是正文),两处都由本文件管,
 * 所以行为代码换精度时也走这里,不必知道里面包了 `<code>`;`.textContent` 直接赋值的
 * 话会把那个 `<code>` 冲掉,提交后按钮就从等宽字体退回正文字体(不报错,只是看着不一样).
 */
export function setFormatTriggerText(trigger: HTMLButtonElement, value: string): void {
    trigger.replaceChildren(create_element({ tag: 'code' }, {}, formatTriggerText(value)));
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
 * 声明的角色取回,不需要 querySelector.角色是同一份模型里的字面量,声明里缺一项
 * 就等于模型自身不完整 -- 构造上即保证不缺,没有运行期缺失分支.
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
    const initialFormat = IEEE754_DEFAULT_FORMAT_CHOICE;
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
    /*
      分组标题(`.menu-group-title`)从面板里摘掉:这一个菜单只有一组,而它叫什么
      写在这一列的 `<label>`("精度")与触发按钮身上了 -- 组标题是同一句话的第三遍.
      库的 `createMenu` 总会建这个节点(它不知道调用方有几组),所以在建好之后移除;
      组的 `aria-label` 是另一个属性(库直接写在 `.menu-group` 上),读屏那边不受影响.
    */
    for (const title of formatMenu.panel.querySelectorAll('.menu-group-title')) {
        title.remove();
    }
    // 菜单项的主文案用 `<code>` 包一层:显示的既然是类型名(float / double),
    // 就按代码字体排(站点样式让 code 继承所在元素的颜色,见 index.css 的 code 规则).
    // 库的 `MenuEntry` 只收字符串,所以菜单建好后再把每项的**主文案文字节点**
    // 换成 `<code>`;行右的汉语小字是库追加的第二个子节点,原样不动.
    IEEE754_FORMAT_CHOICES.forEach((choice, index) => {
        const button = formatMenu.items[index].element;
        const label = button.firstChild;
        // 库一定先写主文案再追加小字,这里的判空只是满足类型(取不到就跳过)
        if (!label) return;
        button.replaceChild(create_element({ tag: 'code' }, {}, choice.label), label);
    });
    // 触发按钮里的文案同样是类型名,按菜单项的同一套排法包 `<code>`(见上面的函数)
    setFormatTriggerText(formatTrigger, initialFormat.value);

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

    // 精度 / 输入那一行:两列按 `.ieee-controls` 布局摆放 -- 左列随内容,右列半宽.
    // 精度那一列的 label 指向 #ieee-format,即菜单的触发按钮
    // (`<label for>` 认所有可标注元素,按钮是其中之一).
    const controlsRow = create_element({ tag: 'div' }, { class: IEEE754_CONTROLS_ROW_CLASS },
        create_element({ tag: 'div' }, { class: IEEE754_CONTROLS_FORMAT_CLASS },
            create_element({ tag: 'label' }, {
                class: IEEE754_LABEL_CLASS,
                for: IEEE754_DOM.formatId,
            }, IEEE754_FORMAT_LABEL),
            formatAnchor,
        ),
        create_element({ tag: 'div' }, { class: IEEE754_CONTROLS_INPUT_CLASS },
            create_element({ tag: 'label' }, {
                class: IEEE754_LABEL_CLASS,
                for: IEEE754_DOM.inputId,
            }, IEEE754_INPUT_LABEL),
            create_element({ tag: 'div' }, { class: IEEE754_INPUT_GROUP_CLASS }, input, convertButton),
        ),
    );

    // 面板框体(标题栏 / 正文容器)归库;正文顺序:提示 -> 精度/输入那一行 ->
    // 错误提示 -> 位图分区 -> 分解 -> 公式分区 -> 特殊值分区
    const root = createPanel({
        title: IEEE754_PANEL_TITLE,
        body: [
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
        ],
    }).element;

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
