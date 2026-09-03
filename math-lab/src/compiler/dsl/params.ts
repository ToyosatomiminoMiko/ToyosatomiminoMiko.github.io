/**
 * 参数收集/覆盖与求值 scope 辅助函数.
 * 从 DslCompiler 拆出,保持参数相关逻辑集中管理.
 */
import type { AstProgram } from '../ast/types';
import type { ParamDeclaration } from '../ir/types';
import { NUMERIC_CONFIG } from '../../config/numericConfig';
import { toFiniteNumber } from './options';

/** 按全局数值配置构造未声明参数项. */
export function createDefaultParam(name: string): ParamDeclaration {
    return {
        name,
        value: NUMERIC_CONFIG.param.defaultValue,
        min: NUMERIC_CONFIG.param.defaultMin,
        max: NUMERIC_CONFIG.param.defaultMax,
        step: NUMERIC_CONFIG.param.defaultStep,
    };
}

export function collectParams(ast: AstProgram): Map<string, ParamDeclaration> {
    const params = new Map<string, ParamDeclaration>();
    const seen = new Set<string>();

    for (const statement of ast.statements) {
        if (statement.type !== 'param') continue;
        if (seen.has(statement.name)) {
            throw new Error(`参数 ${statement.name} 重复声明`);
        }
        seen.add(statement.name);

        const value = toFiniteNumber(statement.value, `参数 ${statement.name} 的 value`);
        const declaration = createDefaultParam(statement.name);
        declaration.value = value;
        if (statement.ui) {
            declaration.min = toFiniteNumber(statement.ui.min, `参数 ${statement.name} 的 min`);
            declaration.max = toFiniteNumber(statement.ui.max, `参数 ${statement.name} 的 max`);
            declaration.step = toFiniteNumber(statement.ui.step, `参数 ${statement.name} 的 step`);
        }

        // 参数 UI 的范围是后续滑块的契约;不在这里校验,
        // 后续会生成反直觉甚至无法使用的滑块.
        if (declaration.min >= declaration.max) {
            throw new Error(`参数 ${statement.name} 需要满足 min < max`);
        }
        if (declaration.step <= 0) {
            throw new Error(`参数 ${statement.name} 的 step 必须大于 0`);
        }
        if (declaration.value < declaration.min || declaration.value > declaration.max) {
            throw new Error(
                `参数 ${statement.name} 的初始值 ${declaration.value} `
                + `不在 [${declaration.min}, ${declaration.max}] 内`,
            );
        }

        params.set(statement.name, declaration);
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
