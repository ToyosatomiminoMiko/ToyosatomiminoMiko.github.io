import type {
    AnalysisResult,
    IntegralTask,
    IntersectionOutput,
    IntersectionTask,
    SceneIR,
    SceneObject,
} from '../compiler/ir/types';
import {
    analysisLatexDetails,
    analysisLatexSummary,
    integralLatexDetails,
    integralLatexSummary,
    intersectionLatexDetails,
    intersectionLatexSummary,
    type EvaluationDetailLine,
} from '../compiler/dsl/evaluationLatex';
import { latexResultNumber } from '../math/latexNumber';
import { createFormulaElement, renderLatexInto } from './FormulaView';


const ENTITY_KIND_LABELS: Record<SceneObject['kind'], string> = {
    curve: '曲线',
    surface: '曲面',
    vector_field: '向量场',
    point: '点',
    vector: '向量',
    sphere: '球体',
    box: '方块',
    conic: '旋转体',
    region: '区域',
    implicit: '隐式场',
};

/** 分析条目的彩色类型标签文案(算子维度). */
const ANALYSIS_KIND_LABELS: Record<AnalysisResult['op'], string> = {
    gradient: '梯度',
    divergence: '散度',
    curl: '旋度',
};

const INTEGRAL_METHOD_LABELS: Record<IntegralTask['method'], string> = {    trapezoid: '梯形法',
    simpson: '辛普森法',
    'riemann:left': '黎曼和(左端点)',
    'riemann:right': '黎曼和(右端点)',
    'riemann:mid': '黎曼和(中点)',
    // 数值上它是"按值域分层数格子"的分层黎曼和,只收敛到(而不是等于)
    // 勒贝格积分;UI 里如实标注"层-测度近似",避免学生误以为这是
    // 测度论意义下的勒贝格积分.这是**命名语义**,不是待修复缺陷:
    // 符号引擎 202609 审查报告里没有对应条目,不要再往它上面挂编号.
    lebesgue: '层-测度近似',
};

/**
 * 求交结果摘要(纯文本,排在结果行里).
 *
 * 交点与交线可能**同时存在**(曲面/体积求交既有离散交点也有交线),所以两边
 * 都要报,不能一边非空就把另一边丢掉.
 *
 * 不再统计"交线共 N 个点":那是采样折线的顶点数,随 `segments` 变而变,
 * 不是数学量,写进结果只会误导.
 */
function intersectionSummary(
    task: IntersectionTask,
    output: IntersectionOutput,
): string {
    const source = `${task.aName} ∩ ${task.bName}`;
    const parts: string[] = [];
    if (output.points.length > 0) parts.push(`交点 ${output.points.length} 个`);
    if (output.curves.length > 0) parts.push(`交线 ${output.curves.length} 条`);
    return `${source} · ${parts.length > 0 ? parts.join(' · ') : '无交'}`;
}

function createElement(tag: string, className?: string, text?: string): HTMLElement {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
}

/**
 * 按目标顺序摆放列表行.
 *
 * 缓存命中时行**留在原地**,所以数组顺序变了(DSL 里新增/调序,或只有部分
 * 条目因为内容变化被重建)DOM 顺序不会自己跟上,替换过的行还会被 append
 * 到末尾造成跳位.这里只在顺序确实不一致时才按顺序 append 一遍(对已有
 * 子节点来说 append 是"搬移"),顺序一致时一次 DOM 都不动.
 */
function appendInOrder(
    container: HTMLElement,
    rows: readonly HTMLElement[],
): void {
    const current = container.children;
    let same = current.length === rows.length;
    if (same) {
        for (let index = 0; index < rows.length; index += 1) {
            if (current[index] !== rows[index]) {
                same = false;
                break;
            }
        }
    }
    if (same) return;
    for (const row of rows) container.append(row);
}

/**
 * 行被替换时把 `<details>` 的展开态带到新行上.
 *
 * 数值变化必然重建行(内容真的变了),但"用户把它展开了"这件事与内容无关,
 * 不该在拖动滑块时被每帧重置.
 */
function carryDetailsOpen(from: HTMLElement, to: HTMLElement): void {
    const before = from.querySelector<HTMLDetailsElement>('details');
    if (before === null) return;
    const after = to.querySelector<HTMLDetailsElement>('details');
    if (after !== null) after.open = before.open;
}

