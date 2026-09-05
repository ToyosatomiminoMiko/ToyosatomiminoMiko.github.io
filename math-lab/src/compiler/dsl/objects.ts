/**
 * 对象 blueprint 构建与物化.
 *
 * 表达式在进入 blueprint 前统一经 Rust 符号引擎归一化,因此后续
 * 采样/积分/分析和渲染都直接消费 Rust/evalexpr 可执行的字符串.
 *
 * region(面积图形)实体:V1 只支持 x 型带状区域,不持有曲线几何拷贝,只按
 * 名引用两条边界 `curve`;后续规划(y 型 / 极坐标 r-θ / 多曲线边界 /
 * region 参与求交 / region 作为曲面底域)见 `compiler/ir/types.ts` 的
 * `RegionObject` 注释与 `prompt/feature.md`.
 */
import { NUMERIC_CONFIG } from '../../config/numericConfig';
import { RENDER_CONFIG } from '../../config/renderConfig';
import type { ObjectStatement } from '../ast/types';
import type {
    BoxObject,
    Coefficient,
    ConicSolidObject,
    CurveObject,
    ParamDeclaration,
    PointObject,
    RegionObject,
    SceneObject,
    SphereObject,
    SurfaceObject,
    VectorFieldObject,
    VectorObject,
} from '../ir/types';
import {
    assertKnownOptions,
    findOption,
    optionalNumber,
    parseCappedPositiveInteger,
    parseCappedPositiveIntegerList,
    parseNumberList,
    stripQuotes,
} from './options';
import { buildParamScope, createDefaultParam } from './params';
import {
    evaluateRequiredNumber,
    extractSymbolNames,
    normalizeExpression,
    parseArrayStrings,
    type ExpressionArray,
} from './expression';

const RENDER_CONFIG_VOLUME_OPACITY = RENDER_CONFIG.volume.defaultOpacity;

export type CurveBlueprint = {
    name: string;
    id: number;
    kind: 'curve';
    expr: string;
    coefficientNames: string[];
    color: string;
    range?: [number, number];
    segments?: number;
};

export type SurfaceBlueprint = {
    name: string;
    id: number;
    kind: 'surface';
    expr: string;
    coefficientNames: string[];
    color: string;
    range: [number, number, number, number];
    segments?: number;
};

export type VectorFieldBlueprint = {
    name: string;
    id: number;
    kind: 'vector_field';
    pExpr: string;
    qExpr: string;
    rExpr: string;
    coefficientNames: string[];
    color: string;
    gridSize: [number, number, number];
    range: {
        x: [number, number];
        y: [number, number];
        z: [number, number];
    };
    glyphScale: number;
};

export type PointBlueprint = {
    name: string;
    id: number;
    kind: 'point';
    expr: string;
    coordinateExprs: [string, string, string];
    color: string;
};

export type VectorBlueprint = {
    name: string;
    id: number;
    kind: 'vector';
    expr: string;
    originExprs: [string, string, string];
    directionExprs: [string, string, string];
    color: string;
};

export type SphereBlueprint = {
    name: string;
    id: number;
    kind: 'sphere';
    expr: string;
    positionExprs: [string, string, string];
    radiusExpr: string;
    coefficientNames: string[];
    color: string;
    segments: number;
    opacity: number;
};

export type BoxBlueprint = {
    name: string;
    id: number;
    kind: 'box';
    expr: string;
    positionExprs: [string, string, string];
    sizeExprs: [string, string, string];
    coefficientNames: string[];
    color: string;
    opacity: number;
};

export type ConicBlueprint = {
    name: string;
    id: number;
    kind: 'conic';
    expr: string;
    declaredKind: 'cylinder' | 'cone' | 'frustum';
    positionExprs: [string, string, string];
    baseExpr: string;
    heightExpr: string;
    topExpr?: string;
    angleExpr?: string;
    coefficientNames: string[];
    color: string;
    segments: number;
    opacity: number;
};

