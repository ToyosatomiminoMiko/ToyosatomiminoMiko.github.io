/**
 * 参数收集、覆盖与求值 scope 辅助函数。
 * 从 DslCompiler 拆出，保持参数相关逻辑集中管理。
 */
import type { AstProgram } from '../ast/types';
import type { ParamDeclaration } from '../ir/types';
import { toFiniteNumber } from './options';

export function collectParams(ast: AstProgram): Map<string, ParamDeclaration> {
    const params = new Map<string, ParamDeclaration>();
    for (const statement of ast.statements) {
        if (statement.type !== 'param') continue;
        params.set(statement.name, {
            name: statement.name,
            value: toFiniteNumber(statement.value, `参数 ${statement.name} 的 value`),
            min: statement.ui ? toFiniteNumber(statement.ui.min, `参数 ${statement.name} 的 min`) : -10,
            max: statement.ui ? toFiniteNumber(statement.ui.max, `参数 ${statement.name} 的 max`) : 10,
            step: statement.ui ? toFiniteNumber(statement.ui.step, `参数 ${statement.name} 的 step`) : 0.1,
        });
    }
    return params;
}

export function applyParamOverrides(
    params: Map<string, ParamDeclaration>,
    overrides: Record<string, number>,
): void {
    for (const [name, value] of Object.entries(overrides)) {
        const param = params.get(name);
        if (param) param.value = value;
    }
}

export function buildParamScope(
    params: Map<string, ParamDeclaration>,
    overrides: Record<string, number>,
): Record<string, number> {
    const scope: Record<string, number> = {};
    for (const [name, param] of params) {
        scope[name] = overrides[name] ?? param.value;
    }
    return scope;
}