function formatNumber(value: number): string {
    if (!Number.isFinite(value)) return String(value);
    const magnitude = Math.abs(value);
    if ((magnitude >= 1e-4 && magnitude < 1e6) || value === 0) {
        return value
            .toFixed(6)
            .replace(/\.?0+$/, '');
    }
    return value.toExponential(6);
}

function formatVector(value: readonly number[]): string {
    return `[${value.map((item) => formatNumber(item)).join(', ')}]`;
}

function sceneObjectExpression(object: SceneObject): string {
    switch (object.kind) {
        case 'curve':
        case 'surface':
            return object.expr;
        case 'vector_field':
            return `[${object.components.join(', ')}]`;
        case 'point':
        case 'vector':
            return object.expr;
        case 'sphere':
            return `中心=${formatVector([object.position.x, object.position.y, object.position.z])} · r=${formatNumber(object.radius)}`;
        case 'box':
            return `中心=${formatVector([object.position.x, object.position.y, object.position.z])} · size=${formatVector(object.size)}`;
        case 'conic':
            return `中心=${formatVector([object.position.x, object.position.y, object.position.z])} · base=${formatNumber(object.baseRadius)} · top=${formatNumber(object.topRadius)} · h=${formatNumber(object.height)}`;
        case 'region':
            return `边界=${object.curveAName}, ${object.curveBName} · x∈[${formatNumber(object.range[0])}, ${formatNumber(object.range[1])}]`;
        case 'implicit':
            // V1 只有方程本体,没有自有网格;摘要直接给 `f = level`.
            return `${object.expr} = ${formatNumber(object.level)} · ${object.dim}D`;
    }
}

/** 旋转体的 UI 名称由实际上下底半径推出,而不是按 DSL 关键字固定. */
function sceneObjectKindLabel(object: SceneObject): string {
    if (object.kind !== 'conic') {
        return ENTITY_KIND_LABELS[object.kind];
    }
    // 上下底都为 0 是退化体,既不是圆柱也不是圆锥,回退到通用名.
    if (object.baseRadius < 1e-9 && object.topRadius < 1e-9) {
        return ENTITY_KIND_LABELS.conic;
    }
    if (Math.abs(object.topRadius - object.baseRadius) < 1e-9) {
        return '圆柱';
    }
    if (object.topRadius < 1e-9) {
        return '圆锥';
    }
    return '圆台';
}

/**
 * 实体条目 key:徽章文案 + 实际渲染出来的表达式/文本 + 显隐态.
 *
 * `objectFormulas` 给 null 时回退到 `sceneObjectExpression(object)` 的纯文本,
 * 两种形态要分别计入键,否则"公式 -> 文本"的回退不会被重绘.
 */
function entityKey(object: SceneObject, formula: string | null): string {
    return JSON.stringify([
        object.kind,
        object.id,
        object.name ?? null,
        object.enabled,
        sceneObjectKindLabel(object),
        formula,
        formula === null ? sceneObjectExpression(object) : null,
    ]);
}

/**
 * 积分条目 key:取**会被渲染的摘要/细节/元信息**.
 *
 * `integralLatexSummary` 为 null 时列表回退到 `integralSourceLabel` 纯文本,
 * 所以两者都进键;域对象名(`\iint_{D}` 与"域:"行)也由这里覆盖,不靠手工
 * 复制 task 字段.`show` 只影响三维叠加层,不进键.
 */
function integralTaskKey(task: IntegralTask, objects: SceneObject[]): string {
    return JSON.stringify([
        integralLatexSummary(task, objects),
        integralSourceLabel(task, objects),
        task.enabled,
        task.enabled
            ? integralLatexDetails(
                task,
                objects,
                INTEGRAL_METHOD_LABELS[task.method],
                null,
            )
            : null,
    ]);
}

/**
 * 求交条目 key:摘要/细节公式与启用态.
 *
 * `color` 只影响三维渲染,不影响列表内容,不进键--否则改个颜色就会把
 * 用户展开的细节收起来.
 */
