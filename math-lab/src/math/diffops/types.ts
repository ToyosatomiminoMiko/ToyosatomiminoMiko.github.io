/**
 * 微分算子类型.
 *
 * 分析结果本身已由 `ir/types.ts` 的 `AnalysisResult` 描述;
 * 这里只保留 AST 阶段需要的算子标识.
 */
export type DiffOpKind = 'gradient' | 'divergence' | 'curl' | 'jacobian' | 'laplacian';
