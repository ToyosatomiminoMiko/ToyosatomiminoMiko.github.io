/**
 * 静态场景构建与缓存.
 * 负责 params/matrix/transform 和对象 blueprint 的声明级建模.
 */
import type { AstProgram, ObjectStatement } from '../ast/types';
import type { AnimationClip, ParamDeclaration } from '../ir/types';
import type { MatrixOps } from '../../math/tensor/SceneTransform';
import { cloneMat4, type Mat4 } from '../../math/tensor/rowMajorMatrix';
import { withStatementSpan } from '../errors';
import {
    blueprintHasCoefficients,
    buildObjectBlueprint,
    type ObjectBlueprint,
} from './objects';
import { assertKnownOptions, findOption, toFiniteNumber } from './options';
import { collectParams, createDefaultParam } from './params';
import {
    evaluateMatrix,
    parseSingleTransformExpression,
    parseTransformExpression,
    resolveObjectTransform,
} from './transforms';

export type StaticScene = {
    params: Map<string, ParamDeclaration>;
    objectBlueprints: ObjectBlueprint[];
    objectTransforms: Map<number, Mat4>;
    animations: Map<string, AnimationClip>;
    objectAnimations: Map<number, string[]>;
};

/**
 * 场景对象声明按名索引.
 *
 * region 按名引用两条边界 curve,允许引用声明在区域之后的对象,
 * 因此必须先建这份 名字 -> ObjectStatement 的索引(编译期与运行时
 * DslCompiler 的 region 校验共用,避免各写一遍遍历).
 */
export function objectStatementsByName(ast: AstProgram): Map<string, ObjectStatement> {
    const map = new Map<string, ObjectStatement>();
    for (const statement of ast.statements) {
        if (statement.type !== 'object' || statement.name === undefined) continue;
        map.set(statement.name, statement);
    }
    return map;
}

/**
 * 静态场景缓存必须和 matrixOps 绑定.
 * 对象表达式/参数声明与 matrixOps 无关,但 transform 求值依赖具体后端;
 * 同一 AST 用不同 matrixOps 编译时若复用旧结果,会返回错误的 objectTransforms.
 */
/**
 * @cache
 * 缓存目的:避免参数刷新时反复执行声明级建模,只按 AST 缓存静态场景.
 * 键/失效策略:WeakMap<AstProgram, { matrixOps, scene }>;AST 被回收时自动
 *              失效.若 matrixOps 后端变化,也会重新构建,避免复用旧变换.
 * 生命周期:模块级,跟随页面存活.
 */
const staticSceneCache = new WeakMap<AstProgram, { matrixOps: MatrixOps; scene: StaticScene }>();

/**
 * @cache_access
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
        if (statement.type !== 'tensor') continue;
        // 语句级错误定位:tensor 声明校验失败时携带本语句 span.
        withStatementSpan(statement.span, () => {
            if (statement.kind === 'matrix') {
                const matrix = evaluateMatrix(statement.expr);
                if (matrix) matrices.set(statement.name, matrix);
                else throw new Error(`矩阵 ${statement.name} 无法求值`);
            } else if (statement.kind === 'scalar') {
                throw new Error(`标量声明 ${statement.name} 暂未实现`);
            } else if (statement.kind === 'vector') {
                throw new Error(`向量声明 ${statement.name} 暂未实现`);
            }
            // transform 语句在下一轮单独处理.
        });
    }

    for (const statement of ast.statements) {
        if (statement.type !== 'tensor' || statement.kind !== 'transform') continue;
        withStatementSpan(statement.span, () => {
            const transform = parseTransformExpression(statement.expr, matrices, matrixOps);
            if (transform) transforms.set(statement.name, transform);
            else throw new Error(`变换 ${statement.name} 无法求值`);
        });
    }

    for (const statement of ast.statements) {
        if (statement.type !== 'animation') continue;
        withStatementSpan(statement.span, () => {
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
        });
    }

    let nextId = 1;
    const objectNames = new Set<string>();
    // region 声明按名引用两条边界 curve(允许引用声明在区域之后的对象),
    // 索引构建复用 objectStatementsByName.
    const statementsByName = objectStatementsByName(ast);
    for (const statement of ast.statements) {
        if (statement.type !== 'object') continue;
        withStatementSpan(statement.span, () => {
            const blueprint = buildObjectBlueprint(
                statement,
                nextId,
                statementsByName,
            );
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
        });
    }

    for (const blueprint of objectBlueprints) {
        if (!blueprintHasCoefficients(blueprint)) continue;
        for (const name of blueprint.coefficientNames) {
            if (!params.has(name)) {
                params.set(name, createDefaultParam(name));
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
