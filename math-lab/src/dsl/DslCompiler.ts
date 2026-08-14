import * as math from 'mathjs';
import type { MathNode } from 'mathjs';
import type { AstProgram, IntegralStatement, ObjectStatement, OptionPair } from '../ast/types';
import type {
    Coefficient,
    CurveExpr,
    MathObject,
    SurfaceExpr,
    VectorFieldExpr,
} from '../math_objects/types';
import { extractCoefficients } from '../math_objects/coefficientUtils';
import {
    identity4,
    multiply4x4,
    rotate4,
    scale4,
    translate4,
} from '../tensor/SceneTransform';

export interface ParamDeclaration {
    name: string;
    value: number;
    min: number;
    max: number;
    step: number;
}

export interface AnalysisResult {
    name: string;
    op: 'gradient' | 'divergence' | 'curl';
    point: [number, number, number];
    vector: [number, number, number];
    scalar: number | null;
    show: Array<'point' | 'normal' | 'tangent_plane'>;
}

export type IntegralMethod = 'trapezoid' | 'simpson' | 'riemann' | 'lebesgue';

export interface IntegralTask {
    name: string;
    objectId: number;
    sourceKind: 'curve' | 'surface';
    method: IntegralMethod;
    range: [number, number] | [number, number, number, number];
    segments: number;
    layers: number;
    show: boolean;
}

export interface CompiledScene {
    params: ParamDeclaration[];
    objects: MathObject[];
    objectTransforms: Map<number, number[][]>;
    analyses: AnalysisResult[];
    integrals: IntegralTask[];
}

type Mat4 = number[][];

const COLOR_PALETTE = ['#6dd5ff', '#ff6b8a', '#ffd93d', '#6bffb8', '#c084fc', '#fb923c'];
const INTEGRAL_METHODS = new Set<IntegralMethod>(['trapezoid', 'simpson', 'riemann', 'lebesgue']);
const SHOW_KINDS = new Set(['point', 'normal', 'tangent_plane']);

function findOption(options: OptionPair[], name: string): string | undefined {
    return options.find((item) => item.name === name)?.value;
}

