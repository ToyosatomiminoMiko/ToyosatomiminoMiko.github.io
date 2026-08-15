/**
 * 数学张量运行时值.
 *
 * 这里只描述数学运算结果,与场景对象变换无关:
 * - 标量 rank 0
 * - 向量 rank 1
 * - 矩阵 rank 2
 */
export type TensorValue =
    | { kind: 'scalar'; value: number }
    | { kind: 'vector'; values: number[] }
    | { kind: 'matrix'; rows: number; cols: number; values: number[][] };

export type VectorTensorValue = Extract<TensorValue, { kind: 'vector' }>;
export type MatrixTensorValue = Extract<TensorValue, { kind: 'matrix' }>;
