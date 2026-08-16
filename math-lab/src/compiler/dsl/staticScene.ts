import type { AstProgram } from '../ast/types';
import type { ParamDeclaration } from '../ir/types';
import type { MatrixOps } from '../../math/tensor/SceneTransform';
import { buildObjectBlueprint, type ObjectBlueprint } from './objects';
import { findOption } from './options';
import { collectParams } from './params';
import {
    cloneMat4,
    evaluateMatrix,
    parseTransformExpression,
    resolveObjectTransform,
    type Mat4,
} from './transforms';

export type StaticScene = {
    params: Map<string, ParamDeclaration>;
    objectBlueprints: ObjectBlueprint[];
    objectTransforms: Map<number, Mat4>;
};

/**
 * 静态场景缓存必须和 matrixOps 绑定.
 * 对象表达式、参数声明与 matrixOps 无关,但 transform 求值依赖具体后端;
 * 同一 AST 用不同 matrixOps 编译时若复用旧结果,会返回错误的 objectTransforms.
 */
const staticSceneCache = new WeakMap<AstProgram, { matrixOps: MatrixOps; scene: StaticScene }>();

export function getOrBuildStaticScene(ast: AstProgram, matrixOps: MatrixOps): StaticScene {
    let cached = staticSceneCache.get(ast);
    if (!cached || cached.matrixOps !== matrixOps) {
        const scene = buildStaticScene(ast, matrixOps);
        cached = { matrixOps, scene };
        staticSceneCache.set(ast, cached);
    }
    return cached.scene;
}

export function cloneParams(params: Map<string, ParamDeclaration>): Map<string, ParamDeclaration> {
    const clone = new Map<string, ParamDeclaration>();
    for (const [name, param] of params) {
        clone.set(name, { ...param });
    }
    return clone;
}

export function cloneObjectTransforms(transforms: Map<number, Mat4>): Record<number, Mat4> {
    const clone: Record<number, Mat4> = {};
    for (const [id, matrix] of transforms) {
        clone[id] = cloneMat4(matrix);
    }
    return clone;
}

function buildStaticScene(ast: AstProgram, matrixOps: MatrixOps): StaticScene {
    const params = collectParams(ast);
    const matrices = new Map<string, Mat4>();
    const transforms = new Map<string, Mat4>();
    const objectBlueprints: ObjectBlueprint[] = [];
    const objectTransforms = new Map<number, Mat4>();

    for (const statement of ast.statements) {
        if (statement.type === 'tensor' && statement.kind === 'matrix') {
            const matrix = evaluateMatrix(statement.expr);
            if (matrix) matrices.set(statement.name, matrix);
            else throw new Error(`矩阵 ${statement.name} 无法求值`);
        } else if (statement.type === 'tensor' && statement.kind === 'scalar') {
            throw new Error(`标量声明 ${statement.name} 暂未实现`);
        } else if (statement.type === 'tensor' && statement.kind === 'vector') {
            throw new Error(`向量声明 ${statement.name} 暂未实现`);
        }
    }

    for (const statement of ast.statements) {
        if (statement.type === 'tensor' && statement.kind === 'transform') {
            const transform = parseTransformExpression(statement.expr, matrices, matrixOps);
            if (transform) transforms.set(statement.name, transform);
            else throw new Error(`变换 ${statement.name} 无法求值`);
        }
    }

    let nextId = 1;
    for (const statement of ast.statements) {
        if (statement.type === 'object') {
            const blueprint = buildObjectBlueprint(statement, nextId);
            if (blueprint) {
                objectBlueprints.push(blueprint);
                const transform = resolveObjectTransform(
                    findOption(statement.options, 'transform'),
                    transforms,
                    matrices,
                );
                if (transform) objectTransforms.set(blueprint.id, transform);
                nextId += 1;
            }
        }
    }

    for (const blueprint of objectBlueprints) {
        if (blueprint.kind !== 'curve' && blueprint.kind !== 'surface' && blueprint.kind !== 'vector_field') {
            continue;
        }
        for (const name of blueprint.coefficientNames) {
            if (!params.has(name)) {
                params.set(name, {
                    name,
                    value: 1,
                    min: -10,
                    max: 10,
                    step: 0.1,
                });
            }
        }
    }

    return { params, objectBlueprints, objectTransforms };
}
