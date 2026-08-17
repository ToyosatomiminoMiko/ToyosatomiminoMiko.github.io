/**
 * 通用表达式求值与 mathjs -> Rust 表达式转换.
 * 从 DslCompiler 拆出,供分析编译、对象物化和变换解析复用.
 */
import * as math from 'mathjs';
import type { MathNode } from 'mathjs';
import { evaluate_scalar as wasmEvaluateScalar } from '../../wasm/math_rs/math_rs';

/**
 * Rust/evalexpr 数值后端明确支持的函数集合.
 *
 * mathjs 可以解析的函数比这里多，但“能解析”不等于“能被 WASM 数值求值”。
 * 不支持的函数必须在编译期报错，不能留到运行时变成 null 或 fallback。
 */
const RUST_NUMERIC_FUNCTIONS = new Set([
    'sin',
    'cos',
    'tan',
    'asin',
    'acos',
    'atan',
    'sinh',
    'cosh',
    'tanh',
    'exp',
    'ln',
    'log10',
    'log2',
    'sqrt',
    'abs',
]);

type FunctionNodeLike = {
    type: 'FunctionNode';
    fn?: { name?: string };
    args: MathNode[];
};

function asFunctionNode(node: MathNode): FunctionNodeLike | null {
    return node.type === 'FunctionNode'
        ? (node as unknown as FunctionNodeLike)
        : null;
}

/**
 * 把 mathjs 常见写法改写成 evalexpr 能执行的形式.
 *
 * 这里只做确定性的等价改写：
 *   log(x)     -> ln(x)
 *   pow(a, b)  -> a ^ b
 *   sec(x)     -> 1 / cos(x)
 *   csc(x)     -> 1 / sin(x)
 *   cot(x)     -> cos(x) / sin(x)
 */
function rewriteMathFunctions(node: MathNode): MathNode {
    return node.transform((current) => {
        const fnNode = asFunctionNode(current);
        if (!fnNode) return current;

        const name = fnNode.fn?.name;
        switch (name) {
            case 'log':
                if (fnNode.args.length !== 1) {
                    throw new Error('Rust 数值后端只支持单参数的自然对数 log(x)');
                }
                return new math.FunctionNode(new math.SymbolNode('ln'), fnNode.args);

            case 'pow':
                if (fnNode.args.length !== 2) {
                    throw new Error('Rust 数值后端只支持双参数的 pow(a, b)');
                }
                return new math.OperatorNode('^', 'pow', fnNode.args);

            case 'sec':
                if (fnNode.args.length !== 1) {
                    throw new Error('sec 只接受一个参数');
                }
                return new math.OperatorNode('/', 'divide', [
                    new math.ConstantNode(1),
                    new math.FunctionNode(new math.SymbolNode('cos'), fnNode.args),
                ]);

            case 'csc':
                if (fnNode.args.length !== 1) {
                    throw new Error('csc 只接受一个参数');
                }
                return new math.OperatorNode('/', 'divide', [
                    new math.ConstantNode(1),
                    new math.FunctionNode(new math.SymbolNode('sin'), fnNode.args),
                ]);

            case 'cot':
                if (fnNode.args.length !== 1) {
                    throw new Error('cot 只接受一个参数');
                }
                return new math.OperatorNode('/', 'divide', [
                    new math.FunctionNode(new math.SymbolNode('cos'), fnNode.args),
                    new math.FunctionNode(new math.SymbolNode('sin'), fnNode.args),
                ]);

            default:
                return current;
        }
    });
}

/** 检查改写后的节点是否只包含 Rust 数值后端支持的函数。 */
export function assertRustNumericNodeSupported(node: MathNode): void {
    node.traverse((current) => {
        const fnNode = asFunctionNode(current);
        if (!fnNode) return;

        const name = fnNode.fn?.name ?? '<anonymous>';
        if (!RUST_NUMERIC_FUNCTIONS.has(name)) {
            throw new Error(`表达式暂不支持函数 ${name}，无法交给 Rust/WASM 数值求值`);
        }
    });
}

function evaluateRustScalar(
    expr: string,
    scope?: Record<string, number>,
): number | null {
    const names = scope ? Object.keys(scope) : [];
    const values = new Float64Array(names.map((name) => scope![name]));
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

export function evaluateNumber(raw: string, scope?: Record<string, number>): number | null {
    return evaluateRustScalar(toRustExpression(math.parse(raw)), scope);
}

export function evaluateMathNode(node: MathNode): number | null {
    return evaluateRustScalar(toRustExpression(node));
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

function derivativeExpression(node: MathNode, variable: string): string {
    return toRustExpression(math.derivative(node, variable));
}

const rustExpressionCache = new WeakMap<MathNode, string>();
const derivativeExpressionCache = new WeakMap<MathNode, Map<string, string>>();

export function cachedRustExpression(node: MathNode): string {
    let cached = rustExpressionCache.get(node);
    if (!cached) {
        cached = toRustExpression(node);
        rustExpressionCache.set(node, cached);
    }
    return cached;
}

export function cachedDerivativeExpression(node: MathNode, variable: string): string {
    let byVariable = derivativeExpressionCache.get(node);
    if (!byVariable) {
        byVariable = new Map<string, string>();
        derivativeExpressionCache.set(node, byVariable);
    }

    let cached = byVariable.get(variable);
    if (!cached) {
        cached = derivativeExpression(node, variable);
        byVariable.set(variable, cached);
    }
    return cached;
}

/** 把 mathjs 节点转成 evalexpr 可解析的字符串,并显式替换 pi / e 常量. */
export function toRustExpression(node: MathNode): string {
    const rewritten = rewriteMathFunctions(node);
    assertRustNumericNodeSupported(rewritten);

    const replaced = rewritten.transform((current) => {
        if (current.type === 'SymbolNode') {
            const symbol = current as unknown as { name: string };
            if (symbol.name === 'pi') return new math.ConstantNode(Math.PI);
            if (symbol.name === 'e') return new math.ConstantNode(Math.E);
        }
        return current;
    });
    return replaced.toString();
}