function intersectionTaskKey(task: IntersectionTask): string {
    return JSON.stringify([
        intersectionLatexSummary(task),
        task.enabled,
        task.enabled ? intersectionLatexDetails(task) : null,
    ]);
}

/**
 * 分析条目 key:直接取**会被渲染的公式/文本**.
 *
 * 不再罗列 IR 字段:以前靠手工维护字段清单,漏掉过 `symbolic`(细节第一行)
 * 导致源表达式变了细节不刷新,又把只影响三维叠加层的 `show` 算了进来.
 * 键跟着渲染内容走,从根上避免"键漏字段".`enabled` 决定细节是否生成,
 * 必须进键.
 */
function analysisTaskKey(analysis: AnalysisResult): string {
    return JSON.stringify([
        analysisLatexSummary(analysis),
        analysis.enabled,
        analysis.enabled ? analysisLatexDetails(analysis) : null,
    ]);
}

function integralSourceLabel(
    task: IntegralTask,
    objects: SceneObject[],
): string {
    const source = objects.find((object) => object.id === task.objectId);
    const sourceLabel = source?.kind === 'curve'
        ? '曲线'
        : source?.kind === 'surface'
            ? '曲面'
            : source?.kind === 'region'
                ? '区域'
                : source?.kind === 'sphere' || source?.kind === 'box' || source?.kind === 'conic'
                    ? '体积'
                    : '对象';
    const sourceName = source ? source.name : `#${task.objectId}`;
    return `${sourceLabel} ${sourceName} · ${INTEGRAL_METHOD_LABELS[task.method]}`;
}

/**
 * 展开细节里的两组行:公式块与纯文本元信息块.
 *
 * `createEvaluationShell` 按 `summary -> 公式块(内含结果行) -> 元信息块` 的
 * 顺序插进 `<details>`:
 * - `formulas`(`.eval-detail-body`):KaTeX 公式行(带 `data-tex`,可点击复制)
 *   与**结果行** `.eval-result`,共用左侧高亮竖线与底色--它们都是数学内容;
 * - `metadata`(`.eval-detail-meta` 若干行):域/方法/分段/分层这类键值对,
 *   不套 `\text{}`,也不进公式块--它们是说明文字,不是数学内容.
 */
interface EvaluationDetailSections {
    formulas: HTMLElement | null;
    metadata: HTMLElement | null;
}

/**
 * 把细节行拆成"公式块 + 元信息块".
 *
 * 行类型由 `EvaluationDetailLine` 表达(见 dsl/evaluationLatex.ts):
 * - `kind: 'latex'` -> 公式行;
 * - `kind: 'text'` -> 纯文本元信息行.
 * 为什么要折叠:求值条目的完整信息(P,∇f 逐分量,球坐标回显,积分等式)远比
 * 一行宽,折叠态只留摘要行,列表才扫得动;默认收起由 `<details open=false>`
 * 实现,开合只认点摘要行.
 */
function createDetailSections(
    lines: readonly EvaluationDetailLine[],
): EvaluationDetailSections {
    let formulas: HTMLElement | null = null;
    let metadata: HTMLElement | null = null;

    for (const line of lines) {
        if (line.kind === 'latex') {
            if (formulas === null) {
                formulas = createElement('div', 'eval-detail-body');
            }
            formulas.append(createFormulaElement(line.latex, 'eval-detail-line'));
        } else {
            if (metadata === null) {
                metadata = createElement('div', 'eval-detail-meta-block');
            }
            metadata.append(createElement('div', 'eval-detail-meta', line.text));
        }
    }

    return { formulas, metadata };
}

/**
 * 积分条目的 DOM 缓存项.
 *
 * `bodyLatex` 是积分式本体(不含 `=`),数值回填后按它把结果行与展开细节里
 * 的等式一起刷新;`result` 是结果行,`createEvaluationShell` 一定会把它插进
 * DOM,所以不是可空类型.
 */
interface IntegralRow {
    row: HTMLElement;
    result: HTMLElement;
    bodyLatex: string | null;
}

