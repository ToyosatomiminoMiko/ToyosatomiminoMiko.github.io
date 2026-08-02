import * as math from 'mathjs';
import type { MathNode } from 'mathjs';

/**
 * 符号求导：对 math.js 表达式树求导，返回化简后的导数节点
 * @param node     - 一元或多元表达式
 * @param variable - 求导变量 'x' 或 'y'
 * @returns 导数表达式树
 */
export function differentiate(node: MathNode, variable: string): MathNode {
    // math.derivative 内部已做化简
    return math.derivative(node, variable);
}