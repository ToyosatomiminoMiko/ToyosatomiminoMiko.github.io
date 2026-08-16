/**
 * 通用表达式求值与 mathjs -> Rust 表达式转换。
 * 从 DslCompiler 拆出，供分析编译、对象物化和变换解析复用。
 */
import * as math from 'mathjs';
import type { MathNode } from 'mathjs';

export function evaluateNumber(raw: string, scope?: Record<string, number>): number | null {
    try {
        const value = scope === undefined ? math.evaluate(raw) : math.evaluate(raw, scope);
        return typeof value === 'number' && Number.isFinite(value) ? value : null;
    } catch {
        return null;
    }
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

/** 把 mathjs 节点转成 evalexpr 可解析的字符串，并显式替换 pi / e 常量。 */
export function toRustExpression(node: MathNode): string {
    const replaced = node.transform((current) => {
        if (current.type === 'SymbolNode') {
            const symbol = current as unknown as { name: string };
            if (symbol.name === 'pi') return new math.ConstantNode(Math.PI);
            if (symbol.name === 'e') return new math.ConstantNode(Math.E);
        }
        return current;
    });
    return replaced.toString();
}
