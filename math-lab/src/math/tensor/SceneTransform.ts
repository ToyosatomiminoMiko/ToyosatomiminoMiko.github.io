import type { MatrixTensorValue, VectorTensorValue } from './types';

export type TransformSource =
    | 'translate'
    | 'rotate'
    | 'scale'
    | 'compose'
    | 'matrix';

/**
 * 场景对象变换,统一以 4x4 矩阵存储.
 *
 * DSL 中的矩阵按行主序书写,`matrix` 同样保持行主序.
 * Three.js `Matrix4` 的列主序差异在渲染转换边界处理.
 */
export interface SceneTransform {
    kind: 'transform';
    matrix: number[][]; // 4x4
    source?: TransformSource;
}

type Mat4 = number[][];

/** 矩阵运算后端,可由 WASM 实现,也可由 JS fallback 实现. */
export interface MatrixWasmBackend {
    identity(): Mat4;
    translate(values: number[]): Mat4;
    scale(values: number[]): Mat4;
    rotate(values: number[]): Mat4;
    multiply(a: Mat4, b: Mat4): Mat4;
    apply(matrix: Mat4, point: number[]): number[];
}

/** 供编译/渲染层显式注入的矩阵运算接口,避免模块级可变全局状态. */
export interface MatrixOps {
    identity(): Mat4;
    translate(values: number[]): Mat4;
    scale(values: number[]): Mat4;
    rotate(values: number[]): Mat4;
    multiply(a: Mat4, b: Mat4): Mat4;
    apply(matrix: Mat4, point: number[]): number[];
}

function clone4x4(matrix: number[][]): number[][] {
    return matrix.map((row) => [...row]);
}

function assert4x4(matrix: number[][]): void {
    if (matrix.length !== 4 || matrix.some((row) => row.length !== 4)) {
        throw new TypeError('SceneTransform 需要 4x4 矩阵');
    }
}

function applyMatrix(matrix: number[][], point: number[]): number[] {
    assert4x4(matrix);
    if (point.length !== 3) {
        throw new TypeError('apply(matrix, point) 需要 3 分量向量');
    }

    const v = [point[0], point[1], point[2], 1];
    const out = [0, 0, 0, 0];
    for (let i = 0; i < 4; i += 1) {
        out[i] =
            matrix[i][0] * v[0] +
            matrix[i][1] * v[1] +
            matrix[i][2] * v[2] +
            matrix[i][3] * v[3];
    }
    return [out[0], out[1], out[2]];
}

/**
 * 数学 4x4 矩阵张量 -> SceneTransform.
 *
 * 对应 DSL 中的 `transform T = as_transform(M);`.
 */
export function asTransform(matrix: MatrixTensorValue): SceneTransform {
    if (matrix.rows !== 4 || matrix.cols !== 4) {
        throw new TypeError('asTransform 需要 4x4 矩阵张量');
    }

    return {
        kind: 'transform',
        matrix: clone4x4(matrix.values),
        source: 'matrix',
    };
}

/**
 * SceneTransform -> 4x4 矩阵张量.
 *
 * 对应 DSL 中的 `matrix M2 = matrix4(T);`.
 */
export function matrix4(transform: SceneTransform): MatrixTensorValue {
    return {
        kind: 'matrix',
        rows: 4,
        cols: 4,
        values: clone4x4(transform.matrix),
    };
}

/** 单位 4x4 矩阵. */
export function identity4(): Mat4 {
    return [
        [1, 0, 0, 0],
        [0, 1, 0, 0],
        [0, 0, 1, 0],
        [0, 0, 0, 1],
    ];
}

/** 平移矩阵. */
export function translate4(values: number[]): Mat4 {
    return [
        [1, 0, 0, values[0] ?? 0],
        [0, 1, 0, values[1] ?? 0],
        [0, 0, 1, values[2] ?? 0],
        [0, 0, 0, 1],
    ];
}

/** 缩放矩阵. */
export function scale4(values: number[]): Mat4 {
    return [
        [values[0] ?? 1, 0, 0, 0],
        [0, values[1] ?? 1, 0, 0],
        [0, 0, values[2] ?? 1, 0],
        [0, 0, 0, 1],
    ];
}

/** 旋转矩阵,顺序与旧实现一致: Rz * Ry * Rx. */
export function rotate4(values: number[]): Mat4 {
    const rx = values[0] ?? 0;
    const ry = values[1] ?? 0;
    const rz = values[2] ?? 0;
    const cx = Math.cos(rx);
    const sx = Math.sin(rx);
    const cy = Math.cos(ry);
    const sy = Math.sin(ry);
    const cz = Math.cos(rz);
    const sz = Math.sin(rz);

    const rxM: Mat4 = [
        [1, 0, 0, 0],
        [0, cx, -sx, 0],
        [0, sx, cx, 0],
        [0, 0, 0, 1],
    ];
    const ryM: Mat4 = [
        [cy, 0, sy, 0],
        [0, 1, 0, 0],
        [-sy, 0, cy, 0],
        [0, 0, 0, 1],
    ];
    const rzM: Mat4 = [
        [cz, -sz, 0, 0],
        [sz, cz, 0, 0],
        [0, 0, 1, 0],
        [0, 0, 0, 1],
    ];

    return multiply4x4(multiply4x4(rzM, ryM), rxM);
}

/** 两个 4x4 矩阵相乘,结果仍为行主序 4x4. */
export function multiply4x4(a: number[][], b: number[][]): number[][] {
    assert4x4(a);
    assert4x4(b);

    const out: number[][] = Array.from({ length: 4 }, () => [0, 0, 0, 0]);
    for (let i = 0; i < 4; i += 1) {
        for (let j = 0; j < 4; j += 1) {
            let sum = 0;
            for (let k = 0; k < 4; k += 1) {
                sum += a[i][k] * b[k][j];
            }
            out[i][j] = sum;
        }
    }
    return out;
}

/**
 * 组合两个场景变换.
 *
 * `compose(a, b)` 表示先应用 `b`,再应用 `a`,即 `a * b`.
 */
export function compose(a: SceneTransform, b: SceneTransform): SceneTransform {
    return {
        kind: 'transform',
        matrix: multiply4x4(a.matrix, b.matrix),
        source: 'compose',
    };
}

/**
 * 将 SceneTransform 作用于 3D 点/向量.
 *
 * 输入为 3 分量向量时视为齐次坐标 [x, y, z, 1],
 * 返回应用变换后的 3 分量向量.
 */
export function apply(transform: SceneTransform, point: VectorTensorValue): VectorTensorValue {
    return {
        kind: 'vector',
        values: applyMatrix(transform.matrix, point.values),
    };
}

/** 纯 JS 矩阵运算实现,作为默认后端. */
export const jsMatrixOps: MatrixOps = {
    identity: () => identity4(),
    translate: (values) => translate4(values),
    scale: (values) => scale4(values),
    rotate: (values) => rotate4(values),
    multiply: (a, b) => multiply4x4(a, b),
    apply: (matrix, point) => applyMatrix(matrix, point),
};

/** 根据后端创建矩阵运算对象;未提供后端时使用 JS fallback. */
export function createMatrixOps(backend?: MatrixWasmBackend): MatrixOps {
    if (!backend) return jsMatrixOps;

    return {
        identity: () => backend.identity(),
        translate: (values) => backend.translate(values),
        scale: (values) => backend.scale(values),
        rotate: (values) => backend.rotate(values),
        multiply: (a, b) => backend.multiply(a, b),
        apply: (matrix, point) => backend.apply(matrix, point),
    };
}
