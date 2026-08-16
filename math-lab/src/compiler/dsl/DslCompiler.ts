import type { AstProgram } from '../ast/types';
import type {
    IntegralTask,
    SceneIR,
    SceneObject,
} from '../ir/types';
import {
    jsMatrixOps,
    type MatrixOps,
} from '../../math/tensor/SceneTransform';
import { materializeObject, type ObjectBlueprint } from './objects';
import { applyParamOverrides } from './params';
import { compileIntegralTask } from './integrals';
import { compileAnalyses } from './analyses';
import {
    cloneObjectTransforms,
    cloneParams,
    getOrBuildStaticScene,
} from './staticScene';

/**
 * DslCompiler facade：只负责把 AST 编排成 SceneIR.
 *
 * 具体职责已经拆到：
 * - options.ts     选项与列表解析
 * - params.ts      参数收集、覆盖、求值 scope
 * - objects.ts     对象 blueprint 构建与物化
 * - expression.ts  mathjs 表达式求值与 Rust 表达式转换
 * - transforms.ts  矩阵/变换求值
 * - integrals.ts   积分任务编译
 * - analyses.ts    微分分析编译
 * - staticScene.ts 静态场景构建与缓存
 */
export function compileScene(
    ast: AstProgram,
    paramOverrides: Record<string, number> = {},
    matrixOps: MatrixOps = jsMatrixOps,
): SceneIR {
    const staticScene = getOrBuildStaticScene(ast, matrixOps);

    const params = cloneParams(staticScene.params);
    const objects = staticScene.objectBlueprints.map((blueprint) =>
        materializeObject(blueprint, params, paramOverrides),
    );
    applyParamOverrides(params, paramOverrides);

    const objectByName = new Map<string, SceneObject>();
    const blueprintByName = new Map<string, ObjectBlueprint>();
    for (let i = 0; i < staticScene.objectBlueprints.length; i += 1) {
        const blueprint = staticScene.objectBlueprints[i];
        objectByName.set(blueprint.name, objects[i]);
        blueprintByName.set(blueprint.name, blueprint);
    }

    const integrals: IntegralTask[] = [];
    for (const statement of ast.statements) {
        if (statement.type !== 'integral') continue;
        integrals.push(compileIntegralTask(statement, objectByName));
    }

    return {
        params: [...params.values()],
        objects,
        objectTransforms: cloneObjectTransforms(staticScene.objectTransforms),
        analyses: compileAnalyses(ast, blueprintByName, params, paramOverrides),
        integrals,
    };
}
