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
} from '../compiler/dsl/evaluationLatex';
import { createFormulaElement } from './FormulaView';

type ToggleEntityHandler = (id: number) => void;
type ToggleEvaluationHandler = (name: string) => void;

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

const ANALYSIS_KIND_LABELS: Record<AnalysisResult['op'], string> = {
    gradient: '梯度',
    divergence: '散度',
    curl: '旋度',
};

const INTEGRAL_METHOD_LABELS: Record<IntegralTask['method'], string> = {
    trapezoid: '梯形法',
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

function intersectionSummary(
    task: IntersectionTask,
    output: IntersectionOutput,
): string {
    const source = `${task.aName} ∩ ${task.bName}`;
    if (output.points.length > 0) {
        return `${source} · 交点 ${output.points.length} 个`;
    }
    const pointCount = output.curves.reduce(
        (total, curve) => total + curve.length,
        0,
    );
    return `${source} · 交线 ${output.curves.length} 条 · ${pointCount} 个点`;
}

function createElement(tag: string, className?: string, text?: string): HTMLElement {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
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
    if (Math.abs(object.topRadius - object.baseRadius) < 1e-9) {
        return '圆柱';
    }
    if (object.topRadius < 1e-9) {
        return '圆锥';
    }
    return '圆台';
}

function analysisSummary(analysis: AnalysisResult): string {
    const point = `P=${formatVector(analysis.point)}`;
    switch (analysis.op) {
        case 'gradient': {
            // 隐式场/球体的分析点额外回显球坐标 [r, θ, φ](相对世界原点,
            // θ/φ 约定见 numericConfig.analysis.sphericalAngleConvention).
            const spherical = analysis.pointSpherical
                ? ` · (r,θ,φ)=${formatVector(analysis.pointSpherical)}`
                : '';
            return `${point} · f(P)=${formatNumber(analysis.scalar ?? NaN)} · ∇f=${formatVector(analysis.vector)}${spherical}`;
        }
        case 'divergence':
            return `${point} · ∇·F(P)=${formatNumber(analysis.scalar ?? NaN)}`;
        case 'curl':
            return `${point} · ∇×F(P)=${formatVector(analysis.vector)}`;
    }
}

function integralTaskKey(task: IntegralTask): string {
    return JSON.stringify([
        task.name,
        task.objectId,
        task.sourceKind,
        task.dim,
        task.domainKind,
        task.method,
        task.integrand,
        task.integrandCoefficients,
        task.range,
        task.segments,
        task.layers,
        task.show,
        task.enabled,
    ]);
}

function intersectionTaskKey(task: IntersectionTask): string {
    return JSON.stringify([
        task.name,
        task.aName,
        task.bName,
        task.aId,
        task.bId,
        task.segments,
        task.color,
        task.enabled,
    ]);
}

/** 分析条目 key:公式内容全部由这些字段决定;不变就复用 DOM(含展开态). */
function analysisTaskKey(analysis: AnalysisResult): string {
    return JSON.stringify([
        analysis.name,
        analysis.op,
        analysis.point,
        analysis.pointSpherical,
        analysis.vector,
        analysis.tangent,
        analysis.scalar,
        analysis.show,
        analysis.enabled,
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
 * 展开细节:每行一段 KaTeX,一行排不下时由 CSS 横向滚动承接.
 *
 * 为什么要折叠:求值条目的完整信息(P,∇f 逐分量,球坐标回显,积分域与
 * 方法)远比一行宽,折叠态只留摘要行,列表才扫得动;细节默认收起由
 * `<details>` 原生实现,不引入第二份 JS 状态.
 */
function createDetailLines(lines: readonly string[]): HTMLElement {
    const container = createElement('div', 'eval-detail');
    for (const line of lines) {
        container.append(createFormulaElement(line, 'eval-detail-line'));
    }
    return container;
}

/**
 * 求值条目的三段结构:
 * - `summary`(`<summary>`):默认可见的摘要行 = 显隐按钮 + 类型徽章 + 名称 + 摘要公式;
 * - `details`(`<details>`):折叠容器,展开后显示 `detail`;
 * - `result`(`.eval-result`):结果一行,始终可见(异步回填的数值/错误).
 *
 * 结果放在 `<details>` 外面:折叠只是为了收纳推导,数值本身是条目的主产出,
 * 不该跟着一起被藏起来.
 */
function createEvaluationShell(
    summary: HTMLElement,
    detail: HTMLElement | null,
    result: HTMLElement,
): { row: HTMLElement; details: HTMLDetailsElement | null } {
    const row = createElement('article', 'object-row evaluation-row');
    const main = createElement('div', 'object-main');

    if (detail === null) {
        main.append(summary, result);
        row.append(main);
        return { row, details: null };
    }

    const details = document.createElement('details');
    details.className = 'eval-details';
    // 默认折叠:全部条目在首次渲染时都是收起状态.
    details.open = false;
    details.append(summary, detail);
    main.append(details, result);
    row.append(main);
    return { row, details };
}

function createVisibilityButton(
    enabled: boolean,
    onToggle: () => void,
): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'entity-visibility-btn';
    button.textContent = enabled ? '隐藏' : '显示';
    button.setAttribute('aria-pressed', String(enabled));
    button.addEventListener('click', onToggle);
    return button;
}

/**
 * footer 对象列表控制器.
 *
 * 左栏展示场景实体对象,右栏展示分析与积分等求值结果.
 * 控制器只负责 DOM,真正的可见性与数值计算由 DslApp 回调驱动.
 *
 * 求值条目(分析/积分/求交)统一是"摘要行 + 可折叠 KaTeX 细节 + 结果行":
 * 摘要行折叠时也渲染公式(关键量仍在),细节展开才排版完整推导.
 */
export class ObjectListController {
    /**
     * @cache
     * 缓存目的:复用分析列表 DOM 行--参数拖动时 renderScene 每帧重跑,
     * 重建会把用户展开的细节重新收起,KaTeX 也要重排.
     * 键/失效策略:分析名 -> { row, key };内容 key 变化时替换.
     * 生命周期:跟随 ObjectListController 实例.
     */
    private readonly analysisRows = new Map<
        string,
        { row: HTMLElement; key: string }
    >();

    /**
     * @cache
     * 缓存目的:复用积分列表 DOM 行,只更新结果文本,避免每次 sync 重建整棵树.
     * 键/失效策略:积分名 -> { row, result, key, summaryLatex };任务消失或任务参数变化时替换.
     * 生命周期:跟随 ObjectListController 实例.
     */
    private readonly integralRows = new Map<
        string,
        {
            row: HTMLElement;
            result: HTMLElement;
            key: string;
            /** 摘要公式的 LaTeX(`...=`),result 元素按它把数值拼成完整等式. */
            summaryLatex: string | null;
        }
    >();

    /**
     * @cache
     * 缓存目的:复用求交列表 DOM 行,Worker 结果回来后只更新结果文本.
     * 键/失效策略:求交名 -> { row, result, key, task };任务消失或任务参数变化时替换.
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

    constructor(
        private readonly entityList: HTMLElement,
        private readonly analysisList: HTMLElement,
        private readonly integralList: HTMLElement,
        private readonly intersectionList: HTMLElement,
        private readonly onToggleEntity: ToggleEntityHandler,
        private readonly onToggleAnalysis: ToggleEvaluationHandler,
        private readonly onToggleIntegral: ToggleEvaluationHandler,
        private readonly onToggleIntersection: ToggleEvaluationHandler,
    ) {}

    renderScene(scene: SceneIR): void {
        this._renderEntities(scene.objects, scene.objectFormulas);
        this._renderAnalyses(scene.analyses);
        this._renderIntegrals(scene.integrals, scene.objects);
        this._renderIntersections(scene.intersections);
    }

    setEntityVisible(id: number, visible: boolean): void {
        const row = this.entityList.querySelector<HTMLElement>(`[data-entity-id="${id}"]`);
        if (!row) return;

        row.classList.toggle('is-hidden', !visible);
        const button = row.querySelector<HTMLButtonElement>('.entity-visibility-btn');
        if (!button) return;
        button.textContent = visible ? '隐藏' : '显示';
        button.setAttribute('aria-pressed', String(visible));
    }

    /**
     * @cache_access
     * 命中积分 DOM 行缓存:把数值接在摘要公式的 `=` 后面(公式可排版时),
     * 否则退化为纯文本.
     */
    setIntegralResult(name: string, value: number): void {
        const item = this.integralRows.get(name);
        if (!item) return;

        // 一维是面积/长度,二维是面积/二重积分,三维是体积/三重积分,
        // 不带 S/V 前缀,由公式行给出语义.
        if (item.summaryLatex !== null) {
            item.result.replaceChildren(
                createFormulaElement(
                    `${item.summaryLatex}${formatNumber(value)}`,
                    'eval-result is-ready',
                ),
            );
        } else {
            item.result.textContent = `${formatNumber(value)}`;
        }
        item.result.className = 'eval-result is-ready';
        item.row.classList.remove('has-error');
    }

    /**
     * @cache_access
     * 命中积分 DOM 行缓存并更新错误文本.
     */
    setIntegralError(name: string, message: string): void {
        const item = this.integralRows.get(name);
        if (!item) return;

        item.result.replaceChildren(document.createTextNode(message));
        item.result.className = 'eval-result is-error';
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
     * 清空实体/分析/积分列表及其 DOM 行缓存.
     */
    clear(): void {
        this.entityList.replaceChildren();
        this.analysisList.replaceChildren();
        this.integralList.replaceChildren();
        this.intersectionList.replaceChildren();
        this.analysisRows.clear();
        this.integralRows.clear();
        this.intersectionRows.clear();
    }

    dispose(): void {
        this.clear();
    }

    private _renderEntities(
        objects: SceneObject[],
        objectFormulas: Record<number, string | null>,
    ): void {
        const fragment = document.createDocumentFragment();

        for (const object of objects) {
            const row = createElement('article', 'object-row entity-row');
            row.dataset.entityId = String(object.id);
            row.classList.toggle('is-hidden', !object.enabled);

            const button = createVisibilityButton(object.enabled, () =>
                this.onToggleEntity(object.id),
            );

            const badge = createElement(
                'span',
                `kind-badge kind-${object.kind}`,
                sceneObjectKindLabel(object),
            );

            const main = createElement('div', 'object-main');
            const name = createElement('strong', 'object-name', object.name ?? `#${object.id}`);
            const formula = objectFormulas[object.id] ?? null;
            const expression = formula
                ? createFormulaElement(formula, 'object-expr')
                : createElement(
                    'code',
                    'object-expr',
                    sceneObjectExpression(object),
                );
            main.append(name, expression);

            row.append(button, badge, main);
            fragment.append(row);
        }

        this.entityList.replaceChildren(fragment);
    }

    /**
     * @cache_access
     * 根据分析结果 key 复用或替换分析 DOM 行缓存.
     */
    private _renderAnalyses(analyses: AnalysisResult[]): void {
        const nextNames = new Set(analyses.map((analysis) => analysis.name));

        for (const [name, item] of this.analysisRows) {
            if (!nextNames.has(name)) {
                item.row.remove();
                this.analysisRows.delete(name);
            }
        }

        for (const analysis of analyses) {
            const key = analysisTaskKey(analysis);
            const existing = this.analysisRows.get(analysis.name);
            if (existing && existing.key === key) continue;

            if (existing) {
                existing.row.remove();
                this.analysisRows.delete(analysis.name);
            }

            const row = this._createAnalysisRow(analysis);
            this.analysisList.append(row);
            this.analysisRows.set(analysis.name, { row, key });
        }
    }

    private _createAnalysisRow(analysis: AnalysisResult): HTMLElement {
        const button = createVisibilityButton(analysis.enabled, () =>
            this.onToggleAnalysis(analysis.name),
        );
        const badge = createElement(
            'span',
            `kind-badge kind-analysis kind-analysis-${analysis.op}`,
            ANALYSIS_KIND_LABELS[analysis.op],
        );
        const name = createElement('strong', 'object-name', analysis.name);

        // 摘要行折叠时也排版:关键量(算子在 P 点的结果)必须一眼可见.
        const summaryLine = createFormulaElement(
            analysisLatexSummary(analysis),
            'eval-summary-formula',
        );
        const summary = createElement('summary', 'eval-summary');
        summary.append(button, badge, name, summaryLine);

        const detail = analysis.enabled
            ? createDetailLines(analysisLatexDetails(analysis))
            : null;
        const result = createElement(
            'code',
            analysis.enabled ? 'eval-result is-ready' : 'eval-result is-disabled',
            analysis.enabled ? analysisSummary(analysis) : '已隐藏,不参与计算',
        );
        const { row } = createEvaluationShell(summary, detail, result);
        row.classList.toggle('is-hidden', !analysis.enabled);
        return row;
    }

    /**
     * @cache_access
     * 根据任务 key 复用或替换积分 DOM 行缓存.
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
            }
        }

        for (const task of tasks) {
            const key = integralTaskKey(task);
            const existing = this.integralRows.get(task.name);
            if (existing && existing.key === key) continue;

            if (existing) {
                existing.row.remove();
                this.integralRows.delete(task.name);
            }

            const created = this._createIntegralRow(task, objects);
            this.integralList.append(created.row);
            this.integralRows.set(task.name, {
                row: created.row,
                result: created.row.querySelector<HTMLElement>('.eval-result')!,
                key,
                summaryLatex: created.summaryLatex,
            });
        }
    }

    private _createIntegralRow(
        task: IntegralTask,
        objects: SceneObject[],
    ): { row: HTMLElement; summaryLatex: string | null } {
        const button = createVisibilityButton(task.enabled, () =>
            this.onToggleIntegral(task.name),
        );
        const badge = createElement('span', 'kind-badge kind-integral', '积分');
        const name = createElement('strong', 'object-name', task.name);

        // 摘要公式 = 积分式本体 + `=`,数值稍后由 setIntegralResult 接上;
        // 展不开公式(null,例如被积对象已删除)时退回纯文本摘要,不编造公式.
        const summaryLatex = integralLatexSummary(task, objects);
        const summaryLine: HTMLElement = summaryLatex === null
            ? createElement('code', 'object-expr', integralSourceLabel(task, objects))
            : createFormulaElement(summaryLatex, 'eval-summary-formula');
        const summary = createElement('summary', 'eval-summary');
        summary.append(button, badge, name, summaryLine);

        const detail = task.enabled
            ? createDetailLines(
                integralLatexDetails(
                    task,
                    objects,
                    INTEGRAL_METHOD_LABELS[task.method],
                ),
            )
            : null;
        const result = createElement(
            'code',
            task.enabled ? 'eval-result is-pending' : 'eval-result is-disabled',
            task.enabled ? '计算中...' : '已隐藏,不参与计算',
        );
        const { row } = createEvaluationShell(summary, detail, result);
        row.classList.toggle('is-hidden', !task.enabled);
        return { row, summaryLatex };
    }

    /**
     * @cache_access
     * 根据任务 key 复用或替换求交 DOM 行缓存.
     */
    private _renderIntersections(tasks: IntersectionTask[]): void {
        const nextNames = new Set(tasks.map((task) => task.name));

        for (const [name, item] of this.intersectionRows) {
            if (!nextNames.has(name)) {
                item.row.remove();
                this.intersectionRows.delete(name);
            }
        }

        for (const task of tasks) {
            const key = intersectionTaskKey(task);
            const existing = this.intersectionRows.get(task.name);
            if (existing && existing.key === key) continue;

            if (existing) {
                existing.row.remove();
                this.intersectionRows.delete(task.name);
            }

            const row = this._createIntersectionRow(task);
            this.intersectionList.append(row);
            this.intersectionRows.set(task.name, {
                row,
                result: row.querySelector<HTMLElement>('.eval-result')!,
                key,
                task,
            });
        }
    }

    private _createIntersectionRow(task: IntersectionTask): HTMLElement {
        const button = createVisibilityButton(task.enabled, () =>
            this.onToggleIntersection(task.name),
        );
        const badge = createElement('span', 'kind-badge kind-intersection', '求交');
        const name = createElement('strong', 'object-name', task.name);

        const summaryLine = createFormulaElement(
            intersectionLatexSummary(task),
            'eval-summary-formula',
        );
        const summary = createElement('summary', 'eval-summary');
        summary.append(button, badge, name, summaryLine);

        const detail = task.enabled
            ? createDetailLines(intersectionLatexDetails(task))
            : null;
        const result = createElement(
            'code',
            task.enabled ? 'eval-result is-pending' : 'eval-result is-disabled',
            task.enabled ? '计算中...' : '已隐藏,不参与计算',
        );
        const { row } = createEvaluationShell(summary, detail, result);
        row.classList.toggle('is-hidden', !task.enabled);
        return row;
    }
}
