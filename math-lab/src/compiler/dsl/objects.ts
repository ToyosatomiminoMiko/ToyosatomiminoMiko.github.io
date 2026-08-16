/**
 * 对象 blueprint 构建与物化。
 * 负责把 AST 中的 curve/surface/vector_field/point/vector 声明
 * 转成可反复物化的中间表示，再按当前参数生成 SceneObject。
 */
import * as math from 'mathjs';
import type { MathNode } from 'mathjs';
import type { ObjectStatement } from '../ast/types';
import type {
    Coefficient,
    CurveObject,
    ParamDeclaration,
    PointObject,
    SceneObject,
    SurfaceObject,
    VectorFieldObject,
    VectorObject,
} from '../ir/types';
import { extractCoefficients } from '../../math/objects/coefficientUtils';
import {
    findOption,
    optionalNumber,
    parseNumberList,
    parsePositiveInteger,
    parsePositiveIntegerList,
    stripQuotes,
} from './options';
import { buildParamScope } from './params';
import { evaluateRequiredNumber } from './expression';

const COLOR_PALETTE = ['#6dd5ff', '#ff6b8a', '#ffd93d', '#6bffb8', '#c084fc', '#fb923c'];

export type CurveBlueprint = {
    name: string;
    id: number;
    kind: 'curve';
    node: MathNode;
    coefficientNames: string[];
    color: string;
    range?: [number, number];
    segments?: number;
};

export type SurfaceBlueprint = {
    name: string;
    id: number;
    kind: 'surface';
    node: MathNode;
    coefficientNames: string[];
    color: string;
    range: [number, number, number, number];
    segments?: number;
};

export type VectorFieldBlueprint = {
    name: string;
    id: number;
    kind: 'vector_field';
    nodeP: MathNode;
    nodeQ: MathNode;
    nodeR: MathNode;
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
    coordinateExprs: [string, string, string];
    color: string;
};

export type VectorBlueprint = {
    name: string;
    id: number;
    kind: 'vector';
    originExprs: [string, string, string];
    directionExprs: [string, string, string];
    color: string;
};

export type ObjectBlueprint =
    | CurveBlueprint
    | SurfaceBlueprint
    | VectorFieldBlueprint
    | PointBlueprint
    | VectorBlueprint;

function parseArrayItems(raw: string): MathNode[] | null {
    const node = math.parse(raw);
    if (node.type !== 'ArrayNode') return null;
    return (node as unknown as { items: MathNode[] }).items;
}

function toExpressionTuple(items: MathNode[]): [string, string, string] {
    return [items[0].toString(), items[1].toString(), items[2].toString()];
}

function parseVectorComponents(raw: string): [MathNode, MathNode, MathNode] {
    const items = parseArrayItems(raw);
    if (items && items.length === 3) {
        return [items[0], items[1], items[2]];
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
        // 新语法决定：单数组表示默认从原点出发的方向向量。
        // 后续若需要“位置向量”或“起点缺省为上一个点”等语义，需要另加语法，避免歧义。
        return {
            originExprs: ['0', '0', '0'],
            directionExprs: toExpressionTuple(items),
        };
    }

    if (items.length === 2) {
        const originItems = items[0].type === 'ArrayNode'
            ? (items[0] as unknown as { items: MathNode[] }).items
            : null;
        const directionItems = items[1].type === 'ArrayNode'
            ? (items[1] as unknown as { items: MathNode[] }).items
            : null;
        if (originItems?.length === 3 && directionItems?.length === 3) {
            return {
                originExprs: toExpressionTuple(originItems),
                directionExprs: toExpressionTuple(directionItems),
            };
        }
    }

    throw new Error(`${context} 需要 [dx, dy, dz] 或 [[x0,y0,z0],[dx,dy,dz]]`);
}

function extractCoefficientNames(nodes: MathNode[], variables: Set<string>): string[] {
    const names = new Set<string>();
    for (const node of nodes) {
        for (const coefficient of extractCoefficients(node, variables)) {
            names.add(coefficient.name);
        }
    }
    return [...names];
}

export function materializeCoefficients(
    names: string[],
    params: Map<string, ParamDeclaration>,
    overrides: Record<string, number>,
): Coefficient[] {
    return names.map((name) => {
        const declared = params.get(name);
        return {
            name,
            value: overrides[name] ?? declared?.value ?? 1,
            min: declared?.min ?? -10,
            max: declared?.max ?? 10,
            step: declared?.step ?? 0.1,
        };
    });
}

