import * as math from 'mathjs';
import type { MathNode } from 'mathjs';
import type { AstProgram, IntegralStatement, ObjectStatement, OptionPair } from '../ast/types';
import type {
    Coefficient,
    CurveObject,
    AnalysisResult,
    IntegralMethod,
    IntegralTask,
    ParamDeclaration,
    SceneIR,
    SceneObject,
    SurfaceObject,
    VectorFieldObject,
} from '../ir/types';
import { extractCoefficients } from '../../math/objects/coefficientUtils';
import {
    jsMatrixOps,
    type MatrixOps,
} from '../../math/tensor/SceneTransform';
import {
    evaluate_curl_point as wasmEvaluateCurlPoint,
    evaluate_divergence_point as wasmEvaluateDivergencePoint,
    evaluate_gradient_point as wasmEvaluateGradientPoint,
} from '../../wasm/ml_wasm';

type Mat4 = number[][];

const COLOR_PALETTE = ['#6dd5ff', '#ff6b8a', '#ffd93d', '#6bffb8', '#c084fc', '#fb923c'];
const INTEGRAL_METHODS = new Set<IntegralMethod>(['trapezoid', 'simpson', 'riemann', 'lebesgue']);
const SHOW_KINDS = new Set(['point', 'normal', 'tangent_plane']);

/**
 * DslCompiler 的职责边界:
 *
 * AstProgram (Rust pest 输出的纯声明)
 *   -> 静态场景建模:params / matrix / transform / object blueprint
 *   -> 每次参数刷新时 materialize 成 SceneIR
 *
 * 这里只做“声明级”编译:
 *   - 对象表达式仍保留为 mathjs MathNode / 字符串;
 *   - 曲线、曲面、向量场的实际采样由各自 renderer / worker 负责;
 *   - 梯度、散度、旋度在这里由 mathjs 做符号求导,再交给 WASM 数值求值.
 */
type CurveBlueprint = {
    name: string;
    id: number;
    kind: 'curve';
    node: MathNode;
    coefficientNames: string[];
    color: string;
    range?: [number, number];
    segments?: number;
};

type SurfaceBlueprint = {
    name: string;
    id: number;
    kind: 'surface';
    node: MathNode;
    coefficientNames: string[];
    color: string;
    range: [number, number, number, number];
    segments?: number;
};

