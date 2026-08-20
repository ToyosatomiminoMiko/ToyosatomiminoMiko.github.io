/**
 * 静态场景构建与缓存.
 * 负责 params、matrix、transform 和对象 blueprint 的声明级建模.
 */
import type { AstProgram } from '../ast/types';
import type { AnimationClip, ParamDeclaration } from '../ir/types';
import type { MatrixOps } from '../../math/tensor/SceneTransform';
import { NUMERIC_CONFIG } from '../../config/numericConfig';
import { buildObjectBlueprint, type ObjectBlueprint } from './objects';
import { assertKnownOptions, findOption, toFiniteNumber } from './options';
import { collectParams } from './params';
import {
    cloneMat4,
    evaluateMatrix,
    parseSingleTransformExpression,
    parseTransformExpression,
    resolveObjectTransform,
    type Mat4,
} from './transforms';

export type StaticScene = {
    params: Map<string, ParamDeclaration>;
    objectBlueprints: ObjectBlueprint[];
    objectTransforms: Map<number, Mat4>;
    animations: Map<string, AnimationClip>;
    objectAnimations: Map<number, string[]>;
};

/**
 * 静态场景缓存必须和 matrixOps 绑定.
 * 对象表达式、参数声明与 matrixOps 无关,但 transform 求值依赖具体后端;
 * 同一 AST 用不同 matrixOps 编译时若复用旧结果,会返回错误的 objectTransforms.
 */
/**
 * @cache
 * 缓存目的:避免参数刷新时反复执行声明级建模，只按 AST 缓存静态场景.
 * 键/失效策略:WeakMap<AstProgram, { matrixOps, scene }>;AST 被回收时自动
 *              失效.若 matrixOps 后端变化，也会重新构建，避免复用旧变换.
 * 生命周期:模块级，跟随页面存活.
 */
const staticSceneCache = new WeakMap<AstProgram, { matrixOps: MatrixOps; scene: StaticScene }>();

/**
 * @cache-access
 * 获取 AST 对应的静态场景;缓存未命中时构建并写入.
 */
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

export function cloneAnimations(animations: Map<string, AnimationClip>): AnimationClip[] {
    return [...animations.values()].map((animation) => ({
        name: animation.name,
        duration: animation.duration,
        matrix: cloneMat4(animation.matrix),
    }));
}

export function cloneObjectAnimations(
    objectAnimations: Map<number, string[]>,
): Record<number, string[]> {
    const clone: Record<number, string[]> = {};
    for (const [id, names] of objectAnimations) {
        clone[id] = [...names];
    }
    return clone;
}

function parseAnimationNames(raw: string | undefined, context: string): string[] {
    if (raw === undefined) return [];

    const body = raw.trim();
    if (body.length === 0) return [];

    if (body.startsWith('[') || body.endsWith(']')) {
        const inner = body.slice(1, -1).trim();
        if (inner.length === 0) return [];
        const names = inner.split(',').map((item) => item.trim());
        if (names.some((name) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))) {
            throw new Error(`${context} 包含无效动画名: ${raw}`);
        }
        return names;
    }

    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(body)) {
        throw new Error(`${context} 包含无效动画名: ${raw}`);
    }
    return [body];
}

function buildStaticScene(ast: AstProgram, matrixOps: MatrixOps): StaticScene {
    const params = collectParams(ast);
    const matrices = new Map<string, Mat4>();
    const transforms = new Map<string, Mat4>();
    const animations = new Map<string, AnimationClip>();
    const objectAnimations = new Map<number, string[]>();
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

    for (const statement of ast.statements) {
        if (statement.type !== 'animation') continue;
        if (animations.has(statement.name)) {
            throw new Error(`动画 ${statement.name} 重复声明`);
        }

        assertKnownOptions(statement.options, ['duration'], `动画 ${statement.name}`);
        const matrix = parseSingleTransformExpression(
            statement.expr,
            matrices,
            transforms,
            matrixOps,
        );
        if (!matrix) {
            throw new Error(`动画 ${statement.name} 只能包含一个矩阵变换`);
        }

        const duration = toFiniteNumber(
            findOption(statement.options, 'duration') ?? '',
            `动画 ${statement.name} 的 duration`,
        );
        if (duration <= 0) {
            throw new Error(`动画 ${statement.name} 的 duration 必须大于 0`);
        }

        animations.set(statement.name, {
            name: statement.name,
            duration,
            matrix,
        });
    }

    let nextId = 1;
    const objectNames = new Set<string>();
    for (const statement of ast.statements) {
        if (statement.type === 'object') {
            const blueprint = buildObjectBlueprint(statement, nextId);
            if (blueprint) {
                if (objectNames.has(blueprint.name)) {
                    throw new Error(`对象 ${blueprint.name} 重复声明`);
                }
                objectNames.add(blueprint.name);
                objectBlueprints.push(blueprint);
                const transform = resolveObjectTransform(
                    findOption(statement.options, 'transform'),
                    transforms,
                    matrices,
                );
                if (transform) objectTransforms.set(blueprint.id, transform);
                const animationNames = parseAnimationNames(
                    findOption(statement.options, 'animation'),
                    `对象 ${blueprint.name} 的 animation`,
                );
                for (const animationName of animationNames) {
                    if (!animations.has(animationName)) {
                        throw new Error(
                            `对象 ${blueprint.name} 引用了不存在的动画 ${animationName}`,
                        );
                    }
                }
                if (animationNames.length > 0) {
                    objectAnimations.set(blueprint.id, animationNames);
                }
                nextId += 1;
            }
        }
    }

    for (const blueprint of objectBlueprints) {
        if (
            blueprint.kind !== 'curve'
            && blueprint.kind !== 'surface'
            && blueprint.kind !== 'vector_field'
            && blueprint.kind !== 'sphere'
            && blueprint.kind !== 'box'
            && blueprint.kind !== 'conic'
        ) {
            continue;
        }
        for (const name of blueprint.coefficientNames) {
            if (!params.has(name)) {
                params.set(name, {
                    name,
                    value: NUMERIC_CONFIG.param.defaultValue,
                    min: NUMERIC_CONFIG.param.defaultMin,
                    max: NUMERIC_CONFIG.param.defaultMax,
                    step: NUMERIC_CONFIG.param.defaultStep,
                });
            }
        }
    }

    return {
        params,
        objectBlueprints,
        objectTransforms,
        animations,
        objectAnimations,
    };
}