export function buildObjectBlueprint(
    statement: ObjectStatement,
    id: number,
): ObjectBlueprint | null {
    const color = stripQuotes(findOption(statement.options, 'color') ?? COLOR_PALETTE[id % COLOR_PALETTE.length]);

    if (statement.kind === 'curve') {
        const node = math.parse(statement.expr);
        const rawRange = findOption(statement.options, 'range');
        let range: [number, number] | undefined;
        if (rawRange) {
            const rangeValues = parseNumberList(rawRange, `曲线 ${statement.name} 的 range`);
            if (rangeValues.length !== 2) {
                throw new Error(`曲线 ${statement.name} 的 range 需要 2 个数值`);
            }
            if (rangeValues[0] >= rangeValues[1]) {
                throw new Error(`曲线 ${statement.name} 的 range 需要 min < max`);
            }
            range = [rangeValues[0], rangeValues[1]];
        }
        const segments = parsePositiveInteger(
            findOption(statement.options, 'segments'),
            `曲线 ${statement.name} 的 segments`,
        );
        return {
            name: statement.name,
            id,
            kind: 'curve',
            node,
            coefficientNames: extractCoefficientNames([node], new Set(['x'])),
            color,
            range,
            segments,
        };
    }

    if (statement.kind === 'surface') {
        const node = math.parse(statement.expr);
        const rawRange = findOption(statement.options, 'range');
        const rangeValues = rawRange
            ? parseNumberList(rawRange, `曲面 ${statement.name} 的 range`)
            : [-6, 6, -6, 6];
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
        const segments = parsePositiveInteger(
            findOption(statement.options, 'segments'),
            `曲面 ${statement.name} 的 segments`,
        );
        return {
            name: statement.name,
            id,
            kind: 'surface',
            node,
            coefficientNames: extractCoefficientNames([node], new Set(['x', 'y'])),
            color,
            range,
            segments,
        };
    }

    if (statement.kind === 'vector_field') {
        const [nodeP, nodeQ, nodeR] = parseVectorComponents(statement.expr);
        const rawRange = findOption(statement.options, 'range');
        const rangeValues = rawRange
            ? parseNumberList(rawRange, `向量场 ${statement.name} 的 range`)
            : [-4, 4, -4, 4, -4, 4];
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
        const gridValues = parsePositiveIntegerList(
            findOption(statement.options, 'grid') ?? '[8, 8, 8]',
            `向量场 ${statement.name} 的 grid`,
        );
        if (gridValues.length !== 3) {
            throw new Error(`向量场 ${statement.name} 的 grid 需要 3 个数值`);
        }
        const glyphScale = optionalNumber(findOption(statement.options, 'scale')) ?? 1.2;
        return {
            name: statement.name,
            id,
            kind: 'vector_field',
            nodeP,
            nodeQ,
            nodeR,
            coefficientNames: extractCoefficientNames([nodeP, nodeQ, nodeR], new Set(['x', 'y', 'z'])),
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

    if (statement.kind === 'point') {
        return {
            name: statement.name,
            id,
            kind: 'point',
            coordinateExprs: parsePointComponents(statement.expr, `点 ${statement.name}`),
            color,
        };
    }

    if (statement.kind === 'vector') {
        const vector = parseVectorObject(statement.expr, `向量 ${statement.name}`);
        return {
            name: statement.name,
            id,
            kind: 'vector',
            originExprs: vector.originExprs,
            directionExprs: vector.directionExprs,
            color,
        };
    }

    return null;
}

export function materializeObject(
    blueprint: ObjectBlueprint,
    params: Map<string, ParamDeclaration>,
    overrides: Record<string, number>,
): SceneObject {
    if (blueprint.kind === 'curve') {
        return {
            kind: 'curve',
            id: blueprint.id,
            name: blueprint.name,
            expr: blueprint.node.toString(),
            coefficients: materializeCoefficients(blueprint.coefficientNames, params, overrides),
            color: blueprint.color,
            enabled: true,
            range: blueprint.range,
            segments: blueprint.segments,
        } satisfies CurveObject;
    }

    if (blueprint.kind === 'surface') {
        return {
            kind: 'surface',
            id: blueprint.id,
            name: blueprint.name,
            expr: blueprint.node.toString(),
            coefficients: materializeCoefficients(blueprint.coefficientNames, params, overrides),
            color: blueprint.color,
            enabled: true,
            range: blueprint.range,
            segments: blueprint.segments,
        } satisfies SurfaceObject;
    }

    if (blueprint.kind === 'point') {
        // point/vector 目前走 param scope，不进入系数提取与参数面板；
        // 后续若要像 curve/surface 一样可调系数，需要给 IR 增加 coefficients 字段。
        const scope = buildParamScope(params, overrides);
        const [x, y, z] = blueprint.coordinateExprs.map((expr) =>
            evaluateRequiredNumber(expr, scope, `点 ${blueprint.name} 的坐标`),
        ) as [number, number, number];
        return {
            kind: 'point',
            id: blueprint.id,
            name: blueprint.name,
            x,
            y,
            z,
            color: blueprint.color,
            enabled: true,
        } satisfies PointObject;
    }

    if (blueprint.kind === 'vector') {
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
            origin: { x: ox, y: oy, z: oz },
            direction: { x: dx, y: dy, z: dz },
            color: blueprint.color,
            enabled: true,
        } satisfies VectorObject;
    }

    return {
        kind: 'vector_field',
        id: blueprint.id,
        name: blueprint.name,
        components: [blueprint.nodeP.toString(), blueprint.nodeQ.toString(), blueprint.nodeR.toString()],
        coefficients: materializeCoefficients(blueprint.coefficientNames, params, overrides),
        color: blueprint.color,
        enabled: true,
        gridSize: blueprint.gridSize,
        range: blueprint.range,
        glyphScale: blueprint.glyphScale,
    } satisfies VectorFieldObject;
}