export type RegionBlueprint = {
    name: string;
    id: number;
    kind: 'region';
    /** 原始 DSL 表达式 `region(c1, c2)`(仅诊断保留,不做数学归一化). */
    expr: string;
    /** 两条边界曲线对象名(必须先声明为 curve). */
    curveAName: string;
    curveBName: string;
    /**
     * x 区间;来自显式 range 或两曲线 x-range 交集.
     * 解析在 blueprint 阶段完成,物化时直接落 IR.
     */
    range: [number, number];
    coefficientNames: string[];
    color: string;
    opacity: number;
    segments: number;
};

export type ObjectBlueprint =
    | CurveBlueprint
    | SurfaceBlueprint
    | VectorFieldBlueprint
    | PointBlueprint
    | VectorBlueprint
    | SphereBlueprint
    | BoxBlueprint
    | ConicBlueprint
    | RegionBlueprint;

export type CoefficientBlueprint = Exclude<
    ObjectBlueprint,
    PointBlueprint | VectorBlueprint
>;

/** 该 blueprint 是否携带自由参数列表(point/vector 没有). */
export function blueprintHasCoefficients(
    blueprint: ObjectBlueprint,
): blueprint is CoefficientBlueprint {
    return 'coefficientNames' in blueprint;
}

const CURVE_OPTION_NAMES = ['color', 'range', 'segments', 'transform', 'animation'] as const;
const SURFACE_OPTION_NAMES = ['color', 'range', 'segments', 'transform', 'animation'] as const;
const VECTOR_FIELD_OPTION_NAMES = ['color', 'range', 'grid', 'scale', 'transform', 'animation'] as const;
const POINT_OPTION_NAMES = ['color', 'transform', 'animation'] as const;
const VECTOR_OPTION_NAMES = ['color', 'transform', 'animation'] as const;
const SPHERE_OPTION_NAMES = ['color', 'radius', 'opacity', 'segments', 'transform', 'animation'] as const;
const BOX_OPTION_NAMES = ['color', 'size', 'opacity', 'transform', 'animation'] as const;
const CONIC_OPTION_NAMES = [
    'color',
    'base',
    'height',
    'angle',
    'top',
    'opacity',
    'segments',
    'transform',
    'animation',
] as const;
// region V1:只有外观/采样选项;transform/animation 由未知选项校验直接拒绝,
// 后续规划(极坐标/y 型/多边界等)见文件头与 RegionObject 注释.
const REGION_OPTION_NAMES = ['range', 'color', 'opacity', 'segments'] as const;

const REGION_REFERENCE_PATTERN = /^region\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*,\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)$/;

function arrayItems(value: ExpressionArray): ExpressionArray[] | null {
    return Array.isArray(value) ? value : null;
}

function stringItem(value: ExpressionArray): string | null {
    return typeof value === 'string' ? value : null;
}

function parseArrayItems(raw: string): ExpressionArray[] | null {
    try {
        return arrayItems(parseArrayStrings(raw));
    } catch {
        return null;
    }
}

function toExpressionTuple(items: ExpressionArray[]): [string, string, string] {
    return [
        stringItem(items[0]) ?? '',
        stringItem(items[1]) ?? '',
        stringItem(items[2]) ?? '',
    ];
}

function parseVectorComponents(raw: string): [string, string, string] {
    const items = parseArrayItems(raw);
    if (items && items.length === 3) {
        return toExpressionTuple(items);
    }
    throw new Error('vector_field 需要 [P, Q, R] 形式的向量表达式');
}

function parsePointComponents(raw: string, context: string): [string, string, string] {
    const items = parseArrayItems(raw);
    if (!items || items.length !== 3) {
        throw new Error(`${context} 需要 [x, y, z] 形式`);
    }
    return toExpressionTuple(items);
}

/** 解析 `region(c1, c2)` 形式的对象表达式,取回两条边界曲线名. */
function parseRegionReference(
    raw: string,
    context: string,
): { a: string; b: string } {
    const match = raw.trim().match(REGION_REFERENCE_PATTERN);
    if (!match) {
        throw new Error(`${context} 需要 region(曲线A, 曲线B) 形式`);
    }
    return { a: match[1], b: match[2] };
}

