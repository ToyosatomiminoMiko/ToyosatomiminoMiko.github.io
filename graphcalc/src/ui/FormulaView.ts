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
 * 键/失效策略:LaTeX 字符串 -> 无 class 的 span 模板;先进先出,超过上限
 * 淘汰最早的一条--积分结果把数值拼进 LaTeX,键不是有限集合,必须有界.
 * 生命周期:模块级,跟随页面存活.
 */
const formulaTemplateCache = new Map<string, HTMLElement>();

/**
 * 模板缓存上限.
 *
 * 实体/分析/细节公式的键是有限集合,但积分结果行是 `∫f dx = 数值`,
 * 数值每帧都可能不同;不设上限就是只增不回收的泄漏.热点公式会被反复
 * 回写,所以容量取一个远大于单屏公式数的值即可.
 */
const FORMULA_TEMPLATE_CACHE_LIMIT = 512;

function cacheTemplate(latex: string, template: HTMLElement): void {
    if (formulaTemplateCache.size >= FORMULA_TEMPLATE_CACHE_LIMIT) {
        const oldest = formulaTemplateCache.keys().next().value;
        if (oldest !== undefined) formulaTemplateCache.delete(oldest);
    }
    formulaTemplateCache.set(latex, template);
}

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
 * 模板必须 **clone 而不是搬运**:`replaceChildren` 会把已经有父节点的子节点
 * 先从旧父节点摘除再插入,直接传 `template.childNodes` 会把缓存模板搬空,
 * 同一串 LaTeX 第二次渲染就是空白(实体/分析/积分公式全线命中).
 *
 * `copyable = false` 时必须**删掉** `data-tex`:元素可能带着上一次的可复制
 * 状态复用(如积分结果行从成功态转成错误态),残留属性会让点击复制到旧公式.
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
        cacheTemplate(latex, template);
    }
    const clone = template.cloneNode(true) as HTMLElement;
    element.replaceChildren(...clone.childNodes);
    if (copyable) element.dataset.tex = latex;
    else delete element.dataset.tex;
}