/**
 * 求值条目的结构:
 * - `summary`(`<summary>`):折叠态可见 = 彩色标签 + 变量名 + 一行 KaTeX 公式.
 *   开合完全交给 `<details>` 的原生行为(点摘要行即开合),不额外放按钮;
 * - `details`(`<details>`):折叠容器,默认收起,展开后依次放:
 *   1. `detail.formulas`(`.eval-detail-body`):公式块,`result` 作为它的最后一个
 *      子元素一起放在里面--结果行与公式行同为数学内容,共用同一条高亮竖线;
 *   2. `detail.metadata`:纯文本元信息(域/方法/分段/分层),在公式块**之外**.
 *
 * 显隐按钮已整体移除:求值对象是否参与计算没有 UI 开关,`enabled` 只由
 * 编译侧(隐藏集合)决定.
 */
function createEvaluationShell(
    summary: HTMLElement,
    detail: EvaluationDetailSections | null,
    result: HTMLElement | null,
): HTMLElement {
    const row = createElement('article', 'object-row evaluation-row');
    row.setAttribute('role', 'listitem');
    const main = createElement('div', 'object-main');

    if (detail === null) {
        main.append(summary);
        if (result !== null) main.append(result);
        row.append(main);
        return row;
    }

    // 结果行进公式块内部(末尾);积分式排不出来时公式块为 null,此时为结果
    // 单独建一个块,保证结果行不会掉出折叠区.
    if (result !== null) {
        if (detail.formulas === null) {
            detail.formulas = createElement('div', 'eval-detail-body');
        }
        detail.formulas.append(result);
    }

    const details = document.createElement('details');
    details.className = 'eval-details';
    // 默认折叠:全部条目在首次渲染时都是收起状态.
    details.open = false;
    details.append(summary);
    if (detail.formulas !== null) details.append(detail.formulas);
    if (detail.metadata !== null) details.append(detail.metadata);
    main.append(details);
    row.append(main);
    return row;
}

/**
 * 摘要行(折叠态可见):彩色类型标签 + 变量名 + 一行 KaTeX 公式.
 *
 * 三项各司其职,不再放宽:
 * - `kind-badge`:彩色标签给出"这是哪一类求值对象"(梯度/散度/旋度/积分/求交),
 *   配色沿用左栏实体徽章的同一套视觉语言;
 * - `object-name`:DSL 里声明的变量名(如 `g`,`I`,`X`),同名多条时靠它区分;
 * - 公式:该条目的算子形式,`copyable = false`--摘要行是 `<details>` 的原生
 *   开合热区,点它只开合,不复制 TeX(复制只在展开细节行上生效).
 */
function createEvaluationSummary(
    badgeClass: string,
    badgeLabel: string,
    name: string,
    formula: HTMLElement,
): HTMLElement {
    const summary = document.createElement('summary');
    summary.className = 'eval-summary';
    summary.append(
        createElement('span', `kind-badge ${badgeClass}`, badgeLabel),
        createElement('strong', 'object-name', name),
        formula,
    );
    return summary;
}

/**
 * footer 对象列表控制器.
 *
 * 左栏展示场景实体对象,右栏展示分析与积分等求值结果.
 * 控制器只负责 DOM,真正的可见性与数值计算由 DslApp 回调驱动.
 *
 * 求值条目(分析/积分/求交)统一是"KaTeX 摘要公式 + 可折叠 KaTeX 细节 +
 * 结果行":开合交给 `<details>/<summary>` 原生行为(点摘要行即开合),
 * 细节展开才给中间步骤与逐分量数值.
 */
export class ObjectListController {
    /**
     * @cache
     * 缓存目的:复用实体列表 DOM 行--参数拖动时 renderScene 每帧重跑,
     * 整棵重建会在模板缓存里反复 clone,也会丢掉用户在列表里的文本选择.
     * 键/失效策略:对象 id -> { row, key };key 由徽章文案与实际展示的
     * 表达式/文本组成(见 entityKey),内容不变就复用.
     * 生命周期:跟随 ObjectListController 实例.
     */
    private readonly entityRows = new Map<
        number,
        { row: HTMLElement; key: string }
    >();

    /**
     * @cache
     * 缓存目的:复用分析列表 DOM 行--参数拖动时 renderScene 每帧重跑,
     * 重建会把用户展开的细节重新收起,KaTeX 也要重排.
     * 键/失效策略:分析名 -> { row, key };内容 key 变化时替换,展开态由
     * carryDetailsOpen 带到新行.
     * 生命周期:跟随 ObjectListController 实例.
     */
    private readonly analysisRows = new Map<
        string,
        { row: HTMLElement; key: string }
    >();