/** 解析一条 `[min, max]` 形式的 x 区间(range 选项),统一校验与报错. */
function parseXRange2(raw: string, context: string): [number, number] {
    const values = parseNumberList(raw, `${context} 的 range`);
    if (values.length !== 2) {
        throw new Error(`${context} 的 range 需要 2 个数值`);
    }
    if (values[0] >= values[1]) {
        throw new Error(`${context} 的 range 需要 min < max`);
    }
    return [values[0], values[1]];
}

/** 从 curve 声明语句读 x 区间;缺省取曲线默认 range. */
function curveRangeFromStatement(statement: ObjectStatement): [number, number] {
    const raw = findOption(statement.options, 'range');
    if (raw === undefined) {
        return [...NUMERIC_CONFIG.curve.defaultRange] as [number, number];
    }
    return parseXRange2(raw, `曲线 ${statement.name}`);
}

/** 两条边界曲线 x 区间交集;为空时报错(区域无定义带). */
function intersectCurveRanges(
    aRange: [number, number],
    bRange: [number, number],
    context: string,
): [number, number] {
    const lo = Math.max(aRange[0], bRange[0]);
    const hi = Math.min(aRange[1], bRange[1]);
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo >= hi) {
        throw new Error(
            `${context} 的两条边界曲线 x 区间没有交集,区域为空`,
        );
    }
    return [lo, hi];
}

function parseVectorObject(
    raw: string,
    context: string,
): {
    originExprs: [string, string, string];
    directionExprs: [string, string, string];
} {
    const items = parseArrayItems(raw);
    if (!items) {
        throw new Error(`${context} 需要 [dx, dy, dz] 或 [[x0,y0,z0],[dx,dy,dz]]`);
    }

    if (items.length === 3) {
        return {
            originExprs: ['0', '0', '0'],
            directionExprs: toExpressionTuple(items),
        };
    }

    if (items.length === 2) {
        const originItems = arrayItems(items[0]);
        const directionItems = arrayItems(items[1]);
        if (originItems?.length === 3 && directionItems?.length === 3) {
            return {
                originExprs: toExpressionTuple(originItems),
                directionExprs: toExpressionTuple(directionItems),
            };
        }
    }

    throw new Error(`${context} 需要 [dx, dy, dz] 或 [[x0,y0,z0],[dx,dy,dz]]`);
}

/**
 * 解析体积对象的透明度选项.
 *
 * 体积对象默认和积分可视化一样使用半透明材质;这里只接受 [0, 1] 的常量,
 * 不把 `opacity` 做成自由参数,因为透明度不需要参与数值计算.
 */
function parseOpacity(
    raw: string | undefined,
    context: string,
    defaultValue: number,
): number {
    const value = optionalNumber(raw, context) ?? defaultValue;
    if (value < 0 || value > 1) {
        throw new Error(`${context} 必须在 0 到 1 之间,当前为 ${value}`);
    }
    return value;
}

/**
 * 把 `size = 2` 或 `size = [2, 3, 4]` 统一成三轴表达式.
 *
 * 单个数值表示 cube,即三个轴共用同一个表达式.
 */
function parseSizeExpressions(raw: string, context: string): [string, string, string] {
    const items = parseArrayItems(raw);
    if (!items) {
        return [raw, raw, raw];
    }
    if (items.length === 1) {
        const scalar = stringItem(items[0]);
        if (!scalar) throw new Error(`${context} 包含无效元素`);
        return [scalar, scalar, scalar];
    }
    if (items.length === 3) {
        return toExpressionTuple(items);
    }
    throw new Error(`${context} 需要 1 个或 3 个分量,当前为 ${items.length} 个`);
}

/** 收集体积对象位置与几何参数里的自由参数,供 param 面板和增量刷新使用. */
function collectVolumeCoefficientNames(expressions: string[]): string[] {
    return extractCoefficientNames(expressions, new Set());
}

function extractCoefficientNames(
    expressions: string[],
    variables: ReadonlySet<string>,
): string[] {
    const names = new Set<string>();
    for (const expression of expressions) {
        for (const name of extractSymbolNames(expression, variables)) {
            names.add(name);
        }
    }
    return [...names];
}

