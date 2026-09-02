/**
 * 数学张量运行时值.
 *
 * 这里只描述数学运算结果,与场景对象变换无关:
 * - 标量 rank 0
 * - 向量 rank 1
 * - 矩阵 rank 2
 *
 * 预留说明:目前只被 SceneTransform 的预留高层封装与对应测试引用;
 * 运行热路径使用 number[][]/MatrixOps.若删除预留封装,本类型同步删除.
 */
export type TensorValue =
    | { kind: 'scalar'; value: number }
    | { kind: 'vector'; values: number[] }
    | { kind: 'matrix'; rows: number; cols: number; values: number[][] };

export type VectorTensorValue = Extract<TensorValue, { kind: 'vector' }>;
export type MatrixTensorValue = Extract<TensorValue, { kind: 'matrix' }>;
