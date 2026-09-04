/**
 * 微分分析编译.
 * 负责 gradient/divergence/curl 的符号求导与 WASM 数值求值编排.
 */
import type {
    AnalysisCallName,
    AnalysisOpKind,
    AnalysisStatement,
    AstProgram,
} from '../ast/types';
import type {
    AnalysisResult,
    Coefficient,
    ParamDeclaration,
    SceneObject,
} from '../ir/types';
import { NUMERIC_CONFIG } from '../../config/numericConfig';
import {
    evaluate_curl_point as wasmEvaluateCurlPoint,
    evaluate_divergence_point as wasmEvaluateDivergencePoint,
    evaluate_gradient_point as wasmEvaluateGradientPoint,
} from '../../wasm/math_rs/math_rs';
import { withStatementSpan } from '../errors';
import { assertKnownOptions, parseShowOption } from './options';
import { buildParamScope } from './params';
import {
    cachedDerivativeExpression,
    evaluateNumber,
    normalizeExpression,
} from './expression';

/** 每个算子的规范函数名,解析出的 `call` 必须与之一致. */
const ANALYSIS_CALL_NAMES: Record<AnalysisOpKind, AnalysisCallName> = {
    gradient: 'grad',
    divergence: 'div',
    curl: 'curl',
    jacobian: 'jacobian',
    laplacian: 'laplacian',
};

function coefficientArgs(source: { coefficients: Coefficient[] }): [string[], Float64Array] {
    return [
        source.coefficients.map((coefficient) => coefficient.name),
        new Float64Array(source.coefficients.map((coefficient) => coefficient.value)),
    ];
}

function normalizeVector(vector: [number, number, number]): [number, number, number] {
    const [x, y, z] = vector;
    const length = Math.sqrt(x * x + y * y + z * z);
    return length < NUMERIC_CONFIG.tolerance.zero
        ? [0, 0, 0]
        : [x / length, y / length, z / length];
}

export function compileAnalyses(
    ast: AstProgram,
    objectByName: Map<string, SceneObject>,
    params: Map<string, ParamDeclaration>,
    hiddenNames: ReadonlySet<string> = new Set(),
): AnalysisResult[] {
    const results: AnalysisResult[] = [];

    for (const statement of ast.statements) {
        if (statement.type !== 'analysis') continue;
        // 语句级错误定位:单条 analysis 编译抛错时携带本语句 span,
        // 应用层据此换算成源码行列(见 compiler/errors.ts).
        withStatementSpan(statement.span, () => {
            compileAnalysisStatement(statement, objectByName, params, hiddenNames, results);
        });
    }

    return results;
}

/**
 * 编译单条 analysis 语句.
 *
 * 从 compileAnalyses 的循环体拆出,让"错误携带语句 span"只发生在
 * 循环边界一处,各条 throw 无需手工携带 statement.span.
 */
function compileAnalysisStatement(
    statement: AnalysisStatement,
    objectByName: Map<string, SceneObject>,
    params: Map<string, ParamDeclaration>,
    hiddenNames: ReadonlySet<string>,
    results: AnalysisResult[],
): void {
    const object = objectByName.get(statement.source.trim());
    if (!object) {
        throw new Error(`分析 ${statement.name} 引用了不存在的对象 ${statement.source}`);
    }

    // 分析声明目前只接受 show;其他字段应作为编译错误暴露.
    assertKnownOptions(statement.options, ['show'], `分析 ${statement.name}`);

    const expectedCall = ANALYSIS_CALL_NAMES[statement.op];
    if (statement.call !== expectedCall) {
        throw new Error(
            `分析 ${statement.name} 的函数名 ${statement.call} 与算子 ${statement.op} 不匹配,应为 ${expectedCall}`,
        );
    }

    if (statement.op === 'jacobian' || statement.op === 'laplacian') {
        throw new Error(`分析算子 ${statement.op} 暂未实现`);
    }

    if (hiddenNames.has(statement.name)) {
        results.push({
            name: statement.name,
            op: statement.op,
            point: [0, 0, 0],
            vector: [0, 0, 0],
            scalar: null,
            show: [],
            enabled: false,
        });
        return;
    }

    if (
        object.kind !== 'curve'
        && object.kind !== 'surface'
        && object.kind !== 'vector_field'
    ) {
        throw new Error(`分析 ${statement.name} 不能应用于 ${object.kind} 类型对象`);
    }

    const coefficients = object.coefficients;
    const atScope = buildParamScope(params, {});
    for (const coefficient of coefficients) {
        atScope[coefficient.name] = coefficient.value;
    }

    const rawAt = statement.at ?? [];
    const requiredAtCount =
        statement.op === 'gradient' && object.kind === 'surface' ? 2
            : (statement.op === 'divergence' || statement.op === 'curl') && object.kind === 'vector_field' ? 3
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

    if (statement.op === 'gradient' && (object.kind === 'curve' || object.kind === 'surface')) {
        const isCurve = object.kind === 'curve';
        const [coeffNames, coeffValues] = coefficientArgs(object);
        const result = wasmEvaluateGradientPoint(
            normalizeExpression(object.expr),
            cachedDerivativeExpression(object.expr, 'x'),
            isCurve ? '0' : cachedDerivativeExpression(object.expr, 'y'),
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
        results.push({ name: statement.name, op: 'gradient', point, vector, scalar: f0, show, enabled: true });
        return;
    }

    if ((statement.op === 'divergence' || statement.op === 'curl') && object.kind === 'vector_field') {
        const [coeffNames, coeffValues] = coefficientArgs(object);
        const [pExpr, qExpr, rExpr] = object.components;

        if (statement.op === 'divergence') {
            const scalar = wasmEvaluateDivergencePoint(
                cachedDerivativeExpression(pExpr, 'x'),
                cachedDerivativeExpression(qExpr, 'y'),
                cachedDerivativeExpression(rExpr, 'z'),
                coeffNames,
                coeffValues,
                at[0],
                at[1],
                at[2],
            );
            results.push({
                name: statement.name,
                op: 'divergence',
                point: at,
                vector: [0, 0, 0],
                scalar,
                show,
                enabled: true,
            });
        } else {
            const result = wasmEvaluateCurlPoint(
                cachedDerivativeExpression(rExpr, 'y'),
                cachedDerivativeExpression(qExpr, 'z'),
                cachedDerivativeExpression(pExpr, 'z'),
                cachedDerivativeExpression(rExpr, 'x'),
                cachedDerivativeExpression(qExpr, 'x'),
                cachedDerivativeExpression(pExpr, 'y'),
                coeffNames,
                coeffValues,
                at[0],
                at[1],
                at[2],
            );
            const vector: [number, number, number] = [result.x, result.y, result.z];
            results.push({
                name: statement.name,
                op: 'curl',
                point: at,
                vector,
                scalar: null,
                show,
                enabled: true,
            });
        }
        return;
    }

    throw new Error(
        `分析算子 ${statement.op} 不能应用于 ${object.kind} 类型对象`,
    );
}
