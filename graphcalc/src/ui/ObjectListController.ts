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
import { latexResultNumber } from '../math/latexNumber';
import { createFormulaElement } from './FormulaView';


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
 * 方法)远比一行宽,折叠态只留摘要行,列表才扫得动;默认收起由
 * `<details open=false>` 实现,开合只认显式按钮.
 */
function createDetailLines(lines: readonly string[]): HTMLElement {
    const container = createElement('div', 'eval-details');
    for (const line of lines) {
        container.append(createFormulaElement(line, 'eval-detail-line'));
    }
    return container;
}

/**
 * 积分条目的 DOM 缓存项.
 *
 * `result` 可能为 null(纯公式条目没有独立结果行),`bodyLatex` 是积分式本体
 * (不含 `=`),数值回填后按它把结果行与展开细节里的等式一起刷新.
 */
interface IntegralRow {
    row: HTMLElement;
    result: HTMLElement | null;
    bodyLatex: string | null;
}

/**
 * 求值条目的三段结构:
 * - `summary`(`<summary>`):折叠态可见 = 一段 KaTeX 公式.开合完全交给
 *   `<details>` 的原生行为(点摘要行即开合),不额外放按钮;
 * - `details`(`<details>`):折叠容器,展开后显示 `detail`,默认收起;
 * - `result`(`.eval-result`):结果一行,**放在 `<details>` 里面**的最后,
 *   跟着一起开合--折叠时整条只剩摘要行,展开才给完整过程与数值.
 *
 * 显隐按钮已整体移除:求值对象是否参与计算没有 UI 开关,`enabled` 只由
 * 编译侧(隐藏集合)决定.
 */
function createEvaluationShell(
    summary: HTMLElement,
    detail: HTMLElement | null,
    result: HTMLElement | null,
): HTMLElement {
    const row = createElement('article', 'object-row evaluation-row');
    const main = createElement('div', 'object-main');

    if (detail === null) {
        main.append(summary);
        if (result !== null) main.append(result);
        row.append(main);
        return row;
    }

    const details = document.createElement('details');
    details.className = 'eval-details';
    // 默认折叠:全部条目在首次渲染时都是收起状态.
    details.open = false;
    details.append(summary, detail);
    if (result !== null) details.append(result);
    main.append(details);
    row.append(main);
    return row;
}

