/**
 * 数值计算门面.
 * 当前先把积分计算收口到这里,后续再把曲线/曲面/向量场采样逐步迁入.
 */
import type {
    IntegralTask,
    SceneObject,
} from '../../compiler/ir/types';
import { NUMERIC_CONFIG } from '../../config/numericConfig';
import {
    lebesgue1d,
    lebesgue2d,
    riemann1dLeft,
    riemann2dLeft,
    riemann1dRight,
    riemann1dMid,
    simpson1d,
    simpson2d,
    trapz1d,
    trapz2d,
    type IntegralResult,
} from './IntegralWasm';
import { curveComputeClient } from './workers/CurveComputeClient';

export type IntegralSource = Extract<SceneObject, { kind: 'curve' | 'surface' }>;

export type CurveSampleRequest = {
    expr: string;
    coeffNames: string[];
    coeffValues: number[];
    range: [number, number];
    segments: number;
};

export class MathComputeEngine {
    async sampleCurve(request: CurveSampleRequest): Promise<Float32Array> {
        // 曲线采样与曲面/向量场保持一致:交给 Worker 执行,避免高 segments
        // 或大量曲线时阻塞主线程.失败直接上抛,由渲染层统一上报诊断,
        // 不再做主线程静默兜底(否则 Worker 故障会被悄悄掩盖).
        return curveComputeClient.request(request);
    }

    async integrate(task: IntegralTask, source: IntegralSource): Promise<IntegralResult> {
        const expr = source.expr;
        const segments = task.segments;
        const coeffs = this._coefficients(source);

        if (source.kind === 'curve') {
            const [a, b] = task.range as [number, number];
            switch (task.method) {
                case 'trapezoid':
                    return trapz1d(expr, coeffs, a, b, segments);
                case 'simpson':
                    return simpson1d(expr, coeffs, a, b, segments);
                case 'riemann:left':
                    return riemann1dLeft(expr, coeffs, a, b, segments);
                case 'riemann:right':
                    return riemann1dRight(expr, coeffs, a, b, segments);
                case 'riemann:mid':
                    return riemann1dMid(expr, coeffs, a, b, segments);
                case 'lebesgue': {
                    const sampleN = segments * NUMERIC_CONFIG.integral.lebesgueOversample1D;
                    return lebesgue1d(expr, coeffs, a, b, task.layers, sampleN);
                }
                default:
                    throw new Error(`一维积分不支持方法 ${task.method}`);
            }
        }

        const [xMin, xMax, yMin, yMax] = task.range as [number, number, number, number];
        switch (task.method) {
            case 'trapezoid':
                return trapz2d(expr, coeffs, [xMin, xMax], [yMin, yMax], segments, segments);
            case 'simpson':
                return simpson2d(expr, coeffs, [xMin, xMax], [yMin, yMax], segments, segments);
            case 'riemann:left':
                return riemann2dLeft(expr, coeffs, [xMin, xMax], [yMin, yMax], segments, segments);
            case 'lebesgue': {
                const sampleGrid = segments * NUMERIC_CONFIG.integral.lebesgueOversample2D;
                return lebesgue2d(
                    expr,
                    coeffs,
                    [xMin, xMax],
                    [yMin, yMax],
                    task.layers,
                    sampleGrid,
                );
            }
            default:
                // 编译器已拒绝二维 right/mid;这里兜底,避免静默返回 undefined.
                throw new Error(`二维积分不支持方法 ${task.method}`);
        }
    }

    dispose(): void {
        // 本类只是计算门面,不拥有任何共享 worker.
        // worker 生命周期由应用级 dispose 统一处理.
    }

    private _coefficients(source: IntegralSource): Record<string, number> {
        const result: Record<string, number> = {};
        for (const coefficient of source.coefficients) {
            result[coefficient.name] = coefficient.value;
        }
        return result;
    }
}
