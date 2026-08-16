import * as math from 'mathjs';
import type { MathNode } from 'mathjs';
import type { Coefficient } from '../../compiler/ir/types';
import { NUMERIC_CONFIG } from '../../config/numericConfig';

// ============================================================
// 内置变量与函数名黑名单 —— 系数提取时排除
// ============================================================
const BUILTIN_SYMBOLS = new Set([
    'sin', 'cos', 'tan', 'exp', 'log', 'log10', 'sqrt', 'abs',
    'asin', 'acos', 'atan', 'sinh', 'cosh', 'tanh',
    'floor', 'ceil', 'round', 'sign', 'pow', 'max', 'min',
    'pi', 'PI', 'e', 'E', 'i', 'Infinity', 'NaN',
    'true', 'false', 'null',
]);

/**
 * 从 mathjs 表达式树提取自由参数,排除指定的变量名列表
 * @param node      表达式树
 * @param varNames  应排除的变量名(如 ['x'] 或 ['x','y'])
 */
export function extractCoefficients(
    node: MathNode,
    varNames: Set<string>,
): Coefficient[] {
    const coeffSet = new Set<string>();

    node.traverse((n: MathNode) => {
        if (n instanceof math.SymbolNode) {
            if (!varNames.has(n.name) && !BUILTIN_SYMBOLS.has(n.name)) {
                coeffSet.add(n.name);
            }
        }
    });

    return [...coeffSet].map(name => ({
        name,
        value: NUMERIC_CONFIG.param.defaultValue,
        min: NUMERIC_CONFIG.param.defaultMin,
        max: NUMERIC_CONFIG.param.defaultMax,
        step: NUMERIC_CONFIG.param.defaultStep,
    }));
}