/**
 * footer 对象列表控制器.
 *
 * 左栏展示场景实体对象,右栏展示分析与积分等求值结果.
 * 控制器只负责 DOM,真正的可见性与数值计算由 DslApp 回调驱动.
 *
 * 求值条目(分析/积分/求交)统一是"显式展开按钮 + KaTeX 摘要公式 + 可折叠
 * KaTeX 细节 + 结果行":摘要行只排版公式,细节展开才给中间步骤与逐分量数值.
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
     * 键/失效策略:积分名 -> { row, result, key, bodyLatex };任务消失或任务参数变化时替换.
     * 生命周期:跟随 ObjectListController 实例.
     */
    private readonly integralRows = new Map<string, IntegralRow & { key: string }>();

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

    /**
     * @cache
     * 缓存目的:保存每个积分的最新数值.展开细节里的等式与结果行必须同源,
     * 而细节行是异步结果回来之前就建好的,只能靠这份缓存回填.
     * 键/失效策略:积分名 -> 数值;任务消失时随行缓存一起清理,出错时删除.
     * 生命周期:跟随 ObjectListController 实例.
     */
    private readonly integralResults = new Map<string, number>();

    constructor(
        private readonly entityList: HTMLElement,
        private readonly analysisList: HTMLElement,
        private readonly integralList: HTMLElement,
        private readonly intersectionList: HTMLElement,
    ) {}

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

        this.integralResults.set(name, value);
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
        if (!item.result) return;
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

    /** 取积分最新数值(未回填/已出错时为 null). */
    private _integralResult(name: string): number | null {
        return this.integralResults.get(name) ?? null;
    }

    /**
     * 刷新积分结果行:排成完整等式 `∫f dx = 数值`;积分式不可排版时只给数值.
     *
     * 结果行与展开细节的第一行是同一个公式,这里同时更新两处,避免展开前后
     * 看到两个不同版本的数值.
     */
    private _renderIntegralResult(item: IntegralRow, value: number): void {
        if (item.result === null) return;
        if (item.bodyLatex === null) {
            // 积分式排不出来时只给数值文本.
            item.result.replaceChildren(
                document.createTextNode(formatNumber(value)),
            );
            item.result.className = 'eval-result is-ready';
        } else {
            // 公式元素由 createFormulaElement 统一带上类名,结果行自身只挂
            // 基础类,避免出现两层 `eval-result`.
            item.result.replaceChildren(
                createFormulaElement(
                    `${item.bodyLatex}=${latexResultNumber(value)}`,
                    'eval-result is-ready',
                ),
            );
            item.result.className = '';
        }
        this._replaceIntegralEquation(item, value);
    }

    /**
     * 把展开细节里的积分等式换成 `∫f dx = 数值`;`value = null` 时退回不带
     * 右端的积分式(出错/尚未算出).
     */
    private _replaceIntegralEquation(item: IntegralRow, value: number | null): void {
        if (item.bodyLatex === null) return;
        // 细节容器是 row > details > .eval-details,首个子元素就是积分等式那一行.
        const container = item.row.querySelector<HTMLElement>('.eval-details > .eval-details');
        const line = container?.firstElementChild;
        if (!container || !line) return;

        const latex = value === null
            ? item.bodyLatex
            : `${item.bodyLatex}=${latexResultNumber(value)}`;
        const rest = [...container.children].slice(1);
        container.replaceChildren(
            createFormulaElement(latex, 'eval-detail-line'),
            ...rest,
        );
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

            row.append(badge, main);
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
        // 折叠态只排一行 KaTeX 公式(类型徽章/名称/纯文本摘要都与公式重复,
        // 名字留在源码与诊断里).
        const summaryLine = createFormulaElement(
            analysisLatexSummary(analysis),
            'eval-summary-formula',
        );
        const summary = document.createElement('summary');
        summary.className = 'eval-summary';
        summary.append(summaryLine);

        // 展开细节里先给算子的符号展开,再给该点的数值结果.
        const details = analysis.enabled
            ? createDetailLines(analysisLatexDetails(analysis))
            : null;

        const row = createEvaluationShell(summary, details, null);
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
            this.integralRows.set(task.name, { ...created, key });
        }
    }

    private _createIntegralRow(task: IntegralTask, objects: SceneObject[]): IntegralRow {
        // 摘要公式 = 积分式本体(不接 `=`):与梯度条目同一条约定--折叠态只给
        // 算子的书写形式,数值由 setIntegralResult 排版成完整等式.展不开公式
        // (null,例如被积对象已删除)时退回纯文本,不编造公式.
        const bodyLatex = integralLatexSummary(task, objects);
        const summaryLine: HTMLElement = bodyLatex === null
            ? createElement('code', 'object-expr', integralSourceLabel(task, objects))
            : createFormulaElement(bodyLatex, 'eval-summary-formula');
        const summary = document.createElement('summary');
        summary.className = 'eval-summary';
        summary.append(summaryLine);

        const cachedResult = this._integralResult(task.name);
        // 展开细节第一行就是完整等式 `∫f dx = 数值`;数值尚未回填时省略右端.
        const details = task.enabled
            ? createDetailLines(integralLatexDetails(
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
        const summaryLine = createFormulaElement(
            intersectionLatexSummary(task),
            'eval-summary-formula',
        );
        const summary = document.createElement('summary');
        summary.className = 'eval-summary';
        summary.append(summaryLine);

        // 求交是异步任务:交点/交线数量由 Worker 回填到结果行,展开细节给
        // 两个源对象与采样分段.
        const detail = task.enabled
            ? createDetailLines(intersectionLatexDetails(task))
            : null;
        const result = createElement(
            'code',
            task.enabled ? 'eval-result is-pending' : 'eval-result is-disabled',
            task.enabled ? '计算中...' : '已隐藏,不参与计算',
        );
        const row = createEvaluationShell(summary, detail, result);
        row.classList.toggle('is-hidden', !task.enabled);
        return row;
    }
}
