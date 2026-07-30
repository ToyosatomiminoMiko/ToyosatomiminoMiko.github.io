import * as math from 'mathjs';

/**
 * 符号求导: 对 math.js 表达式树求导,返回化简后的导数节点
 * @param {math.MathNode} node     - 一元或多元表达式
 * @param {string}        variable - 求导变量 'x' 或 'y'
 * @returns {math.MathNode}
 */
export function differentiate(node, variable) {
    // math.derivative 内部已做化简
    return math.derivative(node, variable);
}