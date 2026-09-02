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

export function createFormulaElement(
    latex: string,
    className?: string,
): HTMLElement {
    let template = formulaTemplateCache.get(latex);
    if (!template) {
        template = document.createElement('span');
        renderLatex(latex, template);
        formulaTemplateCache.set(latex, template);
    }

    const element = template.cloneNode(true) as HTMLElement;
    if (className) element.className = className;
    return element;
}
