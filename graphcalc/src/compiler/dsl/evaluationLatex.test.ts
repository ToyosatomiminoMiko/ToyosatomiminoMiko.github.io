/**
 * 求值条目 LaTeX 拼装单测.
 *
 * 这里不测 DOM,只锁定"摘要行放什么,细节行放什么":
 * - 摘要必须自带关键量(折叠状态下列表仍然可读);
 * - 细节包含完整信息(P / 球坐标回显 / 逐分量结果 / 积分域与方法);
 * - 被积对象缺失时积分摘要返回 null,让 UI 明确回退纯文本而不是给半个公式.
 */
import { describe, expect, it, vi } from 'vitest';
import type {
    AnalysisResult,
    IntegralTask,
    SceneObject,
} from '../ir/types';

/**
 * 表达式 -> LaTeX 由 Rust 符号引擎负责(真机上是 wasm),展示层测试只需要
 * 一个恒等实现:本文件断言的是"拼装"顺序与内容,不是 Rust 的排版规则.
 */
vi.mock('../../wasm/math_rs/math_rs', () => ({
    latex_expression: vi.fn((expr: string) => expr),
    normalize_expression: vi.fn((expr: string) => expr),
}));

import {
    analysisLatexDetails,
    analysisLatexSummary,
    integralLatexDetails,
    integralLatexSummary,
    intersectionLatexDetails,
    intersectionLatexSummary,
} from './evaluationLatex';

function analysis(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
    return {
        name: 'g',
        op: 'gradient',
        point: [1, 2, 3],
        vector: [0.267261, 0.534522, 0.801784],
        tangent: null,
        scalar: 4,
        show: ['point', 'normal'],
        enabled: true,
        ...overrides,
    };
}

const curve: SceneObject = {
    kind: 'curve',
    id: 1,
    name: 'c',
    expr: 'x^2',
    coefficients: [],
    color: '#ffffff',
    enabled: true,
};

function integral(overrides: Partial<IntegralTask> = {}): IntegralTask {
    return {
        name: 'I',
        objectId: 1,
        sourceKind: 'curve',
        dim: 1,
        domainKind: 'interval',
        method: 'riemann:left',
        integrand: 'x^2',
        integrandCoefficients: [],
        countCoefficients: [],
        range: [-4, 4],
        segments: 32,
        layers: 8,
        show: true,
        enabled: true,
        ...overrides,
    };
}

describe('analysisLatexSummary', () => {
    it('折叠态即给出算子,作用点与结果', () => {
        expect(analysisLatexSummary(analysis())).toContain('\\nabla f');
        expect(analysisLatexSummary(analysis())).toContain('\\left(1,\\ 2,\\ 3\\right)');
    });

    it('散度/旋度用各自算子', () => {
        expect(analysisLatexSummary(analysis({ op: 'divergence', scalar: 0.5 })))
            .toContain('\\nabla\\cdot\\mathbf{F}');
        expect(analysisLatexSummary(analysis({ op: 'curl' })))
            .toContain('\\nabla\\times\\mathbf{F}');
    });
});

describe('analysisLatexDetails', () => {
    it('梯度细节包含点,场值,梯度与球坐标回显', () => {
        const lines = analysisLatexDetails(
            analysis({ pointSpherical: [3.741657, 0.640522, 1.107149] }),
        );
        expect(lines[0]).toBe('P=\\left(1,\\ 2,\\ 3\\right)');
        expect(lines[1]).toContain('\\left(r,\\theta,\\varphi\\right)');
        expect(lines.some((line) => line.includes('f\\left(P\\right)=4'))).toBe(true);
        expect(lines.some((line) => line.includes('\\nabla f\\left(P\\right)'))).toBe(true);
    });

    it('没有球坐标结果时不出球坐标行', () => {
        const lines = analysisLatexDetails(analysis());
        expect(lines.some((line) => line.includes('\\varphi'))).toBe(false);
    });

    it('切线只在有值时出', () => {
        const withTangent = analysisLatexDetails(analysis({ tangent: [1, 2, 0] }));
        expect(withTangent.some((line) => line.startsWith('\\mathbf{T}='))).toBe(true);
    });
});

describe('integralLatex', () => {
    it('摘要给出积分式并以等号结尾,等待数值拼接', () => {
        expect(integralLatexSummary(integral(), [curve]))
            .toBe('\\int_{-4}^{4} x^2 \\mathrm{d}x=');
    });

    it('找不到被积对象时返回 null', () => {
        expect(integralLatexSummary(integral({ objectId: 9 }), [curve])).toBeNull();
    });

    it('细节包含积分式,域,方法与分段分层', () => {
        const lines = integralLatexDetails(integral(), [curve], '黎曼和(左端点)');
        expect(lines[0]).toContain('\\int_{-4}^{4}');
        expect(lines[1]).toContain('域');
        expect(lines[1]).toContain('黎曼和(左端点)');
        expect(lines[2]).toContain('分段');
    });
});

describe('intersectionLatex', () => {
    const task = {
        name: 'X',
        aName: 'c1',
        bName: 's1',
        aId: 1,
        bId: 2,
        segments: 128,
    };

    it('摘要只给两个源对象(交点数量是异步结果)', () => {
        expect(intersectionLatexSummary(task)).toBe('c1\\cap s1');
    });

    it('细节给出对象 id 与采样分段', () => {
        const lines = intersectionLatexDetails(task);
        expect(lines[0]).toContain('\\#1');
        expect(lines[0]).toContain('\\#2');
        expect(lines[1]).toContain('128');
    });
});
