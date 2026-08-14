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

export interface MatrixWasmBackend {
    identity(): Mat4;
    translate(values: number[]): Mat4;
    scale(values: number[]): Mat4;
    rotate(values: number[]): Mat4;
    multiply(a: Mat4, b: Mat4): Mat4;
    apply(matrix: Mat4, point: number[]): number[];
}

let matrixBackend: MatrixWasmBackend | null = null;

export function registerMatrixWasmBackend(backend: MatrixWasmBackend): void {
    matrixBackend = backend;
}

function clone4x4(matrix: number[][]): number[][] {
    return matrix.map((row) => [...row]);
}

function assert4x4(matrix: number[][]): void {
    if (matrix.length !== 4 || matrix.some((row) => row.length !== 4)) {
        throw new TypeError('SceneTransform 需要 4x4 矩阵');
    }
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

/** 单位 4x4 矩阵。 */
export function identity4(): Mat4 {
    return matrixBackend?.identity() ?? [
        [1, 0, 0, 0],
        [0, 1, 0, 0],
        [0, 0, 1, 0],
        [0, 0, 0, 1],
    ];
}

/** 平移矩阵。 */
export function translate4(values: number[]): Mat4 {
    return matrixBackend?.translate(values) ?? [
        [1, 0, 0, values[0] ?? 0],
        [0, 1, 0, values[1] ?? 0],
        [0, 0, 1, values[2] ?? 0],
        [0, 0, 0, 1],
    ];
}

/** 缩放矩阵。 */
export function scale4(values: number[]): Mat4 {
    return matrixBackend?.scale(values) ?? [
        [values[0] ?? 1, 0, 0, 0],
        [0, values[1] ?? 1, 0, 0],
        [0, 0, values[2] ?? 1, 0],
        [0, 0, 0, 1],
    ];
}

/** 旋转矩阵,顺序与旧实现一致: Rz * Ry * Rx。 */
export function rotate4(values: number[]): Mat4 {
    if (matrixBackend) return matrixBackend.rotate(values);

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
    if (matrixBackend) return matrixBackend.multiply(a, b);

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
    assert4x4(transform.matrix);

    const values = point.values;
    if (values.length !== 3) {
        throw new TypeError('apply(transform, point) 需要 3 分量向量');
    }

    if (matrixBackend) {
        const out = matrixBackend.apply(transform.matrix, values);
        return { kind: 'vector', values: [out[0], out[1], out[2]] };
    }

    const v = [values[0], values[1], values[2], 1];
    const out = [0, 0, 0, 0];
    for (let i = 0; i < 4; i += 1) {
        out[i] =
            transform.matrix[i][0] * v[0] +
            transform.matrix[i][1] * v[1] +
            transform.matrix[i][2] * v[2] +
            transform.matrix[i][3] * v[3];
    }

    return { kind: 'vector', values: [out[0], out[1], out[2]] };
}
