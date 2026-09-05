import type { AstProgram, ObjectStatement } from '../ast/types';
import type {
    IntegralTask,
    SceneIR,
    SceneObject,
} from '../ir/types';
import type { MatrixOps } from '../../math/tensor/SceneTransform';
import { withStatementSpan } from '../errors';
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
    objectStatementsByName,
} from './staticScene';

/**
 * DslCompiler facade:只负责把 AST 编排成 SceneIR.
 *
 * 具体职责已经拆到:
 * - options.ts     选项与列表解析
 * - params.ts      参数收集/覆盖/求值 scope
 * - objects.ts     对象 blueprint 构建与物化(region 面积图形见该文件头注释)
 * - expression.ts  Rust 符号归一化/求导与数值求值
 * - transforms.ts  矩阵/变换求值
 * - integrals.ts   积分任务编译(dim/domainKind/integrand 语义)
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

    const objectTransforms = cloneObjectTransforms(staticScene.objectTransforms);
    const objectAnimations = cloneObjectAnimations(staticScene.objectAnimations);

    // region 依赖的边界曲线必须是不带动画/静态变换的纯函数曲线,
    // 否则 y=f(x) 的带状语义被破坏;语句级 span 由 region 声明本身提供.
    finalizeRegionDomains(
        objects,
        objectTransforms,
        objectAnimations,
        objectStatementsByName(ast),
    );

    const objectByName = new Map<string, SceneObject>();
    for (const object of objects) {
        if (object.name !== undefined) {
            objectByName.set(object.name, object);
        }
    }

    const integrals: IntegralTask[] = [];
    for (const statement of ast.statements) {
        if (statement.type !== 'integral') continue;
        // 语句级错误定位:积分任务编译失败时携带本语句 span.
        withStatementSpan(statement.span, () => {
            const task = compileIntegralTask(
                statement,
                objectByName,
                params,
                paramOverrides,
            );
            task.enabled = !hiddenIntegralNames.has(statement.name);
            integrals.push(task);
        });
    }

    const objectFormulas: Record<number, string | null> = {};
    for (const object of objects) {
        objectFormulas[object.id] = sceneObjectLatex(object, objectByName);
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

/**
 * region 面积图形的运行时约束:
 * - 边界曲线必须存在于物化对象列表且是 curve(blueprint 已按语句校验,
 *   这里对物化结果做二次防御);
 * - 边界曲线不得带静态变换或动画(V1 仅支持 z=0 平面上的 x 型带状).
 */
function finalizeRegionDomains(
    objects: SceneObject[],
    objectTransforms: Record<number, number[][]>,
    objectAnimations: Record<number, string[]>,
    objectStatementByName: Map<string, ObjectStatement>,
): void {
    for (const object of objects) {
        if (object.kind !== 'region') continue;
        const region = object;
        const statement = objectStatementByName.get(region.name);

        const checkBoundary = (curve: SceneObject | undefined, role: string): void => {
            if (!curve || curve.kind !== 'curve') {
                throw new Error(
                    `区域 ${region.name} 的${role}边界曲线必须是已声明的 curve`,
                );
            }
            if ((objectAnimations[curve.id] ?? []).length > 0) {
                throw new Error(
                    `区域 ${region.name} 的${role}边界曲线 ${curve.name} 带动画,暂不支持`,
                );
            }
            if (objectTransforms[curve.id]) {
                throw new Error(
                    `区域 ${region.name} 的${role}边界曲线 ${curve.name} 带静态变换,暂不支持`,
                );
            }
        };

        const run = (): void => {
            const byName = new Map(objects.map((item) => [item.name, item] as const));
            checkBoundary(byName.get(region.curveAName), '下');
            checkBoundary(byName.get(region.curveBName), '上');
        };
        if (statement) {
            withStatementSpan(statement.span, run);
        } else {
            run();
        }
    }
}
