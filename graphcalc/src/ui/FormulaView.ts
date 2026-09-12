/**
 * KaTeX 公式 DOM 工具.
 *
 * KaTeX 只负责把 LaTeX 字符串排版成 HTML;DSL 文本永远不要直接用
 * innerHTML 注入,统一走 `katex.render` 的转义输出.
 */
import katex from 'katex';
import 'katex/dist/katex.min.css';

/**
 * @cache
 * 缓存目的:同一 LaTeX 字符串在参数刷新时反复出现,KaTeX 排版结果不变,
 * 直接 clone 模板,避免每次重绘都调用 katex.render 重建整棵 DOM.
 * 键/失效策略:LaTeX 字符串 -> 无 class 的 span 模板;无失效机制,公式集合有限.
 * 生命周期:模块级,跟随页面存活.
 */
const formulaTemplateCache = new Map<string, HTMLElement>();

export function renderLatex(
    latex: string,
    element: HTMLElement,
    displayMode = false,
): void {
    katex.render(latex, element, {
        displayMode,
        throwOnError: false,
        trust: false,
    });
}

/**
 * LaTeX -> 公式 DOM.
 *
 * `copyable` 控制是否挂 `data-tex`(FormulaCopyController 的点击复制钩子):
 * - 实体对象公式,展开细节里的公式:可复制(缺省);
 * - 求值条目的**摘要行**公式:不可复制--摘要行本身是 `<details>` 的原生开合
 *   热区,点它是"展开/收起",不该顺手把 TeX 写进剪贴板(用户明确要求
 *   只有细节行才能点击复制).
 */
export function createFormulaElement(
    latex: string,
    className?: string,
    copyable = true,
): HTMLElement {
    const element = document.createElement('span');
    if (className) element.className = className;
    renderLatexInto(latex, element, copyable);
    return element;
}

/**
 * 把公式直接渲染进**已有元素**(元素自身就是公式根节点).
 *
 * 用在积分结果行:结果是 `<code class="eval-result is-ready">` 自己承载 KaTeX
 * 输出,而不是再套一层 span--过去那里会同时出现 `class="eval-result is-ready"`
 * 的外层和带 `katex` 类的内层,类名看着重复.
 *
 * 仍复用模块级模板缓存:命中就把模板子节点搬进来,否则渲染一次再缓存.
 */
export function renderLatexInto(
    latex: string,
    element: HTMLElement,
    copyable = true,
): void {
    let template = formulaTemplateCache.get(latex);
    if (!template) {
        template = document.createElement('span');
        renderLatex(latex, template);
        formulaTemplateCache.set(latex, template);
    }
    element.replaceChildren(...[...template.childNodes]);
    if (copyable) element.dataset.tex = latex;
}
