/**
 * WASM 矩阵运算后端.
 *
 * 与 DSL 解析无关,独立成模块,避免 `parser` 包同时承担解析与矩阵后端职责.
 */
import {
    mat4_apply_point as wasmMat4ApplyPoint,
    mat4_identity as wasmMat4Identity,
    mat4_multiply as wasmMat4Multiply,
    mat4_rotate as wasmMat4Rotate,
    mat4_scale as wasmMat4Scale,
    mat4_translate as wasmMat4Translate,
} from '../wasm/math_rs/math_rs';
import {
    createMatrixOps,
    type MatrixWasmBackend,
    type MatrixOps,
} from '../math/tensor/SceneTransform';
import {
    flattenMat4,
    mat4FromFlat,
    type Mat4,
} from '../math/tensor/rowMajorMatrix';

function toMat4(values: Float64Array): Mat4 {
    const matrix = mat4FromFlat(Array.from(values));
    if (!matrix) {
        throw new TypeError('WASM 矩阵后端返回了非法矩阵');
    }
    return matrix;
}

function flattenMat4ToWasm(matrix: Mat4): Float64Array {
    return new Float64Array(flattenMat4(matrix));
}

/** 创建基于 WASM 的矩阵运算后端,调用方需先 `ensureWasmReady`. */
export function createWasmMatrixOps(): MatrixOps {
    const backend: MatrixWasmBackend = {
        identity: () => toMat4(wasmMat4Identity()),
        translate: (values) => toMat4(wasmMat4Translate(values[0], values[1], values[2])),
        scale: (values) => toMat4(wasmMat4Scale(values[0], values[1], values[2])),
        rotate: (values) => toMat4(wasmMat4Rotate(values[0], values[1], values[2])),
        multiply: (a, b) => toMat4(
            wasmMat4Multiply(flattenMat4ToWasm(a), flattenMat4ToWasm(b)),
        ),
        apply: (matrix, point) => Array.from(
            wasmMat4ApplyPoint(
                flattenMat4ToWasm(matrix),
                point[0],
                point[1],
                point[2],
            ),
        ),
    };

    return createMatrixOps(backend);
}