function stripQuotes(value: string): string {
    return value.replace(/^["']|["']$/g, '');
}

function parseNumberList(raw: string): number[] {
    return raw.replace(/[[\]]/g, '').split(',').map((item) => Number(item.trim()));
}

function optionalNumber(raw: string | undefined): number | undefined {
    if (raw === undefined) return undefined;
    const value = Number(raw);
    return Number.isFinite(value) ? value : undefined;
}

function parseShowOption(options: OptionPair[]): Array<'point' | 'normal' | 'tangent_plane'> {
    const raw = findOption(options, 'show');
    if (!raw) return ['point', 'normal'];

    const items = raw
        .replace(/[[\]]/g, '')
        .split(',')
        .map((item) => item.trim())
        .filter((item): item is 'point' | 'normal' | 'tangent_plane' =>
            SHOW_KINDS.has(item),
        );
    return items.length > 0 ? items : ['point', 'normal'];
}

function splitTopLevel(source: string, separator: string): string[] {
    const parts: string[] = [];
    let start = 0;
    let parenDepth = 0;
    let bracketDepth = 0;

    for (let i = 0; i < source.length; i += 1) {
        const ch = source[i];
        if (ch === '(') parenDepth += 1;
        else if (ch === ')') parenDepth -= 1;
        else if (ch === '[') bracketDepth += 1;
        else if (ch === ']') bracketDepth -= 1;
        else if (ch === separator && parenDepth === 0 && bracketDepth === 0) {
            parts.push(source.slice(start, i));
            start = i + 1;
        }
    }

    parts.push(source.slice(start));
    return parts;
}

function collectParams(ast: AstProgram): Map<string, ParamDeclaration> {
    const params = new Map<string, ParamDeclaration>();
    for (const statement of ast.statements) {
        if (statement.type !== 'param') continue;
        params.set(statement.name, {
            name: statement.name,
            value: Number(statement.value) || 0,
            min: statement.ui ? Number(statement.ui.min) || -10 : -10,
            max: statement.ui ? Number(statement.ui.max) || 10 : 10,
            step: statement.ui ? Number(statement.ui.step) || 0.1 : 0.1,
        });
    }
    return params;
}

function applyParamOverrides(
    params: Map<string, ParamDeclaration>,
    overrides: Record<string, number>,
): void {
    for (const [name, value] of Object.entries(overrides)) {
        const param = params.get(name);
        if (param) param.value = value;
    }
}

function buildCoefficients(
    nodes: MathNode[],
    variables: Set<string>,
    params: Map<string, ParamDeclaration>,
    overrides: Record<string, number>,
): Coefficient[] {
    const names = new Set<string>();
    for (const node of nodes) {
        for (const coefficient of extractCoefficients(node, variables)) {
            names.add(coefficient.name);
        }
    }

    return [...names].map((name) => {
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

function parseVectorComponents(raw: string): [MathNode, MathNode, MathNode] {
    const node = math.parse(raw);
    if (node.type === 'ArrayNode') {
        const items = (node as unknown as { items: MathNode[] }).items;
        if (items.length >= 3) {
            return [items[0], items[1], items[2]];
        }
    }
    throw new Error('vector_field 需要 [P, Q, R] 形式的向量表达式');
}

function compileObject(
    statement: ObjectStatement,
    id: number,
    params: Map<string, ParamDeclaration>,
    overrides: Record<string, number>,
): MathObject | null {
    const color = stripQuotes(findOption(statement.options, 'color') ?? COLOR_PALETTE[id % COLOR_PALETTE.length]);

    if (statement.kind === 'curve') {
        const node = math.parse(statement.expr);
        const rawRange = findOption(statement.options, 'range');
        const rangeValues = rawRange ? parseNumberList(rawRange) : [];
        const range = rawRange
            ? [rangeValues[0] ?? -8, rangeValues[1] ?? 8] as [number, number]
            : undefined;
        const segments = optionalNumber(findOption(statement.options, 'segments'));
        const coefficients = buildCoefficients([node], new Set(['x']), params, overrides);

        return {
            kind: 'curve',
            id,
            node,
            coefficients,
            color,
            enabled: true,
            range,
            segments,
        } satisfies CurveExpr;
    }

    if (statement.kind === 'surface') {
        const node = math.parse(statement.expr);
        const rawRange = findOption(statement.options, 'range');
        const rangeValues = rawRange ? parseNumberList(rawRange) : [-6, 6, -6, 6];
        const range = [
            rangeValues[0] ?? -6,
            rangeValues[1] ?? 6,
            rangeValues[2] ?? -6,
            rangeValues[3] ?? 6,
        ] as [number, number, number, number];
        const segments = optionalNumber(findOption(statement.options, 'segments'));
        const coefficients = buildCoefficients([node], new Set(['x', 'y']), params, overrides);

        return {
            kind: 'surface',
            id,
            node,
            coefficients,
            color,
            enabled: true,
            range,
            segments,
        } satisfies SurfaceExpr;
    }

    if (statement.kind === 'vector_field') {
        const [nodeP, nodeQ, nodeR] = parseVectorComponents(statement.expr);
        const rawRange = findOption(statement.options, 'range');
        const rangeValues = rawRange ? parseNumberList(rawRange) : [-4, 4, -4, 4, -4, 4];
        const gridValues = parseNumberList(findOption(statement.options, 'grid') ?? '[8, 8, 8]');
        const glyphScale = optionalNumber(findOption(statement.options, 'scale')) ?? 1.2;
        const coefficients = buildCoefficients([nodeP, nodeQ, nodeR], new Set(['x', 'y', 'z']), params, overrides);

        return {
            kind: 'vector_field',
            id,
            components: [nodeP.toString(), nodeQ.toString(), nodeR.toString()],
            nodeP,
            nodeQ,
            nodeR,
            coefficients,
            color,
            enabled: true,
            gridSize: [gridValues[0] ?? 8, gridValues[1] ?? 8, gridValues[2] ?? 8] as [number, number, number],
            range: {
                x: [rangeValues[0] ?? -4, rangeValues[1] ?? 4],
                y: [rangeValues[2] ?? -4, rangeValues[3] ?? 4],
                z: [rangeValues[4] ?? -4, rangeValues[5] ?? 4],
            },
            glyphScale,
        } satisfies VectorFieldExpr;
    }

    return null;
}

// ============================================================
//  场景变换
// ============================================================

function cloneMat4(matrix: Mat4): Mat4 {
    return matrix.map((row) => [...row]);
}

function evaluateNumber(raw: string, scope?: Record<string, number>): number | null {
    try {
        const value = scope === undefined ? math.evaluate(raw) : math.evaluate(raw, scope);
        return typeof value === 'number' && Number.isFinite(value) ? value : null;
    } catch {
        return null;
    }
}

function evaluateMatrix(raw: string): Mat4 | null {
    try {
        const value = math.evaluate(raw) as unknown;
        const rows = value && typeof (value as { toArray?: () => unknown }).toArray === 'function'
            ? (value as { toArray: () => unknown }).toArray()
            : value;

        if (Array.isArray(rows) && rows.length === 4) {
            const matrix = rows.map((row) => (Array.isArray(row) ? row.map(Number) : []));
            if (matrix.every((row) => row.length === 4)) return matrix as Mat4;
        }
    } catch {
        return null;
    }
    return null;
}

function parseTransformFunction(part: string): Mat4 | null {
    const match = /^(translate|scale|rotate)\s*\(\s*\[([^\]]*)\]\s*\)$/.exec(part);
    if (!match) return null;

    const values = match[2].split(',').map((item) => evaluateNumber(item.trim()));
    if (values.some((value) => value === null) || values.length < 3) return null;
    const numbers = values as number[];

    if (match[1] === 'translate') return translate4(numbers);
    if (match[1] === 'scale') return scale4(numbers);
    return rotate4(numbers);
}

function parseTransformExpression(raw: string, matrices: Map<string, Mat4>): Mat4 | null {
    const expression = raw.trim();
    const asTransformMatch = /^as_transform\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)$/.exec(expression);
    if (asTransformMatch) {
        const matrix = matrices.get(asTransformMatch[1]);
        return matrix ? cloneMat4(matrix) : null;
    }

    const parts = splitTopLevel(expression, '*').map((part) => part.trim());
    if (parts.length === 0) return null;

    let result = identity4();
    for (const part of parts) {
        const matrix = parseTransformFunction(part);
        if (!matrix) return null;
        result = multiply4x4(result, matrix);
    }
    return result;
}

function resolveObjectTransform(
    raw: string | undefined,
    transforms: Map<string, Mat4>,
    matrices: Map<string, Mat4>,
): Mat4 | null {
    if (!raw) return null;
    const value = raw.trim();

    const asTransformMatch = /^as_transform\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)$/.exec(value);
    if (asTransformMatch) {
        const matrix = matrices.get(asTransformMatch[1]);
        return matrix ? cloneMat4(matrix) : null;
    }

    const transform = transforms.get(value);
    return transform ? cloneMat4(transform) : null;
}

function evaluateDerivative(node: MathNode, variable: string, scope: Record<string, number>): number {
    const derivative = math.derivative(node, variable);
    const value = derivative.compile().evaluate(scope);
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function normalizeVector(vector: [number, number, number]): [number, number, number] {
    const [x, y, z] = vector;
    const length = Math.sqrt(x * x + y * y + z * z);
    return length < 1e-12 ? [0, 0, 0] : [x / length, y / length, z / length];
}

function compileAnalyses(
    ast: AstProgram,
    objectByName: Map<string, MathObject>,
    params: Map<string, ParamDeclaration>,
): AnalysisResult[] {
    const results: AnalysisResult[] = [];

    for (const statement of ast.statements) {
        if (statement.type !== 'analysis') continue;

        const source = objectByName.get(statement.source.trim());
        if (!source) {
            throw new Error(`分析 ${statement.name} 引用了不存在的对象 ${statement.source}`);
        }

        if (statement.op === 'jacobian' || statement.op === 'laplacian') {
            throw new Error(`分析算子 ${statement.op} 暂未实现`);
        }

        const atScope: Record<string, number> = {};
        for (const [name, param] of params) atScope[name] = param.value;
        if (source.kind === 'curve' || source.kind === 'surface' || source.kind === 'vector_field') {
            for (const coefficient of source.coefficients) {
                atScope[coefficient.name] = coefficient.value;
            }
        }

        const rawAt = statement.at ?? [];
        const atValues = rawAt.map((raw) => evaluateNumber(raw, atScope) ?? 0);
        const at: [number, number, number] = [
            atValues[0] ?? 0,
            atValues[1] ?? 0,
            atValues[2] ?? 0,
        ];
        const scope: Record<string, number> = { ...atScope, x: at[0], y: at[1], z: at[2] };
        const show = parseShowOption(statement.options);

        if (statement.op === 'gradient' && (source.kind === 'curve' || source.kind === 'surface')) {
            const fx = evaluateDerivative(source.node, 'x', scope);
            const fy = evaluateDerivative(source.node, 'y', scope);
            const f0 = source.node.compile().evaluate(scope) as number;
            const vector = normalizeVector([-fx, -fy, 1]);
            results.push({ name: statement.name, op: 'gradient', point: [at[0], at[1], f0], vector, scalar: f0, show });
            continue;
        }

        if ((statement.op === 'divergence' || statement.op === 'curl') && source.kind === 'vector_field') {
            const dPdx = evaluateDerivative(source.nodeP, 'x', scope);
            const dQdy = evaluateDerivative(source.nodeQ, 'y', scope);
            const dRdz = evaluateDerivative(source.nodeR, 'z', scope);

            if (statement.op === 'divergence') {
                const scalar = dPdx + dQdy + dRdz;
                results.push({ name: statement.name, op: 'divergence', point: at, vector: [0, 0, 0], scalar, show });
            } else {
                const dRdy = evaluateDerivative(source.nodeR, 'y', scope);
                const dQdz = evaluateDerivative(source.nodeQ, 'z', scope);
                const dPdz = evaluateDerivative(source.nodeP, 'z', scope);
                const dRdx = evaluateDerivative(source.nodeR, 'x', scope);
                const dQdx = evaluateDerivative(source.nodeQ, 'x', scope);
                const dPdy = evaluateDerivative(source.nodeP, 'y', scope);
                const vector: [number, number, number] = [
                    dRdy - dQdz,
                    dPdz - dRdx,
                    dQdx - dPdy,
                ];
                results.push({ name: statement.name, op: 'curl', point: at, vector, scalar: null, show });
            }
            continue;
        }

        throw new Error(
            `分析算子 ${statement.op} 不能应用于 ${source.kind} 类型对象`,
        );
    }

    return results;
}

function compileIntegralTask(
    statement: IntegralStatement,
    objectByName: Map<string, MathObject>,
): IntegralTask {
    const source = objectByName.get(statement.source.trim());
    if (!source) {
        throw new Error(`积分 ${statement.name} 引用了不存在的对象 ${statement.source}`);
    }
    if (source.kind !== 'curve' && source.kind !== 'surface') {
        throw new Error(`积分 ${statement.name} 只能应用于 curve 或 surface`);
    }

    const rawMethod = findOption(statement.options, 'method') ?? 'riemann';
    if (!INTEGRAL_METHODS.has(rawMethod as IntegralMethod)) {
        throw new Error(`未知积分方法: ${rawMethod}`);
    }
    const method = rawMethod as IntegralMethod;

    const rawRange = findOption(statement.options, 'range');
    const rangeValues = rawRange ? parseNumberList(rawRange) : [];
    const range =
        source.kind === 'curve'
            ? ([rangeValues[0] ?? -4, rangeValues[1] ?? 4] as [number, number])
            : ([
                rangeValues[0] ?? -3,
                rangeValues[1] ?? 3,
                rangeValues[2] ?? -3,
                rangeValues[3] ?? 3,
            ] as [number, number, number, number]);

    if (source.kind === 'curve') {
        const [a, b] = range as [number, number];
        if (a >= b) {
            throw new Error(`积分 ${statement.name} 需要有效的一维区间 a < b`);
        }
    } else {
        const [xMin, xMax, yMin, yMax] = range as [number, number, number, number];
        if (xMin >= xMax || yMin >= yMax) {
            throw new Error(`积分 ${statement.name} 需要有效的二维区间`);
        }
    }

    const segments = optionalNumber(findOption(statement.options, 'segments')) ?? 32;
    const layers = optionalNumber(findOption(statement.options, 'layers')) ?? Math.min(32, segments);
    const show = findOption(statement.options, 'show') !== 'false';

    return {
        name: statement.name,
        objectId: source.id,
        sourceKind: source.kind,
        method,
        range,
        segments,
        layers,
        show,
    };
}

export function compileScene(ast: AstProgram, paramOverrides: Record<string, number> = {}): CompiledScene {
    const params = collectParams(ast);
    const matrices = new Map<string, Mat4>();
    const transforms = new Map<string, Mat4>();
    const objects: MathObject[] = [];
    const objectTransforms = new Map<number, Mat4>();
    const integrals: IntegralTask[] = [];

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
            const transform = parseTransformExpression(statement.expr, matrices);
            if (transform) transforms.set(statement.name, transform);
            else throw new Error(`变换 ${statement.name} 无法求值`);
        }
    }

    const objectByName = new Map<string, MathObject>();
    let nextId = 1;
    for (const statement of ast.statements) {
        if (statement.type === 'object') {
            const object = compileObject(statement, nextId, params, paramOverrides);
            if (object) {
                objects.push(object);
                objectByName.set(statement.name, object);
                const transform = resolveObjectTransform(
                    findOption(statement.options, 'transform'),
                    transforms,
                    matrices,
                );
                if (transform) objectTransforms.set(object.id, transform);
                nextId += 1;
            }
        }
    }

    for (const object of objects) {
        if (object.kind !== 'curve' && object.kind !== 'surface' && object.kind !== 'vector_field') continue;
        for (const coefficient of object.coefficients) {
            if (!params.has(coefficient.name)) {
                params.set(coefficient.name, {
                    name: coefficient.name,
                    value: coefficient.value,
                    min: coefficient.min,
                    max: coefficient.max,
                    step: coefficient.step,
                });
            }
        }
    }

    applyParamOverrides(params, paramOverrides);

    for (const statement of ast.statements) {
        if (statement.type !== 'integral') continue;
        integrals.push(compileIntegralTask(statement, objectByName));
    }

    return {
        params: [...params.values()],
        objects,
        objectTransforms,
        analyses: compileAnalyses(ast, objectByName, params),
        integrals,
    };
}