type VectorFieldBlueprint = {
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

type ObjectBlueprint = CurveBlueprint | SurfaceBlueprint | VectorFieldBlueprint;

type StaticScene = {
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

function findOption(options: OptionPair[], name: string): string | undefined {
    return options.find((item) => item.name === name)?.value;
}

function stripQuotes(value: string): string {
    return value.replace(/^["']|["']$/g, '');
}

function parseNumberList(raw: string, context: string): number[] {
    const body = raw.trim();
    if (!body) {
        throw new Error(`${context} 不能为空`);
    }
    const items = body.replace(/[[\]]/g, '').split(',');
    if (items.length === 0 || items.some((item) => item.trim() === '')) {
        throw new Error(`${context} 包含空元素: ${raw}`);
    }
    const values = items.map((item) => Number(item.trim()));
    if (values.some((value) => !Number.isFinite(value))) {
        throw new Error(`${context} 不是有效的数字列表: ${raw}`);
    }
    return values;
}

function optionalNumber(raw: string | undefined): number | undefined {
    if (raw === undefined) return undefined;
    const value = Number(raw);
    return Number.isFinite(value) ? value : undefined;
}

function parsePositiveInteger(raw: string | undefined, context: string): number | undefined {
    if (raw === undefined) return undefined;
    const value = Number(raw);
    if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`${context} 必须是正整数,当前为 ${raw}`);
    }
    return value;
}

function parsePositiveIntegerList(raw: string, context: string): number[] {
    const values = parseNumberList(raw, context);
    if (values.some((value) => !Number.isInteger(value) || value <= 0)) {
        throw new Error(`${context} 中的每个值都必须是正整数: ${raw}`);
    }
    return values;
}

function toFiniteNumber(raw: string, context: string): number {
    const value = Number(raw);
    if (!Number.isFinite(value)) {
        throw new Error(`${context} 不是有效数字: ${raw}`);
    }
    return value;
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
            value: toFiniteNumber(statement.value, `参数 ${statement.name} 的 value`),
            min: statement.ui ? toFiniteNumber(statement.ui.min, `参数 ${statement.name} 的 min`) : -10,
            max: statement.ui ? toFiniteNumber(statement.ui.max, `参数 ${statement.name} 的 max`) : 10,
            step: statement.ui ? toFiniteNumber(statement.ui.step, `参数 ${statement.name} 的 step`) : 0.1,
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

function parseVectorComponents(raw: string): [MathNode, MathNode, MathNode] {
    const node = math.parse(raw);
    if (node.type === 'ArrayNode') {
        const items = (node as unknown as { items: MathNode[] }).items;
        if (items.length === 3) {
            return [items[0], items[1], items[2]];
        }
    }
    throw new Error('vector_field 需要 [P, Q, R] 形式的向量表达式');
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

function materializeCoefficients(
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

function buildObjectBlueprint(
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

    return null;
}

function materializeObject(
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

function cloneParams(params: Map<string, ParamDeclaration>): Map<string, ParamDeclaration> {
    const clone = new Map<string, ParamDeclaration>();
    for (const [name, param] of params) {
        clone.set(name, { ...param });
    }
    return clone;
}

function cloneObjectTransforms(transforms: Map<number, Mat4>): Record<number, Mat4> {
    const clone: Record<number, Mat4> = {};
    for (const [id, matrix] of transforms) {
        clone[id] = cloneMat4(matrix);
    }
    return clone;
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
            if (
                matrix.every(
                    (row) => row.length === 4 && row.every((entry) => Number.isFinite(entry)),
                )
            ) {
                return matrix as Mat4;
            }
        }
    } catch {
        return null;
    }
    return null;
}

function parseTransformFunction(part: string, ops: MatrixOps): Mat4 | null {
    const match = /^(translate|scale|rotate)\s*\(\s*\[([^\]]*)\]\s*\)$/.exec(part);
    if (!match) return null;

    const values = match[2].split(',').map((item) => evaluateNumber(item.trim()));
    if (values.some((value) => value === null) || values.length !== 3) return null;
    const numbers = values as number[];

    if (match[1] === 'translate') return ops.translate(numbers);
    if (match[1] === 'scale') return ops.scale(numbers);
    return ops.rotate(numbers);
}

function parseTransformExpression(raw: string, matrices: Map<string, Mat4>, ops: MatrixOps): Mat4 | null {
    const expression = raw.trim();
    const asTransformMatch = /^as_transform\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)$/.exec(expression);
    if (asTransformMatch) {
        const matrix = matrices.get(asTransformMatch[1]);
        return matrix ? cloneMat4(matrix) : null;
    }

    const parts = splitTopLevel(expression, '*').map((part) => part.trim());
    if (parts.length === 0) return null;

    let result = ops.identity();
    for (const part of parts) {
        const matrix = parseTransformFunction(part, ops);
        if (!matrix) return null;
        result = ops.multiply(result, matrix);
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
        if (matrix) return cloneMat4(matrix);
        throw new Error(`对象 transform 引用了不存在的矩阵 ${asTransformMatch[1]}`);
    }

    const transform = transforms.get(value);
    if (transform) return cloneMat4(transform);
    throw new Error(`对象 transform 引用了不存在的变换 ${value}`);
}

function derivativeExpression(node: MathNode, variable: string): string {
    return toRustExpression(math.derivative(node, variable));
}

const rustExpressionCache = new WeakMap<MathNode, string>();
const derivativeExpressionCache = new WeakMap<MathNode, Map<string, string>>();

function cachedRustExpression(node: MathNode): string {
    let cached = rustExpressionCache.get(node);
    if (!cached) {
        cached = toRustExpression(node);
        rustExpressionCache.set(node, cached);
    }
    return cached;
}

function cachedDerivativeExpression(node: MathNode, variable: string): string {
    let byVariable = derivativeExpressionCache.get(node);
    if (!byVariable) {
        byVariable = new Map<string, string>();
        derivativeExpressionCache.set(node, byVariable);
    }

    let cached = byVariable.get(variable);
    if (!cached) {
        cached = derivativeExpression(node, variable);
        byVariable.set(variable, cached);
    }
    return cached;
}

/** 把 mathjs 节点转成 evalexpr 可解析的字符串，并显式替换 pi / e 常量。 */
function toRustExpression(node: MathNode): string {
    const replaced = node.transform((current) => {
        if (current.type === 'SymbolNode') {
            const symbol = current as unknown as { name: string };
            if (symbol.name === 'pi') return new math.ConstantNode(Math.PI);
            if (symbol.name === 'e') return new math.ConstantNode(Math.E);
        }
        return current;
    });
    return replaced.toString();
}

function coefficientArgs(source: { coefficients: Coefficient[] }): [string[], Float64Array] {
    return [
        source.coefficients.map((coefficient) => coefficient.name),
        new Float64Array(source.coefficients.map((coefficient) => coefficient.value)),
    ];
}

function normalizeVector(vector: [number, number, number]): [number, number, number] {
    const [x, y, z] = vector;
    const length = Math.sqrt(x * x + y * y + z * z);
    return length < 1e-12 ? [0, 0, 0] : [x / length, y / length, z / length];
}

function compileAnalyses(
    ast: AstProgram,
    blueprintByName: Map<string, ObjectBlueprint>,
    params: Map<string, ParamDeclaration>,
    overrides: Record<string, number>,
): AnalysisResult[] {
    const results: AnalysisResult[] = [];

    for (const statement of ast.statements) {
        if (statement.type !== 'analysis') continue;

        const blueprint = blueprintByName.get(statement.source.trim());
        if (!blueprint) {
            throw new Error(`分析 ${statement.name} 引用了不存在的对象 ${statement.source}`);
        }

        if (statement.op === 'jacobian' || statement.op === 'laplacian') {
            throw new Error(`分析算子 ${statement.op} 暂未实现`);
        }

        const coefficients = materializeCoefficients(
            blueprint.coefficientNames,
            params,
            overrides,
        );
        const atScope: Record<string, number> = {};
        for (const [name, param] of params) atScope[name] = param.value;
        for (const coefficient of coefficients) {
            atScope[coefficient.name] = coefficient.value;
        }

        const rawAt = statement.at ?? [];
        const requiredAtCount =
            statement.op === 'gradient' && blueprint.kind === 'surface' ? 2
                : (statement.op === 'divergence' || statement.op === 'curl') && blueprint.kind === 'vector_field' ? 3
                    : 1;
        if (rawAt.length < requiredAtCount) {
            throw new Error(`分析 ${statement.name} 的 at 至少需要 ${requiredAtCount} 个坐标`);
        }

        const atValues: number[] = [];
        for (let i = 0; i < rawAt.length; i += 1) {
            const value = evaluateNumber(rawAt[i], atScope);
            if (value === null) {
                throw new Error(`分析 ${statement.name} 的 at 第 ${i + 1} 个坐标无法求值: ${rawAt[i]}`);
            }
            atValues.push(value);
        }
        const at: [number, number, number] = [
            atValues[0] ?? 0,
            atValues[1] ?? 0,
            atValues[2] ?? 0,
        ];
        const show = parseShowOption(statement.options);

        if (statement.op === 'gradient' && (blueprint.kind === 'curve' || blueprint.kind === 'surface')) {
            const isCurve = blueprint.kind === 'curve';
            const [coeffNames, coeffValues] = coefficientArgs({ coefficients });
            const result = wasmEvaluateGradientPoint(
                cachedRustExpression(blueprint.node),
                cachedDerivativeExpression(blueprint.node, 'x'),
                isCurve ? '0' : cachedDerivativeExpression(blueprint.node, 'y'),
                coeffNames,
                coeffValues,
                at[0],
                isCurve ? 0 : at[1],
            );
            const f0 = result.f0;
            const vector = normalizeVector(
                isCurve
                    ? [-result.fx, 1, 0]
                    : [-result.fx, -result.fy, 1],
            );
            const point: [number, number, number] = isCurve
                ? [at[0], f0, 0]
                : [at[0], at[1], f0];
            results.push({ name: statement.name, op: 'gradient', point, vector, scalar: f0, show });
            continue;
        }

        if ((statement.op === 'divergence' || statement.op === 'curl') && blueprint.kind === 'vector_field') {
            const [coeffNames, coeffValues] = coefficientArgs({ coefficients });

            if (statement.op === 'divergence') {
                const scalar = wasmEvaluateDivergencePoint(
                    cachedDerivativeExpression(blueprint.nodeP, 'x'),
                    cachedDerivativeExpression(blueprint.nodeQ, 'y'),
                    cachedDerivativeExpression(blueprint.nodeR, 'z'),
                    coeffNames,
                    coeffValues,
                    at[0],
                    at[1],
                    at[2],
                );
                results.push({ name: statement.name, op: 'divergence', point: at, vector: [0, 0, 0], scalar, show });
            } else {
                const result = wasmEvaluateCurlPoint(
                    cachedDerivativeExpression(blueprint.nodeR, 'y'),
                    cachedDerivativeExpression(blueprint.nodeQ, 'z'),
                    cachedDerivativeExpression(blueprint.nodeP, 'z'),
                    cachedDerivativeExpression(blueprint.nodeR, 'x'),
                    cachedDerivativeExpression(blueprint.nodeQ, 'x'),
                    cachedDerivativeExpression(blueprint.nodeP, 'y'),
                    coeffNames,
                    coeffValues,
                    at[0],
                    at[1],
                    at[2],
                );
                const vector: [number, number, number] = [result.x, result.y, result.z];
                results.push({ name: statement.name, op: 'curl', point: at, vector, scalar: null, show });
            }
            continue;
        }

        throw new Error(
            `分析算子 ${statement.op} 不能应用于 ${blueprint.kind} 类型对象`,
        );
    }

    return results;
}

function compileIntegralTask(
    statement: IntegralStatement,
    objectByName: Map<string, SceneObject>,
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
    let range: [number, number] | [number, number, number, number];
    if (source.kind === 'curve') {
        const rangeValues = rawRange
            ? parseNumberList(rawRange, `积分 ${statement.name} 的 range`)
            : [-4, 4];
        if (rangeValues.length !== 2) {
            throw new Error(`积分 ${statement.name} 的 range 需要 2 个数值`);
        }
        if (rangeValues[0] >= rangeValues[1]) {
            throw new Error(`积分 ${statement.name} 需要有效的一维区间 a < b`);
        }
        range = [rangeValues[0], rangeValues[1]];
    } else {
        const rangeValues = rawRange
            ? parseNumberList(rawRange, `积分 ${statement.name} 的 range`)
            : [-3, 3, -3, 3];
        if (rangeValues.length !== 4) {
            throw new Error(`积分 ${statement.name} 的 range 需要 4 个数值`);
        }
        if (rangeValues[0] >= rangeValues[1] || rangeValues[2] >= rangeValues[3]) {
            throw new Error(`积分 ${statement.name} 需要有效的二维区间`);
        }
        range = [rangeValues[0], rangeValues[1], rangeValues[2], rangeValues[3]];
    }

    const segments = parsePositiveInteger(
        findOption(statement.options, 'segments'),
        `积分 ${statement.name} 的 segments`,
    ) ?? 32;
    if (method === 'simpson' && segments % 2 !== 0) {
        throw new Error(`积分 ${statement.name} 的辛普森法要求分段数必须为偶数,当前为 ${segments}`);
    }
    const layers = parsePositiveInteger(
        findOption(statement.options, 'layers'),
        `积分 ${statement.name} 的 layers`,
    ) ?? Math.min(32, segments);
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

export function compileScene(
    ast: AstProgram,
    paramOverrides: Record<string, number> = {},
    matrixOps: MatrixOps = jsMatrixOps,
): SceneIR {
    let cached = staticSceneCache.get(ast);
    if (!cached || cached.matrixOps !== matrixOps) {
        const scene = buildStaticScene(ast, matrixOps);
        cached = { matrixOps, scene };
        staticSceneCache.set(ast, cached);
    }
    const staticScene = cached.scene;

    const params = cloneParams(staticScene.params);
    const objects = staticScene.objectBlueprints.map((blueprint) =>
        materializeObject(blueprint, params, paramOverrides),
    );
    applyParamOverrides(params, paramOverrides);

    const objectByName = new Map<string, SceneObject>();
    const blueprintByName = new Map<string, ObjectBlueprint>();
    for (let i = 0; i < staticScene.objectBlueprints.length; i += 1) {
        const blueprint = staticScene.objectBlueprints[i];
        objectByName.set(blueprint.name, objects[i]);
        blueprintByName.set(blueprint.name, blueprint);
    }

    const integrals: IntegralTask[] = [];
    for (const statement of ast.statements) {
        if (statement.type !== 'integral') continue;
        integrals.push(compileIntegralTask(statement, objectByName));
    }

    return {
        params: [...params.values()],
        objects,
        objectTransforms: cloneObjectTransforms(staticScene.objectTransforms),
        analyses: compileAnalyses(ast, blueprintByName, params, paramOverrides),
        integrals,
    };
}
