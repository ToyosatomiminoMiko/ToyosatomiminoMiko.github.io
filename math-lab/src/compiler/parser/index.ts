import {
    mat4_apply_point as wasmMat4ApplyPoint,
    mat4_identity as wasmMat4Identity,
    mat4_multiply as wasmMat4Multiply,
    mat4_rotate as wasmMat4Rotate,
    mat4_scale as wasmMat4Scale,
    mat4_translate as wasmMat4Translate,
} from '../../wasm/math_rs/math_rs';
import { parse_miko as wasmParseMiko } from '../../wasm/compiler_rs/compiler_rs';
import { ensureWasmReady } from '../../runtime/wasmRuntime';
import type { AstProgram } from '../ast/types';
import { normalizeMatlabSyntax } from './matlabCompat';
import {
    createMatrixOps,
    type MatrixWasmBackend,
    type MatrixOps,
} from '../../math/tensor/SceneTransform';
import {
    flattenMat4,
    mat4FromFlat,
    type Mat4,
} from '../../math/tensor/rowMajorMatrix';

/**
 * parser 包对外暴露两个入口:
 * - parseMiko: 当前 DSL 主路径,先初始化 WASM,再调用 Rust pest parser.
 * - parseMatlab: 兼容层,先做 MATLAB 语法归一化,再走同一个 parseMiko.
 *
 * 目前 UI 只调用 parseMiko;parseMatlab 保留为公共 API,尚未接入口.
 */

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

/** 调用 Rust pest 解析器,把 `.miko` 源码解析成 JSON AST. */
export async function parseMiko(source: string): Promise<AstProgram> {
    await ensureWasmReady();
    return JSON.parse(wasmParseMiko(source)) as AstProgram;
}


/** MATLAB 兼容入口:先归一化 MATLAB 写法,再交给同一个 `.miko` 解析器. */
export async function parseMatlab(source: string): Promise<AstProgram> {
    return parseMiko(normalizeMatlabSyntax(source));
}
