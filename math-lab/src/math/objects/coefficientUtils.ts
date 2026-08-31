import type { Coefficient } from '../../compiler/ir/types';
import { extractSymbolNames } from '../../compiler/dsl/expression';
import { NUMERIC_CONFIG } from '../../config/numericConfig';

/**
 * 从表达式字符串中提取自由参数,并排除指定的坐标变量名.
 *
 * 内置函数名/数学常量由 Rust 符号引擎统一排除,TS 不再维护黑名单.
 */
export function extractCoefficients(
    expr: string,
    varNames: ReadonlySet<string>,
): Coefficient[] {
    const names = extractSymbolNames(expr, varNames);
    return names.map((name) => ({
        name,
        value: NUMERIC_CONFIG.param.defaultValue,
        min: NUMERIC_CONFIG.param.defaultMin,
        max: NUMERIC_CONFIG.param.defaultMax,
        step: NUMERIC_CONFIG.param.defaultStep,
    }));
}
