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
    readonly classList = new StubClassList(this);
    readonly children: Array<StubElement | StubText> = [];
    readonly listeners = new Map<string, Array<() => void>>();
    readonly dataset: Record<string, string> = {};
    private readonly attributes = new Map<string, string>();

    constructor(readonly tagName: string) {}

    append(...nodes: Array<StubElement | StubText | null>): void {
        for (const node of nodes) {
            if (node !== null) this.children.push(node);
        }
    }

    prepend(...nodes: Array<StubElement | StubText>): void {
        this.children.unshift(...nodes);
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
    it('折叠态只有一行 KaTeX 公式,行内没有任何按钮', () => {
        const { analysisList, controller } = createController();
        controller.renderScene(scene);

        // 开合交给 <details>/<summary> 原生行为:摘要行就是 <summary>.
        expect(analysisList.querySelectorAll('summary')).toHaveLength(1);
        // 行内不许出现任何自建按钮.这里只断言"没有任何 <button>",不点名
        // eval-toggle-btn / entity-visibility-btn--那两个类已从代码里删掉,
        // 保留旧类名断言只会是永远成立的噪音,盖不住新写的按钮.
        expect(analysisList.querySelectorAll('button')).toHaveLength(0);
        expect(analysisList.querySelectorAll('.eval-summary-formula')).toHaveLength(1);
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

    it('展开细节逐行分块:每行一个 .eval-detail-line,不挤成一行', () => {
        const { analysisList, controller } = createController();
        controller.renderScene(scene);

        const outer = analysisList.querySelector<StubElement>('.eval-details')!;
        const container = outer.querySelector<StubElement>('.eval-details')!;
        const lines = container.querySelectorAll<StubElement>('.eval-detail-line');
        // 梯度:符号展开 / ∇f(P) / P / f(P) 至少 4 行.
        expect(lines.length).toBeGreaterThanOrEqual(4);
        expect(lines[0].textContent).toContain('\\nabla f');
    });

    it('积分结果行在 <details> 内:折叠时整条只剩摘要公式', () => {
        const { integralList, controller } = createController();
        controller.renderScene(scene);
        controller.setIntegralResult('I', 2.775558e-17);

        const details = integralList.querySelector<StubElement>('.eval-details')!;
        // 结果行是 details 的后代:跟着一起开合.
        const result = details.querySelector<StubElement>('.eval-result')!;
        expect(result.textContent).toContain('\\mathrm{d}x=');
        expect(result.textContent).toContain('\\times10^{-17}');
        expect(result.textContent).not.toContain('e-17');
        // 结果行位于 <details> 子树内:折叠时随细节一起隐藏.
        expect(details.querySelectorAll<StubElement>('.eval-result')).toHaveLength(1);
    });
});
