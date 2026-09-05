/**
 * DSL 解析结果的唯一 TypeScript schema.
 *
 * Rust `compiler_rs` 解析器直接按这份形状输出 JSON,不再维护镜像类型;
 * 修改 DSL 语句结构时以本文件为基准,并同步更新 `compiler_rs/src/miko.pest`.
 */
/**
 * 语句在源码中的字节区间,由 Rust pest 解析器免费产出并填入 JSON.
 *
 * 生产消费者:`compiler/errors.ts` 用它把语句级编译错误换算成
 * "第几行第几列"(应用层 CompileController 拼进错误文案).语句级编译
 * 循环用 `withStatementSpan` 包裹后,抛出的错误即携带该字段.
 * 测试手工构造 AST 时填 `{ start: 0, end: 0 }` 即可,断言只看错误文案.
 */
export interface SourceSpan {
    start: number;
    end: number;
}

/**
 * DSL 分析算子.
 *
 * `jacobian`/`laplacian` 由 pest 语法接受,编译器目前给出"暂未实现";
 * 修改这里时必须同步 `compiler_rs/src/miko.pest` 的 `analysis_op`.
 */
export type AnalysisOpKind =
    | 'gradient'
    | 'divergence'
    | 'curl'
    | 'jacobian'
    | 'laplacian';

/**
 * `analysis` 语句等号右侧的函数名.
 *
 * 每个算子有唯一规范函数名,AST 中保留它用于编译期校验,防止
 * `gradient g = curl(s1)` 这类写法被静默当成 gradient 处理.
 */
export type AnalysisCallName =
    | 'grad'
    | 'div'
    | 'curl'
    | 'jacobian'
    | 'laplacian';

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
    | 'frustum'
    | 'region';

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
    op: AnalysisOpKind;
    name: string;
    call: AnalysisCallName;
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