function materializeCoefficients(
    names: string[],
    params: Map<string, ParamDeclaration>,
    overrides: Record<string, number>,
): Coefficient[] {
    return names.map((name) => {
        const declared = params.get(name) ?? createDefaultParam(name);
        return {
            name,
            value: overrides[name] ?? declared.value,
            min: declared.min,
            max: declared.max,
            step: declared.step,
        };
    });
}

export function buildObjectBlueprint(
    statement: ObjectStatement,
    id: number,
    statementsByName: ReadonlyMap<string, ObjectStatement> = new Map(),
): ObjectBlueprint | null {
    const color = stripQuotes(
        findOption(statement.options, 'color')
            ?? NUMERIC_CONFIG.colorPalette[id % NUMERIC_CONFIG.colorPalette.length],
    );

    switch (statement.kind) {
        case 'curve': {
            assertKnownOptions(statement.options, CURVE_OPTION_NAMES, `曲线 ${statement.name}`);
            const expr = normalizeExpression(statement.expr);
            const rawRange = findOption(statement.options, 'range');
            const range = rawRange
                ? parseXRange2(rawRange, `曲线 ${statement.name}`)
                : undefined;
            const segments = parseCappedPositiveInteger(
                findOption(statement.options, 'segments'),
                `曲线 ${statement.name} 的 segments`,
                NUMERIC_CONFIG.limits.curve.maxSegments,
            );
            return {
                name: statement.name,
                id,
                kind: 'curve',
                expr,
                coefficientNames: extractCoefficientNames([expr], new Set(['x'])),
                color,
                range,
                segments,
            };
        }

        case 'surface': {
            assertKnownOptions(statement.options, SURFACE_OPTION_NAMES, `曲面 ${statement.name}`);
            const expr = normalizeExpression(statement.expr);
            const rawRange = findOption(statement.options, 'range');
            const rangeValues = rawRange
                ? parseNumberList(rawRange, `曲面 ${statement.name} 的 range`)
                : [...NUMERIC_CONFIG.surface.defaultRange];
            if (rangeValues.length !== 4) {
                throw new Error(`曲面 ${statement.name} 的 range 需要 4 个数值`);
            }
            if (rangeValues[0] >= rangeValues[1] || rangeValues[2] >= rangeValues[3]) {
                throw new Error(`曲面 ${statement.name} 的 range 需要 min < max`);
            }
            const range = [
                rangeValues[0],
                rangeValues[1],
                rangeValues[2],
                rangeValues[3],
            ] as [number, number, number, number];
            const segments = parseCappedPositiveInteger(
                findOption(statement.options, 'segments'),
                `曲面 ${statement.name} 的 segments`,
                NUMERIC_CONFIG.limits.surface.maxSegments,
            );
            return {
                name: statement.name,
                id,
                kind: 'surface',
                expr,
                coefficientNames: extractCoefficientNames([expr], new Set(['x', 'y'])),
                color,
                range,
                segments,
            };
        }

        case 'vector_field': {
            assertKnownOptions(
                statement.options,
                VECTOR_FIELD_OPTION_NAMES,
                `向量场 ${statement.name}`,
            );
            const [pExpr, qExpr, rExpr] = parseVectorComponents(statement.expr);
            const rawRange = findOption(statement.options, 'range');
            const rangeValues = rawRange
                ? parseNumberList(rawRange, `向量场 ${statement.name} 的 range`)
                : [...NUMERIC_CONFIG.vectorField.defaultRange];
            if (rangeValues.length !== 6) {
                throw new Error(`向量场 ${statement.name} 的 range 需要 6 个数值`);
            }
            if (
                rangeValues[0] >= rangeValues[1]
                || rangeValues[2] >= rangeValues[3]
                || rangeValues[4] >= rangeValues[5]
            ) {
                throw new Error(`向量场 ${statement.name} 的 range 需要 min < max`);
            }
            const gridValues = parseCappedPositiveIntegerList(
                findOption(statement.options, 'grid')
                    ?? `[${NUMERIC_CONFIG.vectorField.defaultGrid.join(', ')}]`,
                `向量场 ${statement.name} 的 grid`,
                NUMERIC_CONFIG.limits.vectorField.maxAxisGrid,
                NUMERIC_CONFIG.limits.vectorField.maxTotalGridPoints,
            );
            if (gridValues.length !== 3) {
                throw new Error(`向量场 ${statement.name} 的 grid 需要 3 个数值`);
            }
            const glyphScale = optionalNumber(
                findOption(statement.options, 'scale'),
                `向量场 ${statement.name} 的 scale`,
            )
                ?? NUMERIC_CONFIG.vectorField.defaultGlyphScale;
            return {
                name: statement.name,
                id,
                kind: 'vector_field',
                pExpr,
                qExpr,
                rExpr,
                coefficientNames: extractCoefficientNames([pExpr, qExpr, rExpr], new Set(['x', 'y', 'z'])),
                color,
                gridSize: [gridValues[0], gridValues[1], gridValues[2]] as [number, number, number],
                range: {
                    x: [rangeValues[0], rangeValues[1]],
                    y: [rangeValues[2], rangeValues[3]],
                    z: [rangeValues[4], rangeValues[5]],
                },
                glyphScale,
            };
        }

        case 'point': {
            assertKnownOptions(statement.options, POINT_OPTION_NAMES, `点 ${statement.name}`);
            return {
                name: statement.name,
                id,
                kind: 'point',
                expr: statement.expr,
                coordinateExprs: parsePointComponents(statement.expr, `点 ${statement.name}`),
                color,
            };
        }

        case 'vector': {
            assertKnownOptions(statement.options, VECTOR_OPTION_NAMES, `向量 ${statement.name}`);
            const vector = parseVectorObject(statement.expr, `向量 ${statement.name}`);
            return {
                name: statement.name,
                id,
                kind: 'vector',
                expr: statement.expr,
                originExprs: vector.originExprs,
                directionExprs: vector.directionExprs,
                color,
            };
        }

        case 'sphere': {
            assertKnownOptions(statement.options, SPHERE_OPTION_NAMES, `球体 ${statement.name}`);
            const positionExprs = parsePointComponents(statement.expr, `球体 ${statement.name}`);
            const radiusExpr = findOption(statement.options, 'radius') ?? String(
                NUMERIC_CONFIG.volume.defaultSphereRadius,
            );
            const opacity = parseOpacity(
                findOption(statement.options, 'opacity'),
                `球体 ${statement.name} 的 opacity`,
                RENDER_CONFIG_VOLUME_OPACITY,
            );
            const segments = parseCappedPositiveInteger(
                findOption(statement.options, 'segments'),
                `球体 ${statement.name} 的 segments`,
                NUMERIC_CONFIG.limits.volume.maxRadialSegments,
            ) ?? NUMERIC_CONFIG.volume.defaultRadialSegments;
            return {
                name: statement.name,
                id,
                kind: 'sphere',
                expr: statement.expr,
                positionExprs,
                radiusExpr,
                coefficientNames: collectVolumeCoefficientNames([...positionExprs, radiusExpr]),
                color,
                segments,
                opacity,
            };
        }

        case 'box': {
            assertKnownOptions(statement.options, BOX_OPTION_NAMES, `方块 ${statement.name}`);
            const positionExprs = parsePointComponents(statement.expr, `方块 ${statement.name}`);
            const sizeExprs = parseSizeExpressions(
                findOption(statement.options, 'size') ?? `[${NUMERIC_CONFIG.volume.defaultBoxSize.join(', ')}]`,
                `方块 ${statement.name} 的 size`,
            );
            const opacity = parseOpacity(
                findOption(statement.options, 'opacity'),
                `方块 ${statement.name} 的 opacity`,
                RENDER_CONFIG_VOLUME_OPACITY,
            );
            return {
                name: statement.name,
                id,
                kind: 'box',
                expr: statement.expr,
                positionExprs,
                sizeExprs,
                coefficientNames: collectVolumeCoefficientNames([...positionExprs, ...sizeExprs]),
                color,
                opacity,
            };
        }

        case 'cylinder':
        case 'cone':
        case 'frustum': {
            assertKnownOptions(statement.options, CONIC_OPTION_NAMES, `旋转体 ${statement.name}`);
            const positionExprs = parsePointComponents(statement.expr, `旋转体 ${statement.name}`);
            const baseExpr = findOption(statement.options, 'base') ?? String(
                NUMERIC_CONFIG.volume.defaultConicBase,
            );
            const heightExpr = findOption(statement.options, 'height') ?? String(
                NUMERIC_CONFIG.volume.defaultConicHeight,
            );
            const topExpr = findOption(statement.options, 'top');
            const angleExpr = findOption(statement.options, 'angle');
            const opacity = parseOpacity(
                findOption(statement.options, 'opacity'),
                `旋转体 ${statement.name} 的 opacity`,
                RENDER_CONFIG_VOLUME_OPACITY,
            );
            const segments = parseCappedPositiveInteger(
                findOption(statement.options, 'segments'),
                `旋转体 ${statement.name} 的 segments`,
                NUMERIC_CONFIG.limits.volume.maxRadialSegments,
            ) ?? NUMERIC_CONFIG.volume.defaultRadialSegments;
            const declaredKind = statement.kind as 'cylinder' | 'cone' | 'frustum';
            return {
                name: statement.name,
                id,
                kind: 'conic',
                expr: statement.expr,
                declaredKind,
                positionExprs,
                baseExpr,
                heightExpr,
                topExpr,
                angleExpr,
                coefficientNames: collectVolumeCoefficientNames([
                    ...positionExprs,
                    baseExpr,
                    heightExpr,
                    ...(topExpr ? [topExpr] : []),
                    ...(angleExpr ? [angleExpr] : []),
                ]),
                color,
                segments,
                opacity,
            };
        }

        case 'region': {
            assertKnownOptions(statement.options, REGION_OPTION_NAMES, `区域 ${statement.name}`);
            const { a, b } = parseRegionReference(statement.expr, `区域 ${statement.name}`);
            if (a === b) {
                throw new Error(`区域 ${statement.name} 的两条边界曲线不能相同`);
            }
            const curveA = statementsByName.get(a);
            const curveB = statementsByName.get(b);
            if (!curveA) {
                throw new Error(`区域 ${statement.name} 引用了不存在的曲线 ${a}`);
            }
            if (!curveB) {
                throw new Error(`区域 ${statement.name} 引用了不存在的曲线 ${b}`);
            }
            if (curveA.kind !== 'curve' || curveB.kind !== 'curve') {
                throw new Error(
                    `区域 ${statement.name} 的边界必须是曲线(curve)对象`,
                );
            }
            const rawRange = findOption(statement.options, 'range');
            const range = rawRange
                ? parseXRange2(rawRange, `区域 ${statement.name}`)
                : intersectCurveRanges(
                    curveRangeFromStatement(curveA),
                    curveRangeFromStatement(curveB),
                    `区域 ${statement.name}`,
                );
            const opacity = parseOpacity(
                findOption(statement.options, 'opacity'),
                `区域 ${statement.name} 的 opacity`,
                RENDER_CONFIG_VOLUME_OPACITY,
            );
            const segments = parseCappedPositiveInteger(
                findOption(statement.options, 'segments'),
                `区域 ${statement.name} 的 segments`,
                NUMERIC_CONFIG.limits.region.maxSegments,
            ) ?? NUMERIC_CONFIG.region.defaultSegments;
            return {
                name: statement.name,
                id,
                kind: 'region',
                expr: statement.expr.trim(),
                curveAName: curveA.name,
                curveBName: curveB.name,
                range,
                coefficientNames: extractCoefficientNames(
                    [curveA.expr, curveB.expr],
                    new Set(['x']),
                ),
                color,
                opacity,
                segments,
            };
        }

        default:
            return null;
    }
}

