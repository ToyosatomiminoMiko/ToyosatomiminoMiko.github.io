import * as math from 'mathjs';
import type { MathNode } from 'mathjs';
import type { Coefficient } from './types';
import { extractCoefficients } from './coefficientUtils';

// 曲线变量名集合
const CURVE_VARS = new Set(['x']);

/**
 * 解析曲线表达式字符串
 */
export function parseCurve(raw: string): { node: MathNode; coefficients: Coefficient[] } {
    const node = math.parse(raw);
    return {
        node,
        coefficients: extractCoefficients(node, CURVE_VARS),
    };
}

/**
 * 对曲线表达式求导（固定对 x 求导）
 */
export function differentiateCurve(node: MathNode): MathNode {
    return math.derivative(node, 'x') as MathNode;
}