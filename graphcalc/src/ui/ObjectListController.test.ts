/**
 * 求值列表条目结构单测(最小 DOM 桩,见 test/domStub.ts,不引入 jsdom).
 *
 * 锁的是几条来自实际反馈的约束:
 * 1. 求值行里**没有任何自建按钮**:开合交给 <details>/<summary> 原生行为
 *    (摘要行就是 <summary>,点它由浏览器开合),`eval-toggle-btn` 与
 *    `entity-visibility-btn` 及其行为已整体移除;
 * 2. 折叠态只有一行 KaTeX 公式;
 * 3. 展开细节逐行分块(.eval-details 下每行一个 .eval-detail-line),不是
 *    一堆 inline 公式挤成一行;结果行在 <details> 内,跟着一起开合.
 *
 * DOM 桩与其它 ui 控制器测试共用一份(`test/domStub.ts`);KaTeX 用
 * render(tex, el) 写回 textContent 的假实现,断言只看结构与 LaTeX 文本,
 * 不看排版.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnalysisResult, SceneIR, SceneObject } from '../compiler/ir/types';
import { installDomStub, StubElement } from '../test/domStub';

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

beforeEach(() => {
    installDomStub();
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
    entityList: StubElement;
    analysisList: StubElement;
    integralList: StubElement;
    intersectionList: StubElement;
    controller: ObjectListController;
} {
    const entityList = new StubElement('div');
    const analysisList = new StubElement('div');
    const integralList = new StubElement('div');
    const intersectionList = new StubElement('div');
    const controller = new ObjectListController({
        entity: entityList as unknown as HTMLElement,
        analysis: analysisList as unknown as HTMLElement,
        integral: integralList as unknown as HTMLElement,
        intersection: intersectionList as unknown as HTMLElement,
    });
    return { entityList, analysisList, integralList, intersectionList, controller };
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

    it('元信息是纯文本块且在公式块之外;就绪后等式只由细节行承载', () => {
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

        // 就绪后等式只由细节行承载:公式块里只有一条 `.eval-detail-line`,
        // 不再额外挂一条内容相同的 `.eval-result is-ready`(重复行).
        expect(details.querySelectorAll<StubElement>('.eval-result')).toHaveLength(0);
        const equation = formulaBlock.querySelector<StubElement>('.eval-detail-line')!;
        expect(equation.textContent).toContain('=1.5');
        expect(equation.dataset.tex).toBeDefined();
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

    it('等式与元信息都在 <details> 内,且公式块里没有重复结果行', () => {
        const { integralList, controller } = createController();
        controller.renderScene(scene);
        controller.setIntegralResult('I', 2.775558e-17);

        const details = integralList.querySelector<StubElement>('.eval-details')!;
        const body = details.querySelector<StubElement>('.eval-detail-body')!;
        // 数值等式挂在细节行上;`.eval-result` 就绪态不该再出现一份.
        const equation = body.querySelector<StubElement>('.eval-detail-line')!;
        expect(equation.textContent).toContain('\\mathrm{d}x=');
        expect(equation.textContent).toContain('\\times10^{-17}');
        expect(equation.textContent).not.toContain('e-17');
        expect(body.querySelectorAll<StubElement>('.eval-result')).toHaveLength(0);
        // 折叠态可见的只有 summary 里的那一行公式.
        const summary = details.children[0] as StubElement;
        expect(summary.tagName).toBe('summary');
        expect(summary.querySelectorAll<StubElement>('.eval-detail-body')).toHaveLength(0);
    });
});

describe('列表缓存:内容不变就复用,顺序/展开态/数值都不串', () => {
    it('同一串公式出现两次仍有内容(模板必须 clone,不能搬运)', () => {
        const { entityList, controller } = createController();
        const first: SceneObject = { ...curve, id: 1, name: 'c1' };
        const second: SceneObject = { ...curve, id: 2, name: 'c2' };
        const twoCurves = {
            ...scene,
            objects: [first, second],
            objectFormulas: { 1: 'y=1', 2: 'y=1' },
        } as SceneIR;

        const expressions = (): Array<string | undefined> => entityList
            .querySelectorAll<StubElement>('.object-expr')
            .map((node) => node.textContent);

        // 搬运模板子节点会让第二条空白:缓存模板被第一条搬空了.
        controller.renderScene(twoCurves);
        expect(expressions()).toEqual(['y=1', 'y=1']);

        // 第二次 renderScene:内容变化触发重建,公式必须还能排版出来.
        controller.renderScene({
            ...twoCurves,
            objects: [{ ...first, enabled: false }, second],
        } as SceneIR);
        expect(expressions()).toEqual(['y=1', 'y=1']);
    });

    it('列表顺序跟随场景数组,部分条目重建也不跳位', () => {
        const { analysisList, controller } = createController();
        const first = { ...analysis, name: 'first' };
        const second = { ...analysis, name: 'second' };
        controller.renderScene({ ...scene, analyses: [first, second] } as SceneIR);

        // 只有 first 的内容变化 -> 行被替换;它必须还在 second 前面.
        controller.renderScene({
            ...scene,
            analyses: [{ ...first, scalar: 99 }, second],
        } as SceneIR);

        const names = analysisList
            .querySelectorAll<StubElement>('.object-name')
            .map((node) => node.textContent);
        expect(names).toEqual(['first', 'second']);
    });

    it('条目内容变化导致重建时,<details> 展开态保留', () => {
        const { analysisList, controller } = createController();
        controller.renderScene(scene);
        const before = analysisList.querySelector<StubElement>('details')!;
        before.open = true;

        controller.renderScene({
            ...scene,
            analyses: [{ ...analysis, scalar: 7 }],
        } as SceneIR);

        const after = analysisList.querySelector<StubElement>('details')!;
        expect(after).not.toBe(before);
        expect(after.open).toBe(true);
    });

    it('积分任务被改写后不沿用上一次的数值', () => {
        const { integralList, controller } = createController();
        controller.renderScene(scene);
        controller.setIntegralResult('I', 1.5);

        controller.renderScene({
            ...scene,
            integrals: [{ ...scene.integrals[0], range: [0, 1] as [number, number] }],
        } as SceneIR);

        expect(integralList.querySelector<StubElement>('.eval-result')!.textContent)
            .toBe('计算中...');
    });

    it('禁用的积分显示"已隐藏"而不是旧数值', () => {
        const { integralList, controller } = createController();
        controller.renderScene(scene);
        controller.setIntegralResult('I', 1.5);

        controller.renderScene({
            ...scene,
            integrals: [{ ...scene.integrals[0], enabled: false }],
        } as SceneIR);

        expect(integralList.querySelector<StubElement>('.eval-result')!.textContent)
            .toBe('已隐藏,不参与计算');
    });

    it('就绪的积分不再产生重复的 .eval-result is-ready', () => {
        const { integralList, controller } = createController();
        controller.renderScene(scene);
        controller.setIntegralResult('I', 1.5);

        const details = integralList.querySelector<StubElement>('.eval-details')!;
        // 公式块里只有一条等式,来自细节行.
        expect(details.querySelectorAll<StubElement>('.eval-detail-line')).toHaveLength(1);
        expect(details.querySelectorAll<StubElement>('.eval-result')).toHaveLength(0);
        expect(details.querySelector<StubElement>('.eval-detail-line')!.textContent)
            .toContain('=1.5');
    });

    it('数值出错时状态行重新挂回公式块,且清掉 data-tex', () => {
        const { integralList, controller } = createController();
        controller.renderScene(scene);
        controller.setIntegralResult('I', 1.5);
        // 就绪后状态行已被摘掉:错误路径必须自己把它建回来.
        expect(integralList.querySelector<StubElement>('.eval-result')).toBeNull();

        controller.setIntegralError('I', '计算失败');

        const result = integralList.querySelector<StubElement>('.eval-result')!;
        expect(result.className).toBe('eval-result is-error');
        expect(result.textContent).toBe('计算失败');
        expect(result.dataset.tex).toBeUndefined();
        // 等式退回不带右端的形态,错误文本与等式不再重复同一条公式.
        const equation = integralList.querySelector<StubElement>('.eval-detail-line')!;
        expect(equation.textContent).not.toContain('=1.5');
    });

    it('clear() 连同数值缓存一起清掉,同名任务重建不继承旧值', () => {
        const { integralList, controller } = createController();
        controller.renderScene(scene);
        controller.setIntegralResult('I', 1.5);

        controller.clear();
        controller.renderScene(scene);

        expect(integralList.querySelector<StubElement>('.eval-result')!.textContent)
            .toBe('计算中...');
    });

    it('求交结果同时报出交点与交线', () => {
        const { intersectionList, controller } = createController();
        controller.renderScene(scene);
        controller.setIntersectionResult('X', {
            points: [{ x: 0, y: 0, z: 0 }],
            curves: [[{ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }]],
        });

        expect(intersectionList.querySelector<StubElement>('.eval-result')!.textContent)
            .toBe('c1 ∩ c2 · 交点 1 个 · 交线 1 条');
    });

    it('列表容器与条目带列表语义', () => {
        const { analysisList, controller } = createController();
        controller.renderScene(scene);
        expect(analysisList.getAttribute('role')).toBe('list');
        expect(
            analysisList
                .querySelector<StubElement>('.evaluation-row')!
                .getAttribute('role'),
        ).toBe('listitem');
    });
});
