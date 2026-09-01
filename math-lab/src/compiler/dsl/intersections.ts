/**
 * 求交编译.
 *
 * 负责把 `intersection` 语句解析成 IntersectionResult:
 * - 曲线参与的求交 -> 离散交点;
 * - 曲面/体积参与的求交 -> 空间交线.
 *
 * 数值计算全部在编译期同步完成,结果直接进入 SceneIR;渲染层只消费坐标.
 */
import type { AstProgram } from '../ast/types';
import type {
    IntersectionResult,
    SceneObject,
    Vec3,
} from '../ir/types';
import { NUMERIC_CONFIG } from '../../config/numericConfig';
import {
    assertKnownOptions,
    findOption,
    parseCappedPositiveInteger,
    stripQuotes,
} from './options';
import {
    buildField,
    buildSurfacePatch,
    buildVolumePatches,
    findCurveFieldIntersections,
    invertMat4,
    sampleSurfaceGrid,
    solveCurveCurve,
    traceContours,
    type Mat4,
} from '../../math/intersection/IntersectionMath';

const INTERSECTION_OPTION_NAMES = ['color', 'segments'] as const;
const SUPPORTED_KINDS = new Set<SceneObject['kind']>([
    'curve',
    'surface',
    'sphere',
    'box',
    'conic',
]);

function objectName(object: SceneObject): string {
    return object.name ?? `#${object.id}`;
}

function resolveObjectFrame(
    object: SceneObject,
    objectTransforms: Record<number, Mat4>,
    objectAnimations: Record<number, string[]>,
    intersectionName: string,
): { matrix: Mat4 | null; inverse: Mat4 | null } {
    if ((objectAnimations[object.id] ?? []).length > 0) {
        throw new Error(
            `求交 ${intersectionName} 引用的对象 ${objectName(object)} 带动画,暂不支持`,
        );
    }

    const matrix = objectTransforms[object.id] ?? null;
    if (!matrix) return { matrix: null, inverse: null };

    const inverse = invertMat4(matrix);
    if (!inverse) {
        throw new Error(
            `求交 ${intersectionName} 引用的对象 ${objectName(object)} 的变换矩阵不可逆`,
        );
    }
    return { matrix, inverse };
}

/**
 * 计算两个对象的交集.
 *
 * 对称组合统一收敛为"参数化侧 + 隐式场侧":
 * - 有曲线时,曲线是参数化侧,另一侧是场,一维求根得到交点;
 * - 没有曲线时,第一个对象(曲面或体积)提供面片,第二个对象提供场,做等值线.
 */
function computeIntersection(
    a: SceneObject,
    ma: Mat4 | null,
    invA: Mat4 | null,
    b: SceneObject,
    mb: Mat4 | null,
    invB: Mat4 | null,
    segments: number,
): { points: Vec3[]; curves: Vec3[][] } {
    if (a.kind === 'curve' && b.kind === 'curve') {
        return { points: solveCurveCurve(a, ma, b, mb, segments), curves: [] };
    }

    if (a.kind === 'curve') {
        return {
            points: findCurveFieldIntersections(a, ma, buildField(b, invB), segments),
            curves: [],
        };
    }

    if (b.kind === 'curve') {
        return {
            points: findCurveFieldIntersections(b, mb, buildField(a, invA), segments),
            curves: [],
        };
    }

    // 曲面 / 体积 / 体积 组合:第一个对象做面片,第二个对象做隐式场.
    const field = buildField(b, invB);
    const curves: Vec3[][] = [];

    if (a.kind === 'surface') {
        const zValues = sampleSurfaceGrid(a, segments, segments);
        const patch = buildSurfacePatch(a, ma, zValues, segments, segments);
        curves.push(...traceContours(field, patch, segments, segments));
    } else if (a.kind === 'sphere' || a.kind === 'box' || a.kind === 'conic') {
        for (const patch of buildVolumePatches(a, ma)) {
            curves.push(...traceContours(field, patch, segments, segments));
        }
    } else {
        throw new Error(`求交不支持对象类型 ${a.kind}`);
    }

    return { points: [], curves };
}

export function compileIntersections(
    ast: AstProgram,
    objects: Map<string, SceneObject>,
    objectTransforms: Record<number, Mat4>,
    objectAnimations: Record<number, string[]>,
    hiddenNames: ReadonlySet<string> = new Set(),
): IntersectionResult[] {
    const results: IntersectionResult[] = [];
    let colorIndex = 0;

    for (const statement of ast.statements) {
        if (statement.type !== 'intersection') continue;

        const name = statement.name;
        assertKnownOptions(
            statement.options,
            INTERSECTION_OPTION_NAMES,
            `求交 ${name}`,
        );
        const rawColor = findOption(statement.options, 'color');
        const color = rawColor !== undefined
            ? stripQuotes(rawColor)
            : NUMERIC_CONFIG.colorPalette[
                colorIndex % NUMERIC_CONFIG.colorPalette.length
            ];
        const segments =
            parseCappedPositiveInteger(
                findOption(statement.options, 'segments'),
                `求交 ${name} 的 segments`,
                NUMERIC_CONFIG.limits.intersection.maxSegments,
            )
            ?? NUMERIC_CONFIG.intersection.defaultSegments;
        colorIndex += 1;

        if (hiddenNames.has(name)) {
            results.push({
                name,
                aName: statement.a,
                bName: statement.b,
                points: [],
                curves: [],
                color,
                enabled: false,
            });
            continue;
        }

        const a = objects.get(statement.a);
        const b = objects.get(statement.b);
        if (!a) {
            throw new Error(`求交 ${name} 引用了不存在的对象 ${statement.a}`);
        }
        if (!b) {
            throw new Error(`求交 ${name} 引用了不存在的对象 ${statement.b}`);
        }
        if (statement.a === statement.b) {
            throw new Error(`求交 ${name} 的两个对象不能相同`);
        }
        if (!SUPPORTED_KINDS.has(a.kind)) {
            throw new Error(
                `求交 ${name} 不支持 ${a.kind} 类型的对象 ${statement.a}`,
            );
        }
        if (!SUPPORTED_KINDS.has(b.kind)) {
            throw new Error(
                `求交 ${name} 不支持 ${b.kind} 类型的对象 ${statement.b}`,
            );
        }

        const frameA = resolveObjectFrame(a, objectTransforms, objectAnimations, name);
        const frameB = resolveObjectFrame(b, objectTransforms, objectAnimations, name);
        const result = computeIntersection(
            a,
            frameA.matrix,
            frameA.inverse,
            b,
            frameB.matrix,
            frameB.inverse,
            segments,
        );

        results.push({
            name,
            aName: statement.a,
            bName: statement.b,
            points: result.points,
            curves: result.curves,
            color,
            enabled: true,
        });
    }

    return results;
}
