/**
 * 求值列表条目结构单测(纯 DOM 桩,不引入 jsdom).
 *
 * 锁的是几条来自实际反馈的约束:
 * 1. 求值行里**没有任何自建按钮**:开合交给 <details>/<summary> 原生行为
 *    (摘要行就是 <summary>,点它由浏览器开合),`eval-toggle-btn` 与
 *    `entity-visibility-btn` 及其行为已整体移除;
 * 2. 折叠态只有一行 KaTeX 公式;
 * 3. 展开细节逐行分块(.eval-details 下每行一个 .eval-detail-line),不是
 *    一堆 inline 公式挤成一行;结果行在 <details> 内,跟着一起开合.
 *
 * DOM 桩只实现 ObjectListController 用到的 API;KaTeX 用 render(tex, el)
 * 写回 textContent 的假实现,断言只看结构与 LaTeX 文本,不看排版.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnalysisResult, SceneIR, SceneObject } from '../compiler/ir/types';

vi.mock('katex', () => ({
    default: {
        // 真 KaTeX 会把排版结果写进传入的元素;桩里直接回写 TeX 文本,
        // FormulaView 的模板 clone 才能带上内容.
        render: (tex: string, element: { textContent: string }) => {
            element.textContent = tex;
        },
    },
}));
vi.mock('katex/dist/katex.min.css', () => ({}));

import { ObjectListController } from './ObjectListController';

class StubClassList {
    constructor(private readonly element: StubElement) {}

    private names(): Set<string> {
        return new Set(this.element.className.split(/\s+/).filter(Boolean));
    }

    contains(name: string): boolean {
        return this.names().has(name);
    }

    toggle(name: string, force?: boolean): boolean {
        const next = this.names();
        const on = force ?? !next.has(name);
        if (on) next.add(name);
        else next.delete(name);
        this.element.className = [...next].join(' ');
        return on;
    }

    add(name: string): void {
        this.toggle(name, true);
    }

    remove(name: string): void {
        this.toggle(name, false);
    }
}

class StubText {
    constructor(readonly data: string) {}
}

class StubElement {
    className = '';
    /** 桩的 textContent 是真 DOM 语义:取值时拼接全部子文本节点. */
    get textContent(): string {
        return this.children
            .map((child) => (child instanceof StubText ? child.data : child.textContent))
            .join('');
    }

    set textContent(value: string) {
        this.children.length = 0;
        if (value !== '') this.children.push(new StubText(value));
    }

    title = '';
    /** <details> 的开合状态;普通元素上无意义. */
    open = false;
    /** 父元素;append/prepend/replaceChildren 时维护,replaceWith 需要它. */
    parent: StubElement | null = null;
    readonly classList = new StubClassList(this);
    readonly children: Array<StubElement | StubText> = [];
    readonly listeners = new Map<string, Array<() => void>>();
    readonly dataset: Record<string, string> = {};
    private readonly attributes = new Map<string, string>();

    constructor(readonly tagName: string) {}

    append(...nodes: Array<StubElement | StubText | null>): void {
        for (const node of nodes) {
            if (node === null) continue;
            if (node instanceof StubElement) node.parent = this;
            this.children.push(node);
        }
    }

    prepend(...nodes: Array<StubElement | StubText>): void {
        for (const node of nodes) {
            if (node instanceof StubElement) node.parent = this;
        }
        this.children.unshift(...nodes);
    }

    /** 真 DOM 的 replaceWith:用新节点顶替自己在父节点中的位置. */
    replaceWith(...nodes: Array<StubElement | StubText>): void {
        const parent = this.parent;
        if (!parent) return;
        const index = parent.children.indexOf(this);
        if (index < 0) return;
        for (const node of nodes) {
            if (node instanceof StubElement) node.parent = parent;
        }
        parent.children.splice(index, 1, ...nodes);
        this.parent = null;
    }

    /** 真 DOM 的 childNodes 含文本节点;桩里直接暴露同一个 children 数组. */
    get childNodes(): Array<StubElement | StubText> {
        return this.children;
    }

    replaceChildren(...nodes: Array<StubElement | StubText>): void {
        this.children.length = 0;
        this.append(...nodes);
    }

    querySelector<T>(selector: string): T | null {
        return (this.querySelectorAll<T>(selector)[0] ?? null) as T | null;
    }

    querySelectorAll<T>(selector: string): T[] {
        // 只支持单段选择器:`tag` / `.class` / `tag.class`.
        const [, tag, className] = /^([a-zA-Z]*)(?:\.(.+))?$/.exec(selector.trim()) ?? [];
        const found: StubElement[] = [];
        const walk = (node: StubElement): void => {
            const tagOk = !tag || node.tagName === tag;
            const classOk = !className || node.classList.contains(className);
            if (tagOk && classOk) found.push(node);
            for (const child of node.children) {
                if (child instanceof StubElement) walk(child);
            }
        };
        for (const child of this.children) {
            if (child instanceof StubElement) walk(child);
        }
        return found as unknown as T[];
    }

    addEventListener(type: string, handler: () => void): void {
        const list = this.listeners.get(type) ?? [];
        list.push(handler);
        this.listeners.set(type, list);
    }

    /** 只触发本元素上的监听(不冒泡),用来验证"点行不开合". */
    dispatch(type: string): void {
        for (const handler of this.listeners.get(type) ?? []) handler();
    }

    setAttribute(name: string, value: string): void {
        this.attributes.set(name, value);
    }

    getAttribute(name: string): string | null {
        return this.attributes.get(name) ?? null;
    }

    /** FormulaView 的模板缓存靠 cloneNode 复制模板,桩里做一次浅+深拷贝. */
    cloneNode(deep?: boolean): StubElement {
        const copy = new StubElement(this.tagName);
        copy.className = this.className;
        copy.title = this.title;
        copy.open = this.open;
        Object.assign(copy.dataset, this.dataset);
        for (const [name, value] of this.attributes) copy.setAttribute(name, value);
        if (deep) {
            copy.children.push(...this.children.map((child) => (
                child instanceof StubElement ? child.cloneNode(true) : child
            )));
        }
        // 真 DOM 里 textContent 与子节点是同一份数据;桩里若两者都写会翻倍,
        // 所以只在没有子节点时补文本.
        if (copy.children.length === 0) copy.textContent = this.textContent;
        return copy;
    }

    remove(): void {}
}

