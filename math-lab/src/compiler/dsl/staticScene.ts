/**
 * 静态场景构建与缓存.
 * 负责 params/matrix/transform 和对象 blueprint 的声明级建模.
 *
 * 202609 review 结论:region 面积图形的"边界曲线必须存在且为 curve,不得带
 * animation/静态 transform"约束只依赖声明级数据(blueprint 与两张 map),
 * 与参数无关;原先放在 compileScene 每次刷新时对"物化对象"重跑一遍,还在
 * 每个 region 里重建一次全对象索引.已上收到 buildStaticScene 末尾一次性
 * 执行(见 finalizeRegionBlueprints),编译缓存命中后不再重复.
 */
import type {
    AstProgram,
    DerivativeStatement,
    ObjectStatement,
    OptionPair,
} from '../ast/types';
import type { AnimationClip, ParamDeclaration } from '../ir/types';
import type { MatrixOps } from '../../math/tensor/SceneTransform';
import { cloneMat4, type Mat4 } from '../../math/tensor/rowMajorMatrix';
import { withStatementSpan } from '../errors';
import { buildObjectBlueprint } from './objects/build';
import { blueprintHasCoefficients, type ObjectBlueprint } from './objects/types';
import { assertKnownOptions, findOption, toFiniteNumber } from './options';
import {
    cachedDerivativeExpression,
    normalizeExpression,
} from './expression';
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

/** `derivative` 求导语句允许的选项(与对象外观一致,transform/animation 不继承). */
const DERIVATIVE_OPTION_NAMES = ['color', 'range', 'segments'] as const;

/**
 * 可被求导引用的源:curve / surface 或先前已生成的求导对象.
 * 存储归一化表达式,使链式求导(d²f 等)与单层求导共用同一解析结果.
 */
type DerivativeSource = { kind: 'curve' | 'surface'; expr: string };

/**
 * 把 `derivative 名称 = derivative(源对象 [, 变量])` 编译成一个新对象
 * blueprint(curve -> curve 求 x 导,surface -> surface 需指定 x|y).
 *
 * 产物复用 `buildObjectBlueprint` 的归一化/系数提取/选项校验,因此导数对象
 * 与手写 curve/surface 完全同构,之后照常进入物化与渲染管线;color 缺省用
 * 调色板(每个新对象一个),range/segments 缺省继承源对象(与源画在同一区间).
 *
 * 求导函数名为全名 `derivative`(项目约定不缩写,见 miko.pest).
 *
 * ── 审查记录(202609,供后续审查参考) ────────────────────────────
 * 1) 类型推断:结果 kind 由源对象决定(curve->curve,surface->surface),
 *    求导变量 curve 缺省 'x',surface 必填 x|y.这与 gradient 按 isCurve
 *    分派,integral 按 sourceKind 推 dim/domainKind 的推断风格一致,不是
 *    新引入的约定.
 * 2) 两条有意为之的边界(审查时请保留,勿当作缺陷"修复"):
 *    a. 链式求导按源码顺序处理:`derivative d2 = derivative(d1)` 要求 d1
 *       声明在前;直接引用 curve/surface 源则允许前向引用(见调用处
 *       resolvable 的预填).若希望链式也支持乱序,需改成两阶段解析.
 *    b. 产物 kind 与手写 curve/surface 相同(选项只收 color/range/segments,
 *       transform/animation 刻意不继承--导数应是独立函数图形,与源对象的
 *       平移/动画无关,允许项见同文件顶部的 DERIVATIVE_OPTION_NAMES);
 *       唯一例外是 derivativeOrigin 这块展示元数据:公式要写成
 *       d/dx(源函数) 而不是看不出求导的 y=f(x)(见 dsl/latex.ts),数值与
 *       渲染路径不读它.
 * ──────────────────────────────────────────────────────────────
 */
