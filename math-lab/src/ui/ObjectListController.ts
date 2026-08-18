import type {
    AnalysisResult,
    IntegralTask,
    SceneIR,
    SceneObject,
} from '../compiler/ir/types';

type ToggleEntityHandler = (id: number) => void;
type ToggleEvaluationHandler = (name: string) => void;

const ENTITY_KIND_LABELS: Record<SceneObject['kind'], string> = {
    curve: '曲线',
    surface: '曲面',
    vector_field: '向量场',
    point: '点',
    vector: '向量',
};

const ANALYSIS_KIND_LABELS: Record<AnalysisResult['op'], string> = {
    gradient: '梯度',
    divergence: '散度',
    curl: '旋度',
};

const INTEGRAL_METHOD_LABELS: Record<IntegralTask['method'], string> = {
    trapezoid: '梯形法',
    simpson: '辛普森法',
    riemann: '黎曼和',
    lebesgue: '勒贝格法',
};

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
    }
}

function analysisSummary(analysis: AnalysisResult): string {
    const point = `P=${formatVector(analysis.point)}`;
    switch (analysis.op) {
        case 'gradient':
            return `${point} · f(P)=${formatNumber(analysis.scalar ?? NaN)} · ∇f=${formatVector(analysis.vector)}`;
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
        task.method,
        task.range,
        task.segments,
        task.layers,
        task.show,
        task.enabled,
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
            : '对象';
    const sourceName = source ? source.name : `#${task.objectId}`;
    return `${sourceLabel} ${sourceName} · ${INTEGRAL_METHOD_LABELS[task.method]}`;
}

/**
 * footer 对象列表控制器.
 *
 * 左栏展示场景实体对象,右栏展示分析与积分等求值结果。
 * 控制器只负责 DOM,真正的可见性与数值计算由 DslApp 回调驱动.
 */
export class ObjectListController {
    private readonly integralRows = new Map<
        string,
        { row: HTMLElement; result: HTMLElement; key: string }
    >();

    constructor(
        private readonly entityList: HTMLElement,
        private readonly analysisList: HTMLElement,
        private readonly integralList: HTMLElement,
        private readonly onToggleEntity: ToggleEntityHandler,
        private readonly onToggleAnalysis: ToggleEvaluationHandler,
        private readonly onToggleIntegral: ToggleEvaluationHandler,
    ) {}

    renderScene(scene: SceneIR): void {
        this._renderEntities(scene.objects);
        this._renderAnalyses(scene.analyses);
        this._renderIntegrals(scene.integrals, scene.objects);
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

    setIntegralResult(name: string, value: number): void {
        const item = this.integralRows.get(name);
        if (!item) return;

        item.result.textContent = `S = ${formatNumber(value)}`;
        item.result.className = 'eval-result is-ready';
        item.row.classList.remove('has-error');
    }

    setIntegralError(name: string, message: string): void {
        const item = this.integralRows.get(name);
        if (!item) return;

        item.result.textContent = message;
        item.result.className = 'eval-result is-error';
        item.row.classList.add('has-error');
    }

    clear(): void {
        this.entityList.replaceChildren();
        this.analysisList.replaceChildren();
        this.integralList.replaceChildren();
        this.integralRows.clear();
    }

    dispose(): void {
        this.clear();
    }

    private _renderEntities(objects: SceneObject[]): void {
        const fragment = document.createDocumentFragment();

        for (const object of objects) {
            const row = createElement('article', 'object-row entity-row');
            row.dataset.entityId = String(object.id);
            row.classList.toggle('is-hidden', !object.enabled);

            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'entity-visibility-btn';
            button.textContent = object.enabled ? '隐藏' : '显示';
            button.setAttribute('aria-pressed', String(object.enabled));
            button.addEventListener('click', () => this.onToggleEntity(object.id));

            const badge = createElement(
                'span',
                `kind-badge kind-${object.kind}`,
                ENTITY_KIND_LABELS[object.kind],
            );

            const main = createElement('div', 'object-main');
            const name = createElement('strong', 'object-name', object.name ?? `#${object.id}`);
            const expression = createElement(
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

    private _renderAnalyses(analyses: AnalysisResult[]): void {
        const fragment = document.createDocumentFragment();

        for (const analysis of analyses) {
            const row = createElement('article', 'object-row evaluation-row');
            row.classList.toggle('is-hidden', !analysis.enabled);

            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'entity-visibility-btn';
            button.textContent = analysis.enabled ? '隐藏' : '显示';
            button.setAttribute('aria-pressed', String(analysis.enabled));
            button.addEventListener('click', () => this.onToggleAnalysis(analysis.name));

            const badge = createElement(
                'span',
                `kind-badge kind-analysis kind-analysis-${analysis.op}`,
                ANALYSIS_KIND_LABELS[analysis.op],
            );
            const main = createElement('div', 'object-main');
            const name = createElement('strong', 'object-name', analysis.name);
            const result = createElement(
                'code',
                analysis.enabled ? 'eval-result is-ready' : 'eval-result is-disabled',
                analysis.enabled ? analysisSummary(analysis) : '已隐藏,不参与计算',
            );
            main.append(name, result);
            row.append(button, badge, main);
            fragment.append(row);
        }

        this.analysisList.replaceChildren(fragment);
    }

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

            const row = this._createIntegralRow(task, objects);
            this.integralList.append(row);
            this.integralRows.set(task.name, {
                row,
                result: row.querySelector<HTMLElement>('.eval-result')!,
                key,
            });
        }
    }

    private _createIntegralRow(
        task: IntegralTask,
        objects: SceneObject[],
    ): HTMLElement {
        const row = createElement('article', 'object-row evaluation-row');
        row.classList.toggle('is-hidden', !task.enabled);

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'entity-visibility-btn';
        button.textContent = task.enabled ? '隐藏' : '显示';
        button.setAttribute('aria-pressed', String(task.enabled));
        button.addEventListener('click', () => this.onToggleIntegral(task.name));

        const badge = createElement(
            'span',
            'kind-badge kind-integral',
            '积分',
        );
        const main = createElement('div', 'object-main');
        const name = createElement('strong', 'object-name', task.name);
        const meta = createElement(
            'code',
            'object-expr',
            integralSourceLabel(task, objects),
        );
        const result = createElement(
            'code',
            task.enabled ? 'eval-result is-pending' : 'eval-result is-disabled',
            task.enabled ? '计算中…' : '已隐藏,不参与计算',
        );
        main.append(name, meta, result);
        row.append(button, badge, main);
        return row;
    }
}
