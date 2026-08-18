/**
 * 数值计算门面.
 * 当前先把积分计算收口到这里,后续再把曲线/曲面/向量场采样逐步迁入.
 */
import type {
    Coefficient,
    IntegralTask,
    SceneObject,
} from '../../compiler/ir/types';
import * as math from 'mathjs';
import { NUMERIC_CONFIG } from '../../config/numericConfig';
import { compilationCache } from '../objects/CompilationCache';
import {
    lebesgue1d,
    lebesgue2d,
    riemann1dLeft,
    riemann2dLeft,
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
    coefficients: Coefficient[];
    range: [number, number];
    segments: number;
};

export class MathComputeEngine {
    async sampleCurve(request: CurveSampleRequest): Promise<Float32Array> {
        try {
            // 曲线采样与曲面/向量场保持一致,交给 Worker 执行,
            // 避免高 segments 或大量曲线时阻塞主线程.
            return await curveComputeClient.request({
                expr: request.expr,
                coeffNames: request.coefficients.map((coefficient) => coefficient.name),
                coeffValues: request.coefficients.map((coefficient) => coefficient.value),
                range: request.range,
                segments: request.segments,
            });
        } catch {
            return this._sampleCurveFallback(request);
        }
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
                case 'riemann':
                    return riemann1dLeft(expr, coeffs, a, b, segments);
                case 'lebesgue': {
                    const sampleN = segments * NUMERIC_CONFIG.integral.lebesgueOversample1D;
                    return lebesgue1d(expr, coeffs, a, b, task.layers, sampleN);
                }
            }
        }

        const [xMin, xMax, yMin, yMax] = task.range as [number, number, number, number];
        switch (task.method) {
            case 'trapezoid':
                return trapz2d(expr, coeffs, [xMin, xMax], [yMin, yMax], segments, segments);
            case 'simpson':
                return simpson2d(expr, coeffs, [xMin, xMax], [yMin, yMax], segments, segments);
            case 'riemann':
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

    private _sampleCurveFallback(request: CurveSampleRequest): Float32Array {
        const [xMin, xMax] = request.range;
        const coeffsKey = request.coefficients
            .map((coefficient) => `${coefficient.name}=${coefficient.value}`)
            .join(',');
        const compiled = compilationCache.getByExpr(
            request.expr,
            coeffsKey,
            () => math.parse(request.expr).compile(),
        );
        const scope: Record<string, number> = {};
        for (const coefficient of request.coefficients) {
            scope[coefficient.name] = coefficient.value;
        }

        const values: number[] = [];
        const step = (xMax - xMin) / request.segments;
        for (let i = 0; i <= request.segments; i += 1) {
            const x = xMin + i * step;
            scope.x = x;
            try {
                const y = compiled.evaluate(scope);
                if (typeof y === 'number' && Number.isFinite(y)) {
                    values.push(x, y, 0);
                }
            } catch {
                // 跳过奇异点
            }
        }
        return new Float32Array(values);
    }
}