function buildDerivativeObjectBlueprint(
    statement: DerivativeStatement,
    nextId: number,
    statementsByName: Map<string, ObjectStatement>,
    resolvable: Map<string, DerivativeSource>,
    declaredObjectNames: ReadonlySet<string>,
): ObjectBlueprint {
    const source = statement.source.trim();
    const sourceInfo = resolvable.get(source);
    if (!sourceInfo) {
        if (declaredObjectNames.has(source)) {
            throw new Error(`求导 ${statement.name} 只能应用于 curve/surface 类型对象`);
        }
        throw new Error(`求导 ${statement.name} 引用了不存在的对象 ${source}`);
    }

    assertKnownOptions(statement.options, DERIVATIVE_OPTION_NAMES, `求导 ${statement.name}`);

    let variable = statement.variable;
    if (sourceInfo.kind === 'curve') {
        if (variable === undefined) variable = 'x';
        if (variable !== 'x') {
            throw new Error(`曲线 ${statement.name} 的求导变量只能是 x`);
        }
    } else {
        if (variable === undefined) {
            throw new Error(`曲面求导 ${statement.name} 需要指定变量 x 或 y`);
        }
        if (variable !== 'x' && variable !== 'y') {
            throw new Error(`曲面求导 ${statement.name} 的变量只能是 x 或 y`);
        }
    }

    const derivExpr = cachedDerivativeExpression(sourceInfo.expr, variable);

    // 从源对象继承 range/segments(否则用各自默认),并允许求导语句覆盖.
    const sourceStmt = statementsByName.get(source);
    const inheritedRange = sourceStmt?.options.find((option) => option.name === 'range');
    const inheritedSegments = sourceStmt?.options.find((option) => option.name === 'segments');
    const ownColor = statement.options.find((option) => option.name === 'color');
    const ownRange = statement.options.find((option) => option.name === 'range');
    const ownSegments = statement.options.find((option) => option.name === 'segments');

    const options: OptionPair[] = [];
    if (inheritedRange && !ownRange) options.push(inheritedRange);
    if (inheritedSegments && !ownSegments) options.push(inheritedSegments);
    if (ownColor) options.push(ownColor);
    if (ownRange) options.push(ownRange);
    if (ownSegments) options.push(ownSegments);

    const synthetic: ObjectStatement = {
        type: 'object',
        kind: sourceInfo.kind,
        name: statement.name,
        expr: derivExpr,
        options,
        span: statement.span,
    };
    const blueprint = buildObjectBlueprint(synthetic, nextId, statementsByName);
    if (!blueprint) {
        throw new Error(`求导 ${statement.name} 无法生成对象`);
    }

    // 只挂展示元数据:导出的对象本身仍是普通 curve/surface,数值/渲染不变;
    // 公式层据此写成 d/dx(源函数) 或 ∂/∂y(源函数).
    if (blueprint.kind === 'curve' || blueprint.kind === 'surface') {
        blueprint.derivativeOrigin = {
            sourceExpr: sourceInfo.expr,
            variable,
        };
    }
    return blueprint;
}

