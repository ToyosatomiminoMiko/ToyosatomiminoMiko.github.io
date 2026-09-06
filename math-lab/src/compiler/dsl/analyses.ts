/**
 * 微分分析编译.
 * 负责 gradient/divergence/curl 的符号求导与 WASM 数值求值编排.
 *
 * 202609 review 结论(hidden 语义,与 intersections/integrals 统一):
 * "隐藏 = 先完整校验,后禁用,仅跳过数值计算".分析语句即使被隐藏也必须
 * 通过全部声明级校验(对象存在 / 选项白名单 / 函数名与算子匹配 / kind × 算子
 * 可用矩阵 / at 数量与坐标可求值 / show 白名单),校验失败照常抛语句级错误;
 * 只有 WASM 符号求值/数值核(以及为它准备的 payload)在隐藏时跳过,产出
 * enabled:false 的列表占位.分析名在 compileAnalyses 循环内查重,与
 * param/object/animation 的"重复声明"契约一致.
 */
import type {
    AnalysisCallName,
    AnalysisOpKind,
    AnalysisStatement,
    AstProgram,
} from '../ast/types';
import type {
    AnalysisResult,
    AnalysisShow,
    ParamDeclaration,
    SceneObject,
} from '../ir/types';
import { NUMERIC_CONFIG } from '../../config/numericConfig';
import {
    evaluate_curl_point as wasmEvaluateCurlPoint,
    evaluate_divergence_point as wasmEvaluateDivergencePoint,
    evaluate_gradient_point as wasmEvaluateGradientPoint,
} from '../../wasm/math_rs/math_rs';
import { splitCoefficients } from '../../math/coefficientUtils';
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
    paramOverrides: Record<string, number>,
    hiddenNames: ReadonlySet<string> = new Set(),
): AnalysisResult[] {
    const results: AnalysisResult[] = [];
    const seenNames = new Set<string>();

    for (const statement of ast.statements) {
        if (statement.type !== 'analysis') continue;
        // 语句级错误定位:单条 analysis 编译抛错时携带本语句 span,
        // 应用层据此换算成源码行列(见 compiler/errors.ts).
        withStatementSpan(statement.span, () => {
            if (seenNames.has(statement.name)) {
                throw new Error(`分析 ${statement.name} 重复声明`);
            }
            seenNames.add(statement.name);
            compileAnalysisStatement(
                statement,
                objectByName,
                params,
                paramOverrides,
                hiddenNames,
                results,
            );
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
    paramOverrides: Record<string, number>,
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

    // ---- 校验面 1:对象 kind × 算子 可用矩阵 ----
    // 粗 gate 只放行"能参与分析"的对象 kind;细 gate 校验算子与 kind 的组合.
    // 两处都在 hidden 分支之前,保证隐藏项同样必须合法(见文件头结论).
    if (
        object.kind !== 'curve'
        && object.kind !== 'surface'
        && object.kind !== 'vector_field'
    ) {
        throw new Error(`分析 ${statement.name} 不能应用于 ${object.kind} 类型对象`);
    }
    const opMatchesKind = statement.op === 'gradient'
        ? object.kind === 'curve' || object.kind === 'surface'
        : object.kind === 'vector_field';
    if (!opMatchesKind) {
        throw new Error(
            `分析算子 ${statement.op} 不能应用于 ${object.kind} 类型对象`,
        );
    }

    // ---- 校验面 2:at 坐标 ----
    // scope 直接由 buildParamScope(params, overrides) 提供,不再依赖
    // "先 applyParamOverrides 改 map 再建 scope"的副作用通道
    // (202609 review:见 params.ts 注释).
    const atScope = buildParamScope(params, paramOverrides);
    const rawAt = statement.at ?? [];
    const requiredAtCount =
        statement.op === 'gradient' && object.kind === 'surface' ? 2
            : object.kind === 'vector_field' ? 3
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

    // show 白名单也在隐藏前校验,避免隐藏项带着拼写错误的 show 静默存活.
    // 缺省项按源对象分派:一元 curve 求导(gradient)默认连同切线一起画,
    // 让"求导要有切线"在没写 show 时也成立;曲面/向量场沿用 [point, normal].
    const defaultShow = statement.op === 'gradient' && object.kind === 'curve'
        ? (['point', 'normal', 'tangent'] as AnalysisShow[])
        : (['point', 'normal'] as AnalysisShow[]);
    const show = parseShowOption(statement.options, defaultShow);

    // ---- 隐藏:仅保留列表项,不执行数值计算 ----
    if (hiddenNames.has(statement.name)) {
        results.push({
            name: statement.name,
            op: statement.op,
            point: [0, 0, 0],
            vector: [0, 0, 0],
            tangent: null,
            scalar: null,
            show,
            enabled: false,
        });
        return;
    }

    const { names: coeffNames, values: coeffValues } = splitCoefficients(
        object.coefficients,
    );

    if (object.kind === 'curve' || object.kind === 'surface') {
        // 经过 op×kind gate,此处 statement.op 必为 gradient.
        const isCurve = object.kind === 'curve';
        const payload = JSON.stringify({
            surface_expr: normalizeExpression(object.expr),
            fx_expr: cachedDerivativeExpression(object.expr, 'x'),
            fy_expr: isCurve ? '0' : cachedDerivativeExpression(object.expr, 'y'),
            coeff_names: coeffNames,
            coeff_values: coeffValues,
            x: at[0],
            y: isCurve ? 0 : at[1],
        });
        const result = wasmEvaluateGradientPoint(payload);
        const f0 = result.f0;
        const vector = normalizeVector(
            isCurve
                ? [-result.fx, 1, 0]
                : [-result.fx, -result.fy, 1],
        );
        // 一元曲线求导的切线方向:(1, f', 0),与上面的法向在 z=0 平面内
        // 正交;曲面只有切平面,没有唯一"切线",故为 null.
        const tangent: [number, number, number] | null = isCurve
            ? [1, result.fx, 0]
            : null;
        const point: [number, number, number] = isCurve
            ? [at[0], f0, 0]
            : [at[0], at[1], f0];
        results.push({
            name: statement.name,
            op: 'gradient',
            point,
            vector,
            tangent,
            scalar: f0,
            show,
            enabled: true,
        });
        return;
    }

    // vector_field:divergence / curl(经过 op×kind gate).
    const [pExpr, qExpr, rExpr] = object.components;
    if (statement.op === 'divergence') {
        const payload = JSON.stringify({
            dpx_expr: cachedDerivativeExpression(pExpr, 'x'),
            dqy_expr: cachedDerivativeExpression(qExpr, 'y'),
            drz_expr: cachedDerivativeExpression(rExpr, 'z'),
            coeff_names: coeffNames,
            coeff_values: coeffValues,
            x: at[0],
            y: at[1],
            z: at[2],
        });
        const scalar = wasmEvaluateDivergencePoint(payload);
        results.push({
            name: statement.name,
            op: 'divergence',
            point: at,
            vector: [0, 0, 0],
            tangent: null,
            scalar,
            show,
            enabled: true,
        });
        return;
    }

    const payload = JSON.stringify({
        dr_dy_expr: cachedDerivativeExpression(rExpr, 'y'),
        dq_dz_expr: cachedDerivativeExpression(qExpr, 'z'),
        dp_dz_expr: cachedDerivativeExpression(pExpr, 'z'),
        dr_dx_expr: cachedDerivativeExpression(rExpr, 'x'),
        dq_dx_expr: cachedDerivativeExpression(qExpr, 'x'),
        dp_dy_expr: cachedDerivativeExpression(pExpr, 'y'),
        coeff_names: coeffNames,
        coeff_values: coeffValues,
        x: at[0],
        y: at[1],
        z: at[2],
    });
    const result = wasmEvaluateCurlPoint(payload);
    const vector: [number, number, number] = [result.x, result.y, result.z];
    results.push({
        name: statement.name,
        op: 'curl',
        point: at,
        vector,
        tangent: null,
        scalar: null,
        show,
        enabled: true,
    });
}