    /**
     * @cache
     * 缓存目的:复用积分列表 DOM 行,只更新结果文本,避免每次 sync 重建整棵树.
     * 键/失效策略:积分名 -> { row, result, key, bodyLatex };任务消失或渲染内容变化时替换.
     * 生命周期:跟随 ObjectListController 实例.
     */
    private readonly integralRows = new Map<string, IntegralRow & { key: string }>();

    /**
     * @cache
     * 缓存目的:复用求交列表 DOM 行,Worker 结果回来后只更新结果文本.
     * 键/失效策略:求交名 -> { row, result, key, task };任务消失或渲染内容变化时替换.
     * 生命周期:跟随 ObjectListController 实例.
     */
    private readonly intersectionRows = new Map<
        string,
        {
            row: HTMLElement;
            result: HTMLElement;
            key: string;
            task: IntersectionTask;
        }
    >();

    /**
     * @cache
     * 缓存目的:保存每个积分的最新数值.展开细节里的等式与结果行必须同源,
     * 而细节行是异步结果回来之前就建好的,只能靠这份缓存回填.
     * 键/失效策略:积分名 -> { 条目 key, 数值 }.只有 key 与当前条目一致时
     * 才回填:任务被改写(区间/被积函数变化)后 key 必变,旧数值自然作废,
     * 列表回到"计算中",不会先显示上一次的答案.任务消失与 clear() 时删除.
     * 生命周期:跟随 ObjectListController 实例.
     */
    private readonly integralResults = new Map<
        string,
        { key: string; value: number }
    >();

    constructor(
        private readonly entityList: HTMLElement,
        private readonly analysisList: HTMLElement,
        private readonly integralList: HTMLElement,
        private readonly intersectionList: HTMLElement,
    ) {
        // 四个容器在 DOM 里只是普通 <div>;显式给列表语义,读屏才会报
        // "列表/列表项",而不是把每条读成孤立的一段.
        for (const list of [
            entityList,
            analysisList,
            integralList,
            intersectionList,
        ]) {
            list.setAttribute('role', 'list');
        }
    }

    renderScene(scene: SceneIR): void {
        this._renderEntities(scene.objects, scene.objectFormulas);
        this._renderAnalyses(scene.analyses);
        this._renderIntegrals(scene.integrals, scene.objects);
        this._renderIntersections(scene.intersections);
    }

    /**
     * @cache_access
     * 命中积分 DOM 行缓存:结果行排成完整等式 `∫f dx = 数值`,并把展开细节里
     * 那条等式的右端一起刷新(两处必须同源,否则展开前后数值不一致).
     */
    setIntegralResult(name: string, value: number): void {
        const item = this.integralRows.get(name);
        if (!item) return;

        this.integralResults.set(name, { key: item.key, value });
        this._renderIntegralResult(item, value);
        item.row.classList.remove('has-error');
    }

    /**
     * @cache_access
     * 命中积分 DOM 行缓存并更新错误文本.
     */
    setIntegralError(name: string, message: string): void {
        const item = this.integralRows.get(name);
        if (!item) return;

        // 出错后不留旧数值:细节里的等式退回"没有结果"的形态.
        this.integralResults.delete(name);
        this._replaceIntegralEquation(item, null);
        item.result.replaceChildren(document.createTextNode(message));
        item.result.className = 'eval-result is-error';
        // 成功态结果行带 data-tex(点击复制);转错误态必须摘掉,否则点错误
        // 提示会把上一次的等式复制进剪贴板(FormulaCopyController 认 [data-tex]).
        delete item.result.dataset.tex;
        item.row.classList.add('has-error');
    }

    /**
     * @cache_access
     * 命中求交 DOM 行缓存并更新结果摘要.
     */
    setIntersectionResult(name: string, output: IntersectionOutput): void {
        const item = this.intersectionRows.get(name);
        if (!item) return;

        item.result.textContent = intersectionSummary(item.task, output);
        item.result.className = 'eval-result is-ready';
        item.row.classList.remove('has-error');
    }

