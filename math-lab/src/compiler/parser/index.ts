import { parse_miko as wasmParseMiko } from '../../wasm/compiler_rs/compiler_rs';
import { ensureWasmReady } from '../../runtime/wasmRuntime';
import type { AstProgram } from '../ast/types';
import { normalizeMatlabSyntax } from './matlabCompat';

/**
 * parser 包对外暴露两个入口:
 * - parseMiko: 当前 DSL 主路径,先初始化 WASM,再调用 Rust pest parser.
 * - parseMatlab: 兼容层,先做 MATLAB 语法归一化,再走同一个 parseMiko.
 *
 * 目前 UI 只调用 parseMiko;parseMatlab 保留为公共 API,尚未接入口.
 * WASM 矩阵后端见 `compiler/matrixOps.ts`,不在这里混入解析入口.
 */

/** 调用 Rust pest 解析器,把 `.miko` 源码解析成 JSON AST. */
export async function parseMiko(source: string): Promise<AstProgram> {
    await ensureWasmReady();
    return JSON.parse(wasmParseMiko(source)) as AstProgram;
}


/** MATLAB 兼容入口:先归一化 MATLAB 写法,再交给同一个 `.miko` 解析器. */
export async function parseMatlab(source: string): Promise<AstProgram> {
    return parseMiko(normalizeMatlabSyntax(source));
}