export function materializeObject(
    blueprint: ObjectBlueprint,
    params: Map<string, ParamDeclaration>,
    overrides: Record<string, number>,
): SceneObject {
    switch (blueprint.kind) {
        case 'curve': {
            return {
                kind: 'curve',
                id: blueprint.id,
                name: blueprint.name,
                expr: blueprint.expr,
                coefficients: materializeCoefficients(blueprint.coefficientNames, params, overrides),
                color: blueprint.color,
                enabled: true,
                range: blueprint.range,
                segments: blueprint.segments,
            } satisfies CurveObject;
        }

        case 'surface': {
            return {
                kind: 'surface',
                id: blueprint.id,
                name: blueprint.name,
                expr: blueprint.expr,
                coefficients: materializeCoefficients(blueprint.coefficientNames, params, overrides),
                color: blueprint.color,
                enabled: true,
                range: blueprint.range,
                segments: blueprint.segments,
            } satisfies SurfaceObject;
        }

        case 'point': {
            const scope = buildParamScope(params, overrides);
            const [x, y, z] = blueprint.coordinateExprs.map((expr) =>
                evaluateRequiredNumber(expr, scope, `点 ${blueprint.name} 的坐标`),
            ) as [number, number, number];
            return {
                kind: 'point',
                id: blueprint.id,
                name: blueprint.name,
                expr: blueprint.expr,
                x,
                y,
                z,
                color: blueprint.color,
                enabled: true,
            } satisfies PointObject;
        }

        case 'vector': {
            const scope = buildParamScope(params, overrides);
            const [ox, oy, oz] = blueprint.originExprs.map((expr) =>
                evaluateRequiredNumber(expr, scope, `向量 ${blueprint.name} 的起点`),
            ) as [number, number, number];
            const [dx, dy, dz] = blueprint.directionExprs.map((expr) =>
                evaluateRequiredNumber(expr, scope, `向量 ${blueprint.name} 的方向`),
            ) as [number, number, number];
            return {
                kind: 'vector',
                id: blueprint.id,
                name: blueprint.name,
                expr: blueprint.expr,
                origin: { x: ox, y: oy, z: oz },
                direction: { x: dx, y: dy, z: dz },
                color: blueprint.color,
                enabled: true,
            } satisfies VectorObject;
        }

        case 'vector_field': {
            return {
                kind: 'vector_field',
                id: blueprint.id,
                name: blueprint.name,
                components: [blueprint.pExpr, blueprint.qExpr, blueprint.rExpr],
                coefficients: materializeCoefficients(blueprint.coefficientNames, params, overrides),
                color: blueprint.color,
                enabled: true,
                gridSize: blueprint.gridSize,
                range: blueprint.range,
                glyphScale: blueprint.glyphScale,
            } satisfies VectorFieldObject;
        }

        case 'sphere': {
            const scope = buildParamScope(params, overrides);
            const [x, y, z] = blueprint.positionExprs.map((expr) =>
                evaluateRequiredNumber(expr, scope, `球体 ${blueprint.name} 的中心`),
            ) as [number, number, number];
            const radius = evaluateRequiredNumber(
                blueprint.radiusExpr,
                scope,
                `球体 ${blueprint.name} 的 radius`,
            );
            if (radius <= 0) {
                throw new Error(`球体 ${blueprint.name} 的 radius 必须大于 0`);
            }
            return {
                kind: 'sphere',
                id: blueprint.id,
                name: blueprint.name,
                expr: blueprint.expr,
                position: { x, y, z },
                radius,
                coefficients: materializeCoefficients(blueprint.coefficientNames, params, overrides),
                color: blueprint.color,
                opacity: blueprint.opacity,
                segments: blueprint.segments,
                enabled: true,
            } satisfies SphereObject;
        }

        case 'box': {
            const scope = buildParamScope(params, overrides);
            const [x, y, z] = blueprint.positionExprs.map((expr) =>
                evaluateRequiredNumber(expr, scope, `方块 ${blueprint.name} 的中心`),
            ) as [number, number, number];
            const size = blueprint.sizeExprs.map((expr) =>
                evaluateRequiredNumber(expr, scope, `方块 ${blueprint.name} 的 size`),
            ) as [number, number, number];
            if (size.some((value) => value <= 0)) {
                throw new Error(`方块 ${blueprint.name} 的 size 每个分量都必须大于 0`);
            }
            return {
                kind: 'box',
                id: blueprint.id,
                name: blueprint.name,
                expr: blueprint.expr,
                position: { x, y, z },
                size,
                coefficients: materializeCoefficients(blueprint.coefficientNames, params, overrides),
                color: blueprint.color,
                opacity: blueprint.opacity,
                enabled: true,
            } satisfies BoxObject;
        }

        case 'conic': {
            const scope = buildParamScope(params, overrides);
            const [x, y, z] = blueprint.positionExprs.map((expr) =>
                evaluateRequiredNumber(expr, scope, `旋转体 ${blueprint.name} 的中心`),
            ) as [number, number, number];
            const baseRadius = evaluateRequiredNumber(
                blueprint.baseExpr,
                scope,
                `旋转体 ${blueprint.name} 的 base`,
            );
            const height = evaluateRequiredNumber(
                blueprint.heightExpr,
                scope,
                `旋转体 ${blueprint.name} 的 height`,
            );
            if (baseRadius <= 0) {
                throw new Error(`旋转体 ${blueprint.name} 的 base 必须大于 0`);
            }
            if (height <= 0) {
                throw new Error(`旋转体 ${blueprint.name} 的 height 必须大于 0`);
            }

            let topRadius: number;
            let sideAngle: number;
            if (blueprint.topExpr && blueprint.angleExpr) {
                throw new Error(
                    `旋转体 ${blueprint.name} 不能同时指定 top 和 angle,请二选一`,
                );
            }
            if (blueprint.topExpr) {
                topRadius = evaluateRequiredNumber(
                    blueprint.topExpr,
                    scope,
                    `旋转体 ${blueprint.name} 的 top`,
                );
                sideAngle = Math.atan((baseRadius - topRadius) / height);
            } else if (blueprint.angleExpr) {
                sideAngle = evaluateRequiredNumber(
                    blueprint.angleExpr,
                    scope,
                    `旋转体 ${blueprint.name} 的 angle`,
                );
                topRadius = baseRadius - height * Math.tan(sideAngle);
            } else if (blueprint.declaredKind === 'cylinder') {
                topRadius = baseRadius;
                sideAngle = 0;
            } else if (blueprint.declaredKind === 'cone') {
                topRadius = 0;
                sideAngle = Math.atan(baseRadius / height);
            } else {
                throw new Error(
                    `圆台 ${blueprint.name} 需要显式指定 top 或 angle`,
                );
            }

            // 数值误差下允许极小的越界;真正越界时宁可报错也不画一个反向/负数半径的畸形体.
            const epsilon = 1e-9;
            if (topRadius < -epsilon || topRadius > baseRadius + epsilon) {
                throw new Error(
                    `旋转体 ${blueprint.name} 的 top 半径 ${topRadius} 不在 [0, ${baseRadius}] 内`,
                );
            }
            topRadius = Math.min(baseRadius, Math.max(0, topRadius));

            return {
                kind: 'conic',
                id: blueprint.id,
                name: blueprint.name,
                expr: blueprint.expr,
                position: { x, y, z },
                baseRadius,
                topRadius,
                height,
                sideAngle,
                coefficients: materializeCoefficients(blueprint.coefficientNames, params, overrides),
                color: blueprint.color,
                opacity: blueprint.opacity,
                segments: blueprint.segments,
                enabled: true,
            } satisfies ConicSolidObject;
        }

        case 'region': {
            return {
                kind: 'region',
                id: blueprint.id,
                name: blueprint.name,
                curveAName: blueprint.curveAName,
                curveBName: blueprint.curveBName,
                range: blueprint.range,
                coefficients: materializeCoefficients(blueprint.coefficientNames, params, overrides),
                color: blueprint.color,
                opacity: blueprint.opacity,
                segments: blueprint.segments,
                enabled: true,
            } satisfies RegionObject;
        }
    }
}