    /**
     * @cache_access
     * 命中求交 DOM 行缓存并更新错误文本.
     */
    setIntersectionError(name: string, message: string): void {
        const item = this.intersectionRows.get(name);
        if (!item) return;

        item.result.textContent = message;
        item.result.className = 'eval-result is-error';
        item.row.classList.add('has-error');
    }

    /**
     * @cache_access
     * 清空四个列表及其全部 DOM 行缓存与数值缓存.
     */
    clear(): void {
        this.entityList.replaceChildren();
        this.analysisList.replaceChildren();
        this.integralList.replaceChildren();
        this.intersectionList.replaceChildren();
        this.entityRows.clear();
        this.analysisRows.clear();
        this.integralRows.clear();
        this.intersectionRows.clear();
        this.integralResults.clear();
    }

    dispose(): void {
        this.clear();
    }

    /** 取积分最新数值;条目 key 不一致(任务已被改写),未回填或已出错时为 null. */
    private _integralResult(name: string, key: string): number | null {
        const entry = this.integralResults.get(name);
        return entry !== undefined && entry.key === key ? entry.value : null;
    }

    /**
     * 刷新积分结果行:排成完整等式 `∫f dx = 数值`;积分式不可排版时只给数值.
     *
     * 结果行的 `<code>` 自身就是公式根节点(`class="eval-result is-ready"`),
     * 不再在它里面套一层同名类名的 span;KaTeX 生成的 `.katex` 直接挂在 `<code>`
     * 下,由 CSS `.eval-result .katex` 继承配色与字号.
     * 结果行与展开细节里的等式同时刷新,避免展开前后两个版本.
     */
    private _renderIntegralResult(item: IntegralRow, value: number): void {
        if (item.bodyLatex === null) {
            // 积分式排不出来时只给数值文本;纯文本没有可复制的 TeX,
            // 顺手清掉可能残留的 data-tex.
            item.result.replaceChildren(
                document.createTextNode(formatNumber(value)),
            );
            item.result.className = 'eval-result is-ready';
            delete item.result.dataset.tex;
        } else {
            renderLatexInto(
                `${item.bodyLatex}=${latexResultNumber(value)}`,
                item.result,
            );
            // 结果行的 <code> 自身承载状态与公式;类名只挂一次,内部只有
            // KaTeX 生成的 .katex,不再出现同名类名的嵌套 span.
            item.result.className = 'eval-result is-ready';
        }
        this._replaceIntegralEquation(item, value);
    }

    /**
     * 把展开细节里的积分等式换成 `∫f dx = 数值`;`value = null` 时退回不带
     * 右端的积分式(出错/尚未算出).
     *
     * 公式块(`.eval-detail-body`)只放公式行;积分式排不出来时该块不存在,
     * 这时结果行仍然只由 `<code class="eval-result">` 承担,不去动元信息块.
     */
    private _replaceIntegralEquation(item: IntegralRow, value: number | null): void {
        if (item.bodyLatex === null) return;
        const container = item.row.querySelector<HTMLElement>('.eval-detail-body');
        if (!container) return;

        const latex = value === null
            ? item.bodyLatex
            : `${item.bodyLatex}=${latexResultNumber(value)}`;
        const equation = createFormulaElement(latex, 'eval-detail-line');
        const existing = container.querySelector<HTMLElement>('.eval-detail-line');
        if (existing) {
            existing.replaceWith(equation);
        } else {
            container.prepend(equation);
        }
    }

    /**
     * @cache_access
     * 根据实体 key 复用或替换实体 DOM 行,并按场景数组顺序摆放.
     */
    private _renderEntities(
        objects: SceneObject[],
        objectFormulas: Record<number, string | null>,
    ): void {
        const nextIds = new Set(objects.map((object) => object.id));

        for (const [id, item] of this.entityRows) {
            if (!nextIds.has(id)) {
                item.row.remove();
                this.entityRows.delete(id);
            }
        }

        const ordered: HTMLElement[] = [];
        for (const object of objects) {
            const formula = objectFormulas[object.id] ?? null;
            const key = entityKey(object, formula);
            const existing = this.entityRows.get(object.id);
            if (existing && existing.key === key) {
                ordered.push(existing.row);
                continue;
            }

            if (existing) {
                existing.row.remove();
                this.entityRows.delete(object.id);
            }

            const row = this._createEntityRow(object, formula);
            this.entityRows.set(object.id, { row, key });
            ordered.push(row);
        }

        appendInOrder(this.entityList, ordered);
    }

