import * as math from 'mathjs';
import type { MathNode } from 'mathjs';
import type { Coefficient } from './types';
import { extractCoefficients } from './coefficientUtils';

// 曲面变量名集合
const SURFACE_VARS = new Set(['x', 'y']);

/**
 * 解析曲面表达式字符串
 */
export function parseSurface(raw: string): { node: MathNode; coefficients: Coefficient[] } {
    const node = math.parse(raw);
    return {
        node,
        coefficients: extractCoefficients(node, SURFACE_VARS),
    };
}

/**
 * 对曲面表达式求偏导
 */
export function differentiateSurface(node: MathNode, variable: 'x' | 'y'): MathNode {
    return math.derivative(node, variable) as MathNode;
}