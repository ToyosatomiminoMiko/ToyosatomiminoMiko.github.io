import type { MathNode } from 'mathjs';
import type { TensorValue } from '../tensor/types';

export type DiffOpKind = 'gradient' | 'divergence' | 'curl' | 'jacobian' | 'laplacian';

export type AnalysisOverlay = 'point' | 'field' | 'vector' | 'tensor_glyph' | 'none';

/** 标量场表达式（rank 0 函数,如 f(x) 或 f(x, y)）. */
export interface ScalarFieldExpr {
    kind: 'scalar_field';
    raw: string;
    node: MathNode;
    variables: string[];
}

/** 向量场表达式（rank 1 函数,如 F(x, y, z) = [P, Q, R]）. */
export interface VectorFieldExpr {
    kind: 'vector_field';
    raw: string;
    components: [ScalarFieldExpr, ScalarFieldExpr, ScalarFieldExpr];
}

/**
 * 统一微分算子抽象.
 *
 * 渲染层根据 `result` 的 rank 选择可视化方式:
 * - rank 0:点\颜色\标量场
 * - rank 1:箭头\向量场
 * - rank 2:张量字形或矩阵显示
 */
export interface AnalysisExpr {
    kind: 'analysis';
    id: number;
    op: DiffOpKind;
    source: ScalarFieldExpr | VectorFieldExpr;
    at?: [number, number, number];
    result: TensorValue | null;
    overlay: AnalysisOverlay;
    enabled: boolean;
}