    private _createEntityRow(
        object: SceneObject,
        formula: string | null,
    ): HTMLElement {
        const row = createElement('article', 'object-row entity-row');
        row.setAttribute('role', 'listitem');
        row.classList.toggle('is-hidden', !object.enabled);

        const badge = createElement(
            'span',
            `kind-badge kind-${object.kind}`,
            sceneObjectKindLabel(object),
        );

        const main = createElement('div', 'object-main');
        const name = createElement('strong', 'object-name', object.name ?? `#${object.id}`);
        const expression = formula
            ? createFormulaElement(formula, 'object-expr')
            : createElement(
                'code',
                'object-expr',
                sceneObjectExpression(object),
            );
        main.append(name, expression);
        // 隐藏原来只靠 is-hidden 的透明度:再补一条文字状态,色觉/低对比度
        // 用户也能看出这个对象被排除了.
        if (!object.enabled) {
            main.append(createElement('span', 'row-state', '已隐藏'));
        }

        row.append(badge, main);
        return row;
    }

    /**
     * @cache_access
     * 根据分析结果 key 复用或替换分析 DOM 行缓存,并保持场景数组顺序.
     */
    private _renderAnalyses(analyses: AnalysisResult[]): void {
        const nextNames = new Set(analyses.map((analysis) => analysis.name));

        for (const [name, item] of this.analysisRows) {
            if (!nextNames.has(name)) {
                item.row.remove();
                this.analysisRows.delete(name);
            }
        }

        const ordered: HTMLElement[] = [];
        for (const analysis of analyses) {
            const key = analysisTaskKey(analysis);
            const existing = this.analysisRows.get(analysis.name);
            if (existing && existing.key === key) {
                ordered.push(existing.row);
                continue;
            }

            if (existing) {
                existing.row.remove();
                this.analysisRows.delete(analysis.name);
            }

            const row = this._createAnalysisRow(analysis);
            if (existing) carryDetailsOpen(existing.row, row);
            this.analysisRows.set(analysis.name, { row, key });
            ordered.push(row);
        }

        appendInOrder(this.analysisList, ordered);
    }

    private _createAnalysisRow(analysis: AnalysisResult): HTMLElement {
        // 折叠态:彩色算子标签 + 变量名 + 一行 KaTeX 公式(摘要公式不可复制).
        const summaryLine = createFormulaElement(
            analysisLatexSummary(analysis),
            'eval-summary-formula',
            false,
        );
        const summary = createEvaluationSummary(
            `kind-analysis kind-analysis-${analysis.op}`,
            ANALYSIS_KIND_LABELS[analysis.op],
            analysis.name,
            summaryLine,
        );

        // 展开细节里先给算子的符号展开,再给该点的数值结果.
        const details = analysis.enabled
            ? createDetailSections(analysisLatexDetails(analysis))
            : null;

        const row = createEvaluationShell(summary, details, null);
        row.classList.toggle('is-hidden', !analysis.enabled);
        return row;
    }

    /**
     * @cache_access
     * 根据任务 key 复用或替换积分 DOM 行缓存,并保持场景数组顺序.
     */
    private _renderIntegrals(
        tasks: IntegralTask[],
        objects: SceneObject[],
    ): void {
        const nextNames = new Set(tasks.map((task) => task.name));

        for (const [name, item] of this.integralRows) {
            if (!nextNames.has(name)) {
                item.row.remove();
                this.integralRows.delete(name);
                this.integralResults.delete(name);
            }
        }

        const ordered: HTMLElement[] = [];
        for (const task of tasks) {
            const key = integralTaskKey(task, objects);
            const existing = this.integralRows.get(task.name);
            if (existing && existing.key === key) {
                ordered.push(existing.row);
                continue;
            }

            if (existing) {
                existing.row.remove();
                this.integralRows.delete(task.name);
            }

            const created = this._createIntegralRow(task, objects, key);
            if (existing) carryDetailsOpen(existing.row, created.row);
            this.integralRows.set(task.name, { ...created, key });
            ordered.push(created.row);
        }

        appendInOrder(this.integralList, ordered);
    }

