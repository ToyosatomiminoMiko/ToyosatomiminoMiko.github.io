/**
 * 数值计算门面。
 * 当前先把积分计算收口到这里，后续再把曲线/曲面/向量场采样逐步迁入。
 */
import type {
    IntegralTask,
    SceneObject,
} from '../../compiler/ir/types';
import {
    disposeIntegralWorker,
    lebesgue1d,
    lebesgue2d,
    riemann1dLeft,
    riemann2dLeft,
    simpson1d,
    simpson2d,
    trapz1d,
    trapz2d,
} from './IntegralWasm';

export type IntegralSource = Extract<SceneObject, { kind: 'curve' | 'surface' }>;

export class MathComputeEngine {
    async integrate(task: IntegralTask, source: IntegralSource): Promise<number> {
        const expr = source.expr;
        const segments = task.segments;
        const coeffs = this._coefficients(source);

        if (source.kind === 'curve') {
            const [a, b] = task.range as [number, number];
            switch (task.method) {
                case 'trapezoid':
                    return (await trapz1d(expr, coeffs, a, b, segments)).value;
                case 'simpson':
                    return (await simpson1d(expr, coeffs, a, b, segments)).value;
                case 'riemann':
                    return (await riemann1dLeft(expr, coeffs, a, b, segments)).value;
                case 'lebesgue': {
                    const sampleN = segments * 20;
                    const result = await lebesgue1d(expr, coeffs, a, b, task.layers, sampleN);
                    return result.value;
                }
            }
        }

        const [xMin, xMax, yMin, yMax] = task.range as [number, number, number, number];
        switch (task.method) {
            case 'trapezoid':
                return (await trapz2d(expr, coeffs, [xMin, xMax], [yMin, yMax], segments, segments)).value;
            case 'simpson':
                return (await simpson2d(expr, coeffs, [xMin, xMax], [yMin, yMax], segments, segments)).value;
            case 'riemann':
                return (await riemann2dLeft(expr, coeffs, [xMin, xMax], [yMin, yMax], segments, segments)).value;
            case 'lebesgue': {
                const sampleGrid = segments * 4;
                const result = await lebesgue2d(
                    expr,
                    coeffs,
                    [xMin, xMax],
                    [yMin, yMax],
                    task.layers,
                    sampleGrid,
                );
                return result.value;
            }
        }
    }

    dispose(): void {
        disposeIntegralWorker();
    }

    private _coefficients(source: IntegralSource): Record<string, number> {
        const result: Record<string, number> = {};
        for (const coefficient of source.coefficients) {
            result[coefficient.name] = coefficient.value;
        }
        return result;
    }
}
