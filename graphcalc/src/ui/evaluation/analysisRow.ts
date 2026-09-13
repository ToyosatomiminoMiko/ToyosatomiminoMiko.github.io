/**
 * 分析条目的 HTML 结构(类型专属定义).
 *
 * 结构特征:**没有独立结果行,也没有纯文本元信息**--所有内容都是数学,
 * 全部按公式行进 `.eval-detail-body`:符号定义 / ∇f(P) / P / 球坐标回显 /
 * f(P) / 切线 T.折叠态只留一行"算子在哪个点".
 *
 * 数值在编译期就算好了(`AnalysisResult` 自带 `scalar`/`vector`),
 * 所以这一类没有 `resolve`/`reject`:渲染即最终态.
 */
import type { AnalysisResult } from '../../compiler/ir/types';
import {
    analysisLatexDetails,
    analysisLatexSummary,
} from '../../compiler/dsl/evaluationLatex';
import {
    createDetailSections,
    createEvaluationRow,
    createEvaluationSummary,
} from './rowDom';
import type { EvaluationKindSpec, EvaluationRowHandles } from './rowTypes';

/** 分析条目的彩色类型标签文案(算子维度). */
const ANALYSIS_KIND_LABELS: Record<AnalysisResult['op'], string> = {
    gradient: '梯度',
    divergence: '散度',
    curl: '旋度',
};

/**
 * 分析条目 key:直接取**会被渲染的公式/文本**.
 *
 * 不再罗列 IR 字段:以前靠手工维护字段清单,漏掉过 `symbolic`(细节第一行)
 * 导致源表达式变了细节不刷新,又把只影响三维叠加层的 `show` 算了进来.
 * 键跟着渲染内容走,从根上避免"键漏字段".`enabled` 决定细节是否生成,
 * 必须进键.
 */
export const analysisRowSpec: EvaluationKindSpec<
    AnalysisResult,
    void,
    EvaluationRowHandles
> = {
    kind: 'analysis',
    name: (analysis) => analysis.name,
    cacheKey: (analysis) => JSON.stringify([
        analysisLatexSummary(analysis),
        analysis.enabled,
        analysis.enabled ? analysisLatexDetails(analysis) : null,
    ]),
    build(analysis) {
        // 折叠态:彩色算子标签 + 变量名 + 一行 KaTeX 公式(摘要公式不可复制).
        const summary = createEvaluationSummary(
            {
                badgeClass: `kind-analysis kind-analysis-${analysis.op}`,
                badgeLabel: ANALYSIS_KIND_LABELS[analysis.op],
                latex: analysisLatexSummary(analysis),
            },
            analysis.name,
        );

        // 展开细节里先给算子的符号展开,再给该点的数值结果;隐藏项不生成
        // 细节(数值在编译期被跳过,只有占位).
        const detail = analysis.enabled
            ? createDetailSections(analysisLatexDetails(analysis))
            : null;

        const row = createEvaluationRow(summary, detail, null);
        row.classList.toggle('is-hidden', !analysis.enabled);
        return { row, result: null };
    },
};