beforeEach(() => {
    (globalThis as unknown as { document: unknown }).document = {
        createElement: (tag: string) => new StubElement(tag),
        createTextNode: (text: string) => new StubText(text),
        createDocumentFragment: () => new StubElement('#fragment'),
    };
});

const analysis: AnalysisResult = {
    name: 'g',
    op: 'gradient',
    point: [1, 2, 3],
    symbolic: '\\nabla f=(a, b, c)',
    vector: [0.1, 0.2, 0.3],
    tangent: null,
    scalar: 4,
    show: ['point', 'normal'],
    enabled: true,
};

const curve: SceneObject = {
    kind: 'curve',
    id: 1,
    name: 'c1',
    expr: 'sin(x*a)*cos(x*b)',
    coefficients: [],
    color: '#ffffff',
    enabled: true,
};

const scene = {
    params: [],
    objects: [curve],
    objectFormulas: { 1: 'y=1' },
    integralFormulas: {},
    objectTransforms: {},
    animations: [],
    objectAnimations: {},
    analyses: [analysis],
    integrals: [
        {
            name: 'I',
            objectId: 1,
            sourceKind: 'curve',
            dim: 1,
            domainKind: 'interval',
            method: 'riemann:mid',
            integrand: 'sin(x*a)*cos(x*b)',
            integrandCoefficients: [],
            countCoefficients: [],
            range: [-4, 4],
            segments: 32,
            layers: 32,
            show: true,
            enabled: true,
        },
    ],
    intersections: [
        {
            name: 'X',
            aName: 'c1',
            bName: 'c2',
            aId: 1,
            bId: 2,
            segments: 128,
            color: '#ffffff',
            enabled: true,
        },
    ],
} as unknown as SceneIR;

function createController(): {
    analysisList: StubElement;
    integralList: StubElement;
    intersectionList: StubElement;
    controller: ObjectListController;
} {    const entityList = new StubElement('div');
    const analysisList = new StubElement('div');
    const integralList = new StubElement('div');
    const intersectionList = new StubElement('div');
    const controller = new ObjectListController(
        entityList as unknown as HTMLElement,
        analysisList as unknown as HTMLElement,
        integralList as unknown as HTMLElement,
        intersectionList as unknown as HTMLElement,
    );
    return { analysisList, integralList, intersectionList, controller };
}

