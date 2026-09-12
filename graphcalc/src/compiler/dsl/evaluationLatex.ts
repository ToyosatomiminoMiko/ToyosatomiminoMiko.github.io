/**
 * 求值对象(分析/积分/求交)列表条目的 LaTeX 拼装.
 *
 * 与 latex.ts 的分工:latex.ts 负责**实体对象**(curve/surface/... 的方程)
 * 与积分式本体,本文件负责**求值条目**的两段展示--
 * - 摘要(summary):默认可见的一行,只放关键量(`∇f(P) = ...`);
 * - 细节(details):展开后才排版的完整推导/数值(`P=(...)`,球坐标回显,
 *   逐分量结果,方法的完整积分式...).
 *
 * 纯函数,只消费 IR,不碰 DOM:这样摘要/细节两套公式能单测,渲染层
 * (ui/ObjectListController)只负责把字符串交给 KaTeX.细节行按"一行一条"
 * 返回,列表里一行排不下时由 CSS 横向滚动承接(KaTeX 不换行,这是屏上
 * 唯一不破坏公式语义的溢出处理).
 */
import type { AnalysisResult, IntegralTask, SceneObject } from '../ir/types';
import { integralBodyLatex, latexNumberText } from './latex';

/** 一行公式片段(LaTeX 字符串). */
export type LatexLine = string;

/** 数值数组 -> LaTeX 行向量 `\left(1, 2, 3\right)`. */
function vectorLatex(values: readonly number[]): string {
    return `\\left(${values.map((value) => latexNumberText(value)).join(',\\ ')}\\right)`;
}

/**
 * 分析结果摘要:默认可见的一行.
 *
 * 只放"是什么算子 + 作用在哪个点 + 结果":完整定义与逐分量数值放细节,
 * 折叠态才能保持一行的信息密度.
 */
export function analysisLatexSummary(analysis: AnalysisResult): LatexLine {
    const point = vectorLatex(analysis.point);
    switch (analysis.op) {
        case 'gradient':
            return `\\nabla f\\left(${point}\\right)=${vectorLatex(analysis.vector)}`;
        case 'divergence':
            return `\\nabla\\cdot\\mathbf{F}\\left(${point}\\right)=${latexNumberText(analysis.scalar ?? NaN)}`;
        case 'curl':
            return `\\nabla\\times\\mathbf{F}\\left(${point}\\right)=${vectorLatex(analysis.vector)}`;
    }
}

/**
 * 分析结果细节:展开后逐行排版.
 *
 * 梯度额外回显:分析点(投影后的点)/场值/球坐标(r,θ,φ);球坐标只有隐式场与
 * 球体的分析才有值(见 IR 的 `pointSpherical` 注释),缺失时不出行.
 */
export function analysisLatexDetails(analysis: AnalysisResult): LatexLine[] {
    const lines: LatexLine[] = [`P=${vectorLatex(analysis.point)}`];

    // 球坐标回显:与 at spherical 共用同一份约定(见 math/CoordinateSystem.ts).
    if (analysis.pointSpherical) {
        lines.push(
            `\\left(r,\\theta,\\varphi\\right)=${vectorLatex(analysis.pointSpherical)}`,
        );
    }

    if (analysis.op === 'gradient') {
        if (analysis.scalar !== null) {
            lines.push(`f\\left(P\\right)=${latexNumberText(analysis.scalar)}`);
        }
        lines.push(`\\nabla f\\left(P\\right)=${vectorLatex(analysis.vector)}`);
        if (analysis.tangent) {
            lines.push(`\\mathbf{T}=${vectorLatex(analysis.tangent)}`);
        }
        return lines;
    }

    if (analysis.op === 'divergence') {
        lines.push(
            `\\left(\\nabla\\cdot\\mathbf{F}\\right)\\left(P\\right)=${latexNumberText(analysis.scalar ?? NaN)}`,
        );
        return lines;
    }

    lines.push(
        `\\left(\\nabla\\times\\mathbf{F}\\right)\\left(P\\right)=${vectorLatex(analysis.vector)}`,
    );
    return lines;
}

/**
 * 积分结果摘要:默认可见的一行.
 *
 * 数值由 integral worker 异步回填,编译期拿不到,所以摘要以 `=` 结尾,
 * 结果文本由 ObjectListController 追加在后面成为 `∬_D f dA = 数值`.
 * 找不到被积对象时返回 null,调用方回退到纯文本摘要.
 */
export function integralLatexSummary(
    task: IntegralTask,
    objects: SceneObject[],
): LatexLine | null {
    const body = integralBodyLatex(task, objects);
    return body === null ? null : `${body}=`;
}

/**
 * 积分结果细节:展开后逐行排版.
 *
 * 第一行是完整积分式(与实体列表的积分条目同源,见 integralBodyLatex),
 * 其后是域对象,方法,分段/分层等编译期元信息.
 */
export function integralLatexDetails(
    task: IntegralTask,
    objects: SceneObject[],
    methodLabel: string,
): LatexLine[] {
    const lines: LatexLine[] = [];
    const body = integralBodyLatex(task, objects);
    if (body !== null) {
        lines.push(body);
    }
    const source = objects.find((object) => object.id === task.objectId);
    lines.push(
        `\\text{域}: ${source ? source.name : `\\#${task.objectId}`}`
        + `\\quad \\text{方法}: ${methodLabel}`,
    );
    lines.push(
        `\\text{分段}: ${task.segments}\\quad \\text{分层}: ${task.layers}`,
    );
    return lines;
}

/**
 * 求交任务的最小形状.
 *
 * 直接收 `IntersectionTask` 会让本模块也依赖 `IntersectionOutput`(异步结果),
 * 而这里只用到任务本身的标识字段;用结构类型表述真实依赖,便于单测少造数据.
 */
export interface IntersectionTaskLike {
    name: string;
    aName: string;
    bName: string;
    aId: number;
    bId: number;
    segments: number;
}

/**
 * 求交结果摘要:默认可见的一行.
 *
 * 求交是异步任务,首次渲染时还没有交点/交线数量,所以摘要只给"谁与谁求交";
 * 数量摘要沿用既有纯文本(见 ObjectListController.intersectionSummary),
 * 细节行给出两个源对象,采样分段与输出形态.
 */
export function intersectionLatexSummary(task: IntersectionTaskLike): LatexLine {
    return `${task.aName}\\cap ${task.bName}`;
}

/** 求交细节行:对象,分辨率与输出形态. */
export function intersectionLatexDetails(task: IntersectionTaskLike): LatexLine[] {
    return [
        `A=${task.aName}\\ \\left(\\#${task.aId}\\right)`
        + `\\quad B=${task.bName}\\ \\left(\\#${task.bId}\\right)`,
        `\\text{采样分段}: ${task.segments}`,
    ];
}
