import type { MathNode } from 'mathjs';

/**
 * 数学张量的运行时值.
 *
 * 这里只描述数学运算结果,与场景变换无关:
 * - 标量 rank 0
 * - 向量 rank 1
 * - 矩阵 rank 2
 */
export type TensorValue =
    | { kind: 'scalar'; value: number }
    | { kind: 'vector'; values: number[] }
    | { kind: 'matrix'; rows: number; cols: number; values: number[][] };

/** 张量形状（编译期推断结果）. */
export type TensorShape =
    | { kind: 'scalar' }
    | { kind: 'vector'; length: number }
    | { kind: 'matrix'; rows: number; cols: number };

/**
 * 数学张量表达式.
 *
 * `Tensor` 只负责数学运算；场景对象变换使用 `SceneTransform`,
 * 两者不隐式转换.
 */
export interface TensorExpr {
    raw: string;
    node: MathNode;
    shape: TensorShape;
}

export type ScalarTensorValue = Extract<TensorValue, { kind: 'scalar' }>;
export type VectorTensorValue = Extract<TensorValue, { kind: 'vector' }>;
export type MatrixTensorValue = Extract<TensorValue, { kind: 'matrix' }>;