    private _createIntegralRow(
        task: IntegralTask,
        objects: SceneObject[],
        key: string,
    ): IntegralRow {
        // 摘要公式 = 积分式本体(不接 `=`):与梯度条目同一条约定--折叠态只给
        // 算子的书写形式,数值由 setIntegralResult 排版成完整等式.展不开公式
        // (null,例如被积对象已删除)时退回纯文本,不编造公式.
        const bodyLatex = integralLatexSummary(task, objects);
        const summaryLine: HTMLElement = bodyLatex === null
            ? createElement('code', 'object-expr', integralSourceLabel(task, objects))
            : createFormulaElement(bodyLatex, 'eval-summary-formula', false);
        const summary = createEvaluationSummary(
            'kind-integral',
            '积分',
            task.name,
            summaryLine,
        );

        // 只认与当前条目 key 一致的数值:任务被改写(区间/被积函数变化)后旧答案
        // 必须作废,否则会先显示上一次的结果;禁用条目一律按"不参与计算"呈现.
        const cachedResult = task.enabled
            ? this._integralResult(task.name, key)
            : null;
        // 展开细节第一行就是完整等式 `∫f dx = 数值`;数值尚未回填时省略右端.
        const details = task.enabled
            ? createDetailSections(integralLatexDetails(
                task,
                objects,
                INTEGRAL_METHOD_LABELS[task.method],
                cachedResult,
            ))
            : null;
        const result = cachedResult === null
            ? createElement(
                'code',
                task.enabled ? 'eval-result is-pending' : 'eval-result is-disabled',
                task.enabled ? '计算中...' : '已隐藏,不参与计算',
            )
            : createElement('code', 'eval-result is-ready', '');
        const row = createEvaluationShell(summary, details, result);
        row.classList.toggle('is-hidden', !task.enabled);
        const created: IntegralRow = { row, result, bodyLatex };
        // 已有数值时把结果行与细节等式一起排好(缓存跨了行重建).
        if (cachedResult !== null) {
            this._renderIntegralResult(created, cachedResult);
        }
        return created;
    }

    /**
     * @cache_access
     * 根据任务 key 复用或替换求交 DOM 行缓存,并保持场景数组顺序.
     */
    private _renderIntersections(tasks: IntersectionTask[]): void {
        const nextNames = new Set(tasks.map((task) => task.name));

        for (const [name, item] of this.intersectionRows) {
            if (!nextNames.has(name)) {
                item.row.remove();
                this.intersectionRows.delete(name);
            }
        }

        const ordered: HTMLElement[] = [];
        for (const task of tasks) {
            const key = intersectionTaskKey(task);
            const existing = this.intersectionRows.get(task.name);
            if (existing && existing.key === key) {
                ordered.push(existing.row);
                continue;
            }

            if (existing) {
                existing.row.remove();
                this.intersectionRows.delete(task.name);
            }

            const created = this._createIntersectionRow(task);
            if (existing) carryDetailsOpen(existing.row, created.row);
            this.intersectionRows.set(task.name, {
                row: created.row,
                result: created.result,
                key,
                task,
            });
            ordered.push(created.row);
        }

        appendInOrder(this.intersectionList, ordered);
    }

    private _createIntersectionRow(
        task: IntersectionTask,
    ): { row: HTMLElement; result: HTMLElement } {
        const summaryLine = createFormulaElement(
            intersectionLatexSummary(task),
            'eval-summary-formula',
            false,
        );
        const summary = createEvaluationSummary(
            'kind-intersection',
            '求交',
            task.name,
            summaryLine,
        );

        // 求交是异步任务:交点/交线数量由 Worker 回填到结果行,展开细节给
        // 两个源对象与采样分段.
        const detail = task.enabled
            ? createDetailSections(intersectionLatexDetails(task))
            : null;
        const result = createElement(
            'code',
            task.enabled ? 'eval-result is-pending' : 'eval-result is-disabled',
            task.enabled ? '计算中...' : '已隐藏,不参与计算',
        );
        const row = createEvaluationShell(summary, detail, result);
        row.classList.toggle('is-hidden', !task.enabled);
        return { row, result };
    }
}
