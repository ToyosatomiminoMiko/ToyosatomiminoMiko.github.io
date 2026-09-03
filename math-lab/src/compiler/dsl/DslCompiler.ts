import type { AstProgram } from '../ast/types';
import type {
    IntegralTask,
    SceneIR,
    SceneObject,
} from '../ir/types';
import type { MatrixOps } from '../../math/tensor/SceneTransform';
import { materializeObject } from './objects';
import { applyParamOverrides } from './params';
import { compileIntegralTask } from './integrals';
import { compileAnalyses } from './analyses';
import { compileIntersections } from './intersections';
import { integralLatex, sceneObjectLatex } from './latex';
import {
    cloneAnimations,
    cloneObjectAnimations,
    cloneObjectTransforms,
    cloneParams,
    getOrBuildStaticScene,
} from './staticScene';

/**
 * DslCompiler facade:只负责把 AST 编排成 SceneIR.
 *
 * 具体职责已经拆到:
 * - options.ts     选项与列表解析
 * - params.ts      参数收集/覆盖/求值 scope
 * - objects.ts     对象 blueprint 构建与物化
 * - expression.ts  Rust 符号归一化/求导与数值求值
 * - transforms.ts  矩阵/变换求值
 * - integrals.ts   积分任务编译
 * - analyses.ts    微分分析编译
 * - staticScene.ts 静态场景构建与缓存
 */
export interface CompileSceneOptions {
    hiddenAnalysisNames?: ReadonlySet<string>;
    hiddenIntegralNames?: ReadonlySet<string>;
    hiddenIntersectionNames?: ReadonlySet<string>;
}

export function compileScene(
    ast: AstProgram,
    paramOverrides: Record<string, number> = {},
    matrixOps: MatrixOps,
    options: CompileSceneOptions = {},
): SceneIR {
    const staticScene = getOrBuildStaticScene(ast, matrixOps);
    const hiddenAnalysisNames = options.hiddenAnalysisNames ?? new Set<string>();
    const hiddenIntegralNames = options.hiddenIntegralNames ?? new Set<string>();
    const hiddenIntersectionNames = options.hiddenIntersectionNames ?? new Set<string>();

    const params = cloneParams(staticScene.params);
    const objects = staticScene.objectBlueprints.map((blueprint) =>
        materializeObject(blueprint, params, paramOverrides),
    );
    applyParamOverrides(params, paramOverrides);

    const objectByName = new Map<string, SceneObject>();
    for (const object of objects) {
        if (object.name !== undefined) {
            objectByName.set(object.name, object);
        }
    }

    const integrals: IntegralTask[] = [];
    for (const statement of ast.statements) {
        if (statement.type !== 'integral') continue;
        const task = compileIntegralTask(statement, objectByName);
        task.enabled = !hiddenIntegralNames.has(statement.name);
        integrals.push(task);
    }

    const objectTransforms = cloneObjectTransforms(staticScene.objectTransforms);
    const objectAnimations = cloneObjectAnimations(staticScene.objectAnimations);

    const objectFormulas: Record<number, string | null> = {};
    for (const object of objects) {
        objectFormulas[object.id] = sceneObjectLatex(object);
    }

    const integralFormulas: Record<string, string | null> = {};
    for (const task of integrals) {
        integralFormulas[task.name] = integralLatex(task, objects);
    }

    return {
        params: [...params.values()],
        objects,
        objectFormulas,
        objectTransforms,
        animations: cloneAnimations(staticScene.animations),
        objectAnimations,
        analyses: compileAnalyses(
            ast,
            objectByName,
            params,
            hiddenAnalysisNames,
        ),
        integrals,
        integralFormulas,
        intersections: compileIntersections(
            ast,
            objectByName,
            objectTransforms,
            objectAnimations,
            hiddenIntersectionNames,
        ),
    };
}
