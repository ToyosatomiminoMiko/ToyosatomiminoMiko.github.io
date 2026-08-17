/**
 * 微分分析编译.
 * 负责 gradient/divergence/curl 的符号求导与 WASM 数值求值编排.
 */
import type { AstProgram } from '../ast/types';
import type {
    AnalysisResult,
    Coefficient,
    ParamDeclaration,
} from '../ir/types';
import { NUMERIC_CONFIG } from '../../config/numericConfig';
import {
    evaluate_curl_point as wasmEvaluateCurlPoint,
    evaluate_divergence_point as wasmEvaluateDivergencePoint,
    evaluate_gradient_point as wasmEvaluateGradientPoint,
} from '../../wasm/math_rs/math_rs';
import {
    materializeCoefficients,
    type ObjectBlueprint,
} from './objects';
import { assertKnownOptions, parseShowOption } from './options';
import {
    cachedDerivativeExpression,
    cachedRustExpression,
    evaluateNumber,
} from './expression';

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

        // 分析声明目前只接受 show；其他字段应作为编译错误暴露。
        assertKnownOptions(statement.options, ['show'], `分析 ${statement.name}`);

        if (blueprint.kind !== 'curve' && blueprint.kind !== 'surface' && blueprint.kind !== 'vector_field') {
            throw new Error(`分析 ${statement.name} 不能应用于 ${blueprint.kind} 类型对象`);
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