/**
 * 静态场景缓存必须和 matrixOps 绑定.
 * 对象表达式/参数声明与 matrixOps 无关,但 transform 求值依赖具体后端;
 * 同一 AST 用不同 matrixOps 编译时若复用旧结果,会返回错误的 objectTransforms.
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
            // transforms 表按声明顺序边解析边写入,因此 transform 声明体可以
            // 引用"此前已声明"的 matrix/transform(见 transforms.ts 语法表).
            const transform = parseTransformExpression(
                statement.expr,
                matrices,
                transforms,
                matrixOps,
            );
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
    // "region" 声明按名引用两条边界 curve(允许引用声明在区域之后的对象),
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

    // 求导语句:生成一个新 curve/surface 对象(全名 derivative,见 miko.pest).
    // 先建立"可求导源"(curve/surface 对象 + 先前求导结果,按归一化表达式),
    // 再按源码顺序处理 derivative,使链式求导(d²f)与单层求导共用同一入口.
    //
    // 审查记录(202609):前向引用不对称--curve/surface 源在此处先预填
    // resolvable,所以"derivative 写在源对象之前"也成立;但链式求导的结果
    // 只在轮到它时才写入 resolvable,因此 `derivative d2 = derivative(d1)`
    // 要求 d1 在之前声明(否则报"引用了不存在的对象 d1").若需链式也支持
    // 乱序,改为两阶段解析(先求依赖序再生成 blueprint).
    const resolvable = new Map<string, DerivativeSource>();
    const declaredObjectNames = new Set<string>();
    for (const statement of ast.statements) {
        if (statement.type !== 'object' || statement.name === undefined) continue;
        declaredObjectNames.add(statement.name);
        if (statement.kind === 'curve' || statement.kind === 'surface') {
            resolvable.set(statement.name, {
                kind: statement.kind,
                expr: normalizeExpression(statement.expr),
            });
        }
    }
    for (const statement of ast.statements) {
        if (statement.type !== 'derivative') continue;
        withStatementSpan(statement.span, () => {
            if (objectNames.has(statement.name)) {
                throw new Error(`对象 ${statement.name} 重复声明`);
            }
            const blueprint = buildDerivativeObjectBlueprint(
                statement,
                nextId,
                statementsByName,
                resolvable,
                declaredObjectNames,
            );
            objectNames.add(blueprint.name);
            objectBlueprints.push(blueprint);
            // 求导产物一定是 curve/surface(见 buildDerivativeObjectBlueprint).
            const derivative = blueprint as Extract<
                ObjectBlueprint,
                { kind: 'curve' | 'surface' }
            >;
            resolvable.set(derivative.name, {
                kind: derivative.kind,
                expr: derivative.expr,
            });
            // 求导产物是独立对象,不继承源对象的 transform/animation,故无需
            // 登记 objectTransforms/objectAnimations.
            nextId += 1;
        });
    }

    // "region" 边界约束是纯声明级检查,放在这里一次性执行(见文件头结论).
    finalizeRegionBlueprints(
        objectBlueprints,
        statementsByName,
        objectTransforms,
        objectAnimations,
    );

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

/**
 * region 面积图形的运行时约束(V1 x 型带,见 objects/build.ts / ir/types.ts):
 * - 两条边界曲线必须已在对象列表声明且是 curve(buildObjectBlueprint 已按
 *   ObjectStatement 校验,这里对 blueprint 结果做同源复查);
 * - 边界曲线不得带静态变换或动画--否则 y=f(x) 的带状语义(曲线必须保持在
 *   z=0 平面)会被破坏,报错文案由调用方 UI 直接展示.
 *
 * 只依赖 blueprint 与 objectTransforms/objectAnimations,与参数无关;
 * 202609 review 结论:该检查原先在 compileScene 对"物化对象"每次参数刷新
 * 重跑,且每个 region 各重建一次全对象索引,现上收到这里只跑一次.
 */
function finalizeRegionBlueprints(
    objectBlueprints: ObjectBlueprint[],
    statementsByName: Map<string, ObjectStatement>,
    objectTransforms: Map<number, Mat4>,
    objectAnimations: Map<number, string[]>,
): void {
    const blueprintByName = new Map(objectBlueprints.map((item) => [item.name, item] as const));
    for (const blueprint of objectBlueprints) {
        if (blueprint.kind !== 'region') continue;
        const statement = statementsByName.get(blueprint.name);

        const checkBoundary = (name: string, role: string): void => {
            const curve = blueprintByName.get(name);
            if (!curve || curve.kind !== 'curve') {
                throw new Error(
                    `区域 ${blueprint.name} 的${role}边界曲线必须是已声明的 curve`,
                );
            }
            if ((objectAnimations.get(curve.id) ?? []).length > 0) {
                throw new Error(
                    `区域 ${blueprint.name} 的${role}边界曲线 ${curve.name} 带动画,暂不支持`,
                );
            }
            if (objectTransforms.has(curve.id)) {
                throw new Error(
                    `区域 ${blueprint.name} 的${role}边界曲线 ${curve.name} 带静态变换,暂不支持`,
                );
            }
        };

        const run = (): void => {
            checkBoundary(blueprint.curveAName, '下');
            checkBoundary(blueprint.curveBName, '上');
        };
        if (statement) {
            withStatementSpan(statement.span, run);
        } else {
            run();
        }
    }
}
