import * as THREE from 'three';
import { parse } from 'mathjs';
import type { IntegralTask, SceneObject } from '../../compiler/ir/types';
import { IntegralVisualizer } from './IntegralVisualizer';
import type { MathComputeEngine } from '../../math/compute/MathComputeEngine';

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

    constructor(
        scene: THREE.Scene,
        private readonly computeEngine: MathComputeEngine,
    ) {
        this.visualizer = new IntegralVisualizer(scene);
    }

    sync(
        tasks: IntegralTask[],
        objects: SceneObject[],
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
        objects: SceneObject[],
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
                const value = await this.computeEngine.integrate(task, source);
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

    private _visualize(
        task: IntegralTask,
        source: Extract<SceneObject, { kind: 'curve' | 'surface' }>,
    ): void {
        if (source.kind === 'curve') {
            const [a, b] = task.range as [number, number];
            const fn = this._makeFn(source) as (x: number) => number;
            const segments = task.segments;
            switch (task.method) {
                case 'riemann':
                    this.visualizer.visualize2DRiemann(
                        source,
                        fn,
                        a,
                        b,
                        segments,
                        task.name,
                    );
                    break;
                case 'trapezoid':
                    this.visualizer.visualize2DTrapezoid(
                        source,
                        fn,
                        a,
                        b,
                        segments,
                        task.name,
                    );
                    break;
                case 'simpson':
                    this.visualizer.visualize2DSimpson(
                        source,
                        fn,
                        a,
                        b,
                        segments,
                        task.name,
                    );
                    break;
                case 'lebesgue':
                    this.visualizer.visualize2DLebesgue(
                        source,
                        fn,
                        a,
                        b,
                        task.layers,
                        segments * 20,
                        task.name,
                    );
                    break;
            }
            return;
        }

        const [xMin, xMax, yMin, yMax] = task.range as [number, number, number, number];
        const fn = this._makeFn(source) as (x: number, y: number) => number;
        const segments = task.segments;
        switch (task.method) {
            case 'riemann':
                this.visualizer.visualize3DRiemann(
                    source,
                    fn,
                    [xMin, xMax],
                    [yMin, yMax],
                    segments,
                    segments,
                    task.name,
                );
                break;
            case 'trapezoid':
                this.visualizer.visualize3DTrapezoid(
                    source,
                    fn,
                    [xMin, xMax],
                    [yMin, yMax],
                    segments,
                    segments,
                    task.name,
                );
                break;
            case 'simpson':
                this.visualizer.visualize3DSimpson(
                    source,
                    fn,
                    [xMin, xMax],
                    [yMin, yMax],
                    segments,
                    segments,
                    task.name,
                );
                break;
            case 'lebesgue':
                this.visualizer.visualize3DLebesgue(
                    source,
                    fn,
                    [xMin, xMax],
                    [yMin, yMax],
                    task.layers,
                    segments * 4,
                    task.name,
                );
                break;
        }
    }

    private _makeFn(
        source: Extract<SceneObject, { kind: 'curve' | 'surface' }>,
    ): (x: number, y?: number) => number {
        const compiled = parse(source.expr).compile();
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

}
