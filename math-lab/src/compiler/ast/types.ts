/**
 * DSL 解析结果的唯一 TypeScript schema.
 *
 * Rust `compiler_rs` 解析器直接按这份形状输出 JSON,不再维护镜像类型;
 * 修改 DSL 语句结构时以本文件为基准,并同步更新 `compiler_rs/src/miko.pest`.
 */
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
    /** 没有 `in [min, max, step]` 时 Rust 解析器会省略该字段. */
    ui?: { min: string; max: string; step: string };
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

export interface AnimationStatement {
    type: 'animation';
    name: string;
    expr: string;
    options: OptionPair[];
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
    /** 没有 `at [...]` 时 Rust 解析器会省略该字段. */
    at?: string[];
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

export interface IntersectionStatement {
    type: 'intersection';
    name: string;
    a: string;
    b: string;
    options: OptionPair[];
    span: SourceSpan;
}

export type AstStatement =
    | ParamStatement
    | TensorStatement
    | AnimationStatement
    | ObjectStatement
    | AnalysisStatement
    | IntegralStatement
    | IntersectionStatement;

export interface AstProgram {
    statements: AstStatement[];
}
