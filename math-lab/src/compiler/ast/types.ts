import type { DiffOpKind } from '../../math/diffops/types';

export interface SourceSpan {
    start: number;
    end: number;
}

export interface OptionPair {
    name: string;
    value: string;
}

export interface ParamStatement {
    type: 'param';
    name: string;
    value: string;
    ui: { min: string; max: string; step: string } | null;
    span: SourceSpan;
}

export type TensorKind = 'scalar' | 'vector' | 'matrix' | 'transform';

export interface TensorStatement {
    type: 'tensor';
    kind: TensorKind;
    name: string;
    expr: string;
    span: SourceSpan;
}

export type ObjectKind =
    | 'curve'
    | 'surface'
    | 'vector_field'
    | 'point'
    | 'vector'
    | 'sphere'
    | 'box'
    | 'cylinder'
    | 'cone'
    | 'frustum';

export interface ObjectStatement {
    type: 'object';
    kind: ObjectKind;
    name: string;
    expr: string;
    options: OptionPair[];
    span: SourceSpan;
}

export interface AnalysisStatement {
    type: 'analysis';
    op: DiffOpKind;
    name: string;
    call: string;
    source: string;
    at: string[] | null;
    options: OptionPair[];
    span: SourceSpan;
}

export interface IntegralStatement {
    type: 'integral';
    name: string;
    source: string;
    options: OptionPair[];
    span: SourceSpan;
}

export type AstStatement =
    | ParamStatement
    | TensorStatement
    | ObjectStatement
    | AnalysisStatement
    | IntegralStatement;

export interface AstProgram {
    statements: AstStatement[];
}