describe('求值条目的折叠结构', () => {
    it('折叠态:彩色标签 + 变量名 + 一行 KaTeX,摘要在 <details> 外层不可复制', () => {
        const { analysisList, controller } = createController();
        controller.renderScene(scene);

        // 开合交给 <details>/<summary> 原生行为:摘要行就是 <summary>.
        expect(analysisList.querySelectorAll('summary')).toHaveLength(1);
        // 行内不许出现任何自建按钮(不点名已删除的旧类名,否则是恒真断言).
        expect(analysisList.querySelectorAll('button')).toHaveLength(0);

        const summary = analysisList.querySelector<StubElement>('.eval-summary')!;
        // 彩色类型标签 + 变量名回来了.
        const badge = summary.querySelector<StubElement>('.kind-badge')!;
        expect(badge.className).toBe('kind-badge kind-analysis kind-analysis-gradient');
        expect(badge.textContent).toBe('梯度');
        expect(summary.querySelector<StubElement>('.object-name')!.textContent).toBe('g');

        // 摘要公式不带 data-tex:点摘要行只开合,不复制 TeX.
        const summaryFormula = summary.querySelector<StubElement>('.eval-summary-formula')!;
        expect(summaryFormula.dataset.tex).toBeUndefined();
    });

    it('摘要行是 <summary>:点它由浏览器开合,行内没有自建热区', () => {
        const { analysisList, controller } = createController();
        controller.renderScene(scene);

        const details = analysisList.querySelector<StubElement>('.eval-details')!;
        const summary = details.children[0] as StubElement;
        expect(summary.tagName).toBe('summary');
        expect(details.open).toBe(false);
        // <details> 的原生开合:浏览器点 summary 会翻 open(桩里手动模拟),
        // 控制器不监听任何 click.
        expect(summary.listeners.get('click')).toBeUndefined();
        details.open = true;
        expect(details.open).toBe(true);
    });

    it('元信息是纯文本块,且在公式块之外;结果行自身承载完整等式', () => {
        const { integralList, controller } = createController();
        controller.renderScene(scene);
        controller.setIntegralResult('I', 1.5);

        const details = integralList.querySelector<StubElement>('.eval-details')!;
        // 公式块与元信息块是同级兄弟,元信息**不在**公式块里.
        const formulaBlock = details.querySelector<StubElement>('.eval-detail-body')!;
        const metaBlock = details.querySelector<StubElement>('.eval-detail-meta-block')!;
        expect(formulaBlock).toBeDefined();
        expect(metaBlock).toBeDefined();
        expect(formulaBlock.querySelectorAll<StubElement>('.eval-detail-meta')).toHaveLength(0);

        const metas = metaBlock.querySelectorAll<StubElement>('.eval-detail-meta');
        expect(metas.length).toBe(2);
        expect(metas[0].textContent).toContain('域: c1');
        expect(metas[0].textContent).toContain('黎曼和(中点)');
        expect(metas[0].textContent).not.toContain('\\text');
        expect(metas[0].dataset.tex).toBeUndefined();
        expect(metas[1].textContent).toBe('分段: 32 · 分层: 32');

        // 结果行在公式块内部:公式行与结果行同属数学内容,共用同一条竖线.
        const result = formulaBlock.querySelector<StubElement>('.eval-result')!;
        expect(result).toBeDefined();
        expect(result.className).toBe('eval-result is-ready');
        expect(result.textContent).toContain('=1.5');
        // 结果行的 <code> 自身就是公式根节点:内部只有 KaTeX 生成的 .katex,
        // 不再出现"两层 eval-result"的 span.
        expect(result.querySelectorAll<StubElement>('.eval-result')).toHaveLength(0);
        expect(details.querySelectorAll<StubElement>('.eval-result')).toHaveLength(1);
    });

    it('展开细节的公式行集中在 .eval-detail-body,逐行且可点击复制', () => {
        const { analysisList, controller } = createController();
        controller.renderScene(scene);

        const body = analysisList.querySelector<StubElement>('.eval-detail-body')!;
        const lines = body.querySelectorAll<StubElement>('.eval-detail-line');
        // 梯度:符号展开 / ∇f(P) / P / f(P) 至少 4 行.
        expect(lines.length).toBeGreaterThanOrEqual(4);
        expect(lines[0].textContent).toContain('\\nabla f');
        // 复制只认公式行:每行都带 data-tex(摘要行不带).
        for (const line of lines) {
            expect(line.dataset.tex).toBeDefined();
        }
        // 分析条目没有纯文本元信息,不该凭空出现元信息块.
        expect(analysisList.querySelectorAll<StubElement>('.eval-detail-meta')).toHaveLength(0);
    });

    it('结果行与元信息都在 <details> 内:折叠时整条只剩摘要公式', () => {
        const { integralList, controller } = createController();
        controller.renderScene(scene);
        controller.setIntegralResult('I', 2.775558e-17);

        const details = integralList.querySelector<StubElement>('.eval-details')!;
        const body = details.querySelector<StubElement>('.eval-detail-body')!;
        // 结果行是公式块的子元素(<code> 放进 <div class="eval-detail-body">).
        const result = body.querySelector<StubElement>('.eval-result')!;
        expect(result).toBeDefined();
        expect(result.textContent).toContain('\\mathrm{d}x=');
        expect(result.textContent).toContain('\\times10^{-17}');
        expect(result.textContent).not.toContain('e-17');
        expect(details.querySelectorAll<StubElement>('.eval-result')).toHaveLength(1);
        // 折叠态可见的只有 summary 里的那一行公式.
        const summary = details.children[0] as StubElement;
        expect(summary.tagName).toBe('summary');
        expect(summary.querySelectorAll<StubElement>('.eval-detail-body')).toHaveLength(0);
    });
});
