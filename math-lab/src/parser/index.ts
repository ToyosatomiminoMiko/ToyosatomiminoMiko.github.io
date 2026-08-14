import init, { parse_miko as wasmParseMiko } from '../wasm/ml_wasm';
import type { AstProgram } from '../ast/types';
import { normalizeMatlabSyntax } from './matlabCompat';

let wasmReady: Promise<unknown> | null = null;

function ensureInit(): Promise<unknown> {
    if (!wasmReady) {
        wasmReady = init();
    }
    return wasmReady;
}

/** 调用 Rust pest 解析器，把 `.miko` 源码解析成 JSON AST. */
export async function parseMiko(source: string): Promise<AstProgram> {
    await ensureInit();
    return JSON.parse(wasmParseMiko(source)) as AstProgram;
}


/** MATLAB 兼容入口:先归一化 MATLAB 写法，再交给同一个 `.miko` 解析器. */
export async function parseMatlab(source: string): Promise<AstProgram> {
    return parseMiko(normalizeMatlabSyntax(source));
}
