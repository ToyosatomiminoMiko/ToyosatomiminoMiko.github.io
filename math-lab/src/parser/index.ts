import {
    mat4_apply_point as wasmMat4ApplyPoint,
    mat4_identity as wasmMat4Identity,
    mat4_multiply as wasmMat4Multiply,
    mat4_rotate as wasmMat4Rotate,
    mat4_scale as wasmMat4Scale,
    mat4_translate as wasmMat4Translate,
    parse_miko as wasmParseMiko,
} from '../wasm/ml_wasm';
import { ensureWasmReady } from '../wasmRuntime';
import type { AstProgram } from '../ast/types';
import { normalizeMatlabSyntax } from './matlabCompat';
import {
    createMatrixOps,
    type MatrixWasmBackend,
    type MatrixOps,
} from '../tensor/SceneTransform';

/**
 * parser 包对外暴露两个入口:
 * - parseMiko: 当前 DSL 主路径,先初始化 WASM,再调用 Rust pest parser.
 * - parseMatlab: 兼容层,先做 MATLAB 语法归一化,再走同一个 parseMiko.
 *
 * 目前 UI 只调用 parseMiko;parseMatlab 保留为公共 API,尚未接入口.
 */

function toMat4(values: Float64Array): number[][] {
    return [
        [values[0], values[1], values[2], values[3]],
        [values[4], values[5], values[6], values[7]],
        [values[8], values[9], values[10], values[11]],
        [values[12], values[13], values[14], values[15]],
    ];
}

function flattenMat4(matrix: number[][]): Float64Array {
    return new Float64Array(matrix.flat());
}

/** 创建基于 WASM 的矩阵运算后端,调用方需先 `ensureWasmReady`. */
export function createWasmMatrixOps(): MatrixOps {
    const backend: MatrixWasmBackend = {
        identity: () => toMat4(wasmMat4Identity()),
        translate: (values) => toMat4(wasmMat4Translate(values[0], values[1], values[2])),
        scale: (values) => toMat4(wasmMat4Scale(values[0], values[1], values[2])),
        rotate: (values) => toMat4(wasmMat4Rotate(values[0], values[1], values[2])),
        multiply: (a, b) => toMat4(wasmMat4Multiply(flattenMat4(a), flattenMat4(b))),
        apply: (matrix, point) => Array.from(
            wasmMat4ApplyPoint(flattenMat4(matrix), point[0], point[1], point[2]),
        ),
    };

    return createMatrixOps(backend);
}

/** 调用 Rust pest 解析器，把 `.miko` 源码解析成 JSON AST. */
export async function parseMiko(source: string): Promise<AstProgram> {
    await ensureWasmReady();
    return JSON.parse(wasmParseMiko(source)) as AstProgram;
}


/** MATLAB 兼容入口:先归一化 MATLAB 写法，再交给同一个 `.miko` 解析器. */
export async function parseMatlab(source: string): Promise<AstProgram> {
    return parseMiko(normalizeMatlabSyntax(source));
}
