/**
 * 表达式解析/归一化/求值/符号求导与数组解析的统一入口.
 *
 * 这里的解析和符号运算全部由 Rust/WASM 完成,TypeScript 只负责缓存和
 * 组合调用,不再依赖外部 JavaScript 数学库.
 */
import {
    evaluate_scalar as wasmEvaluateScalar,
    matrix4_from_expr as wasmMatrix4FromExpr,
    normalize_expression as wasmNormalizeExpression,
    parse_array_strings as wasmParseArrayStrings,
    symbolic_derivative as wasmSymbolicDerivative,
    symbolic_variables as wasmSymbolicVariables,
} from '../../wasm/math_rs/math_rs';

export type ExpressionArray = string | ExpressionArray[];

function throwExpressionError(raw: string, error: unknown): never {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`表达式无法处理: ${raw} (${message})`);
}

/** 把常见数学表达式归一化为 evalexpr/Rust 数值后端可执行的形式. */
export function normalizeExpression(raw: string): string {
    try {
        return wasmNormalizeExpression(raw);
    } catch (error) {
        throwExpressionError(raw, error);
    }
}

function evaluateRustScalar(
    expr: string,
    scope: Record<string, number>,
): number | null {
    const names = Object.keys(scope);
    const values = new Float64Array(names.map((name) => scope[name]));
    try {
        const value = wasmEvaluateScalar(
            expr,
            names,
            values,
            Number.NaN,
            Number.NaN,
            Number.NaN,
        );
        return typeof value === 'number' && Number.isFinite(value) ? value : null;
    } catch {
        return null;
    }
}

export function evaluateScalar(
    expr: string,
    scope: Record<string, number> = {},
): number | null {
    return evaluateRustScalar(expr, scope);
}

/**
 * 带坐标参数的标量求值.
 *
 * `scope` 只允许放自由系数,不能包含 x/y/z——Rust 求值后端会用
 * 传入的坐标参数覆盖同名的 scope 键.曲线/曲面采样点逐点求值应走这里.
 */
export function evaluateScalarAt(
    expr: string,
    scope: Record<string, number> = {},
    x = Number.NaN,
    y = Number.NaN,
    z = Number.NaN,
): number | null {
    const names = Object.keys(scope);
    const values = new Float64Array(names.map((name) => scope[name]));
    try {
        const value = wasmEvaluateScalar(expr, names, values, x, y, z);
        return typeof value === 'number' && Number.isFinite(value) ? value : null;
    } catch {
        return null;
    }
}

export function evaluateNumber(
    raw: string,
    scope?: Record<string, number>,
): number | null {
    return evaluateRustScalar(normalizeExpression(raw), scope ?? {});
}

export function evaluateRequiredNumber(
    raw: string,
    scope: Record<string, number>,
    context: string,
): number {
    const value = evaluateNumber(raw, scope);
    if (value === null) {
        throw new Error(`${context} 无法求值: ${raw}`);
    }
    return value;
}

export function symbolicDerivative(expr: string, variable: string): string {
    try {
        return wasmSymbolicDerivative(expr, variable);
    } catch (error) {
        throwExpressionError(`d(${expr})/d(${variable})`, error);
    }
}

export function extractSymbolNames(
    expr: string,
    excludedVariables: ReadonlySet<string> = new Set(),
): string[] {
    try {
        return Array.from(wasmSymbolicVariables(expr, [...excludedVariables]));
    } catch (error) {
        throwExpressionError(expr, error);
    }
}

export function parseArrayStrings(raw: string): ExpressionArray {
    try {
        return JSON.parse(wasmParseArrayStrings(raw)) as ExpressionArray;
    } catch (error) {
        throwExpressionError(raw, error);
    }
}

export function evaluateMatrixExpr(raw: string): number[] {
    try {
        return Array.from(wasmMatrix4FromExpr(raw));
    } catch (error) {
        throwExpressionError(raw, error);
    }
}

/**
 * @cache
 * 缓存目的:避免对同一字符串反复调用 Rust/WASM normalize_expression.
 * 键/失效策略:原表达式字符串 -> 归一化表达式;无失效机制,表达式集合通常有限.
 * 生命周期:模块级,跟随页面存活.
 */
const rustExpressionCache = new Map<string, string>();

/**
 * @cache
 * 缓存目的:缓存符号求导结果,避免参数刷新时重复计算偏导数.
 * 键/失效策略:原表达式 -> (变量 -> 导数表达式);无失效机制.
 * 生命周期:模块级,跟随页面存活.
 */
const derivativeExpressionCache = new Map<string, Map<string, string>>();

/**
 * @cache-access
 * 返回归一化后的 Rust 表达式,命中缓存时直接返回.
 */
export function cachedRustExpression(expr: string): string {
    let cached = rustExpressionCache.get(expr);
    if (!cached) {
        cached = normalizeExpression(expr);
        rustExpressionCache.set(expr, cached);
    }
    return cached;
}

/**
 * @cache-access
 * 返回表达式对指定变量的符号导数,命中缓存时直接返回.
 */
export function cachedDerivativeExpression(expr: string, variable: string): string {
    let byVariable = derivativeExpressionCache.get(expr);
    if (!byVariable) {
        byVariable = new Map<string, string>();
        derivativeExpressionCache.set(expr, byVariable);
    }

    let cached = byVariable.get(variable);
    if (!cached) {
        cached = symbolicDerivative(expr, variable);
        byVariable.set(variable, cached);
    }
    return cached;
}

/** 兼容旧的函数名;新代码应直接使用 normalizeExpression. */
export function toRustExpression(raw: string): string {
    return normalizeExpression(raw);
}
