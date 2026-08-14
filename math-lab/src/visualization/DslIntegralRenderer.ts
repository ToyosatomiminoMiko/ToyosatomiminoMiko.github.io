import * as THREE from 'three';
import type { MathObject } from '../types';
import type { IntegralTask } from '../dsl/DslCompiler';
import { IntegralVisualizer } from './IntegralVisualizer';
import {
    lebesgue1d,
    lebesgue2d,
    riemann1dLeft,
    riemann2dLeft,
    simpson1d,
    simpson2d,
    trapz1d,
    trapz2d,
} from '../math_objects/IntegralWasm';

export type IntegralDiagnosticFn = (
    level: 'info' | 'warning' | 'error' | 'log',
    message: string,
) => void;

/**
 * DSL 积分可视化执行器。
 *
 * 输入是编译后的 IntegralTask，计算仍复用旧数值积分 worker，
 * 可视化复用 IntegralVisualizer，但缓存键使用积分名而不是对象 id，
 * 以支持同一个曲线/曲面存在多个积分声明。
 */
export class DslIntegralRenderer {
    private readonly visualizer: IntegralVisualizer;
    private sequence = 0;
    private disposed = false;

    constructor(scene: THREE.Scene) {
        this.visualizer = new IntegralVisualizer(scene);
    }

    sync(
        tasks: IntegralTask[],
        objects: MathObject[],
        diagnostics: IntegralDiagnosticFn,
    ): void {
        const sequence = ++this.sequence;
        this.visualizer.clearAll();
        this.visualizer.group.visible = true;
        if (tasks.length === 0) return;

        void this._renderAll(tasks, objects, sequence, diagnostics);
    }

    dispose(): void {
        this.disposed = true;
        this.sequence += 1;
        this.visualizer.dispose();
    }

    private async _renderAll(
        tasks: IntegralTask[],
        objects: MathObject[],
        sequence: number,
        diagnostics: IntegralDiagnosticFn,
    ): Promise<void> {
        for (const task of tasks) {
            const source = objects.find((object) => object.id === task.objectId);
            if (!source || (source.kind !== 'curve' && source.kind !== 'surface')) {
                diagnostics('error', `积分 ${task.name} 找不到可积分的源对象`);
                continue;
            }

            try {
                const coeffs = this._coefficients(source);
                const value = await this._compute(task, source, coeffs);
                if (sequence !== this.sequence || this.disposed) return;

                if (task.show) {
                    this._visualize(task, source);
                }
                diagnostics('info', `积分 ${task.name}: S = ${value.toFixed(6)}`);
            } catch (error) {
                if (sequence !== this.sequence || this.disposed) return;
                diagnostics(
                    'error',
                    `积分 ${task.name} 计算失败: ${error instanceof Error ? error.message : String(error)}`,
                );
            }
        }
    }

    private async _compute(
        task: IntegralTask,
        source: Extract<MathObject, { kind: 'curve' | 'surface' }>,
        coeffs: Record<string, number>,
    ): Promise<number> {
        const expr = source.node.toString();
        const segments = task.segments;

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
                const result = await lebesgue2d(expr, coeffs, [xMin, xMax], [yMin, yMax], task.layers, sampleGrid);
                return result.value;
            }
        }
    }

    private _visualize(
        task: IntegralTask,
        source: Extract<MathObject, { kind: 'curve' | 'surface' }>,
    ): void {
        if (source.kind === 'curve') {
            const [a, b] = task.range as [number, number];
            const fn = this._makeFn(source) as (x: number) => number;
            const segments = task.segments;
            if (task.method === 'lebesgue') {
                const sampleN = segments * 20;
                this.visualizer.visualize2DLebesgue(
                    source,
                    fn,
                    a,
                    b,
                    task.layers,
                    sampleN,
                    task.name,
                );
            } else {
                this.visualizer.visualize2DRiemann(
                    source,
                    fn,
                    a,
                    b,
                    segments,
                    task.name,
                );
            }
            return;
        }

        const [xMin, xMax, yMin, yMax] = task.range as [number, number, number, number];
        const fn = this._makeFn(source) as (x: number, y: number) => number;
        const segments = task.segments;
        if (task.method === 'lebesgue') {
            const sampleGrid = segments * 4;
            this.visualizer.visualize3DLebesgue(
                source,
                fn,
                [xMin, xMax],
                [yMin, yMax],
                task.layers,
                sampleGrid,
                task.name,
            );
        } else {
            this.visualizer.visualize3DRiemann(
                source,
                fn,
                [xMin, xMax],
                [yMin, yMax],
                segments,
                segments,
                task.name,
            );
        }
    }

    private _makeFn(
        source: Extract<MathObject, { kind: 'curve' | 'surface' }>,
    ): (x: number, y?: number) => number {
        const compiled = source.node.compile();
        const scope: Record<string, number> = {};
        for (const coefficient of source.coefficients) {
            scope[coefficient.name] = coefficient.value;
        }

        return (x: number, y?: number): number => {
            scope.x = x;
            if (y !== undefined) scope.y = y;
            const value = compiled.evaluate(scope);
            return typeof value === 'number' ? value : NaN;
        };
    }

    private _coefficients(
        source: Extract<MathObject, { kind: 'curve' | 'surface' }>,
    ): Record<string, number> {
        const result: Record<string, number> = {};
        for (const coefficient of source.coefficients) {
            result[coefficient.name] = coefficient.value;
        }
        return result;
    }

}
