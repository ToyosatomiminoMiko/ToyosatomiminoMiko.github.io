import * as THREE from 'three';
import type { IntegralTask, SceneObject } from '../../compiler/ir/types';
import { IntegralVisualizer } from './IntegralVisualizer';
import type { MathComputeEngine } from '../../math/compute/MathComputeEngine';
import type { IntegralResult } from '../../math/compute/IntegralWasm';
import {
    clampIntegral1DVisualization,
    clampIntegral2DVisualization,
    clampLebesgue1DVisualization,
    clampLebesgue2DVisualization,
} from '../../config/resourceBudget';

export type IntegralDiagnosticFn = (
    level: 'info' | 'warning' | 'error' | 'log',
    message: string,
) => void;

/**
 * DSL 积分可视化执行器.
 *
 * 输入是编译后的 IntegralTask,计算仍复用旧数值积分 worker,
 * 可视化复用 IntegralVisualizer,但缓存键使用积分名而不是对象 id,
 * 以支持同一个曲线/曲面存在多个积分声明.
 */
export class DslIntegralRenderer {
    private readonly visualizer: IntegralVisualizer;
    private sequence = 0;
    private readonly taskSequences = new Map<string, number>();
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
        dirtyObjectIds: ReadonlySet<number> | null = null,
    ): void {
        if (dirtyObjectIds) {
            // 参数只影响部分对象时,只清除这些对象关联的积分可视化,
            // 其他积分继续保留,避免每次滑块变化都销毁/重建整组 GPU 对象.
            for (const task of tasks) {
                if (dirtyObjectIds.has(task.objectId)) {
                    this.taskSequences.set(task.name, ++this.sequence);
                    this.visualizer.clear(task.name);
                }
            }
        } else {
            this.sequence += 1;
            for (const task of tasks) {
                this.taskSequences.set(task.name, this.sequence);
            }
            this.visualizer.clearAll();
        }
        this.visualizer.group.visible = true;

        const tasksToRender = dirtyObjectIds
            ? tasks.filter((task) => dirtyObjectIds.has(task.objectId))
            : tasks;
        if (tasksToRender.length === 0) return;

        void this._renderAll(tasksToRender, objects, diagnostics);
    }

    dispose(): void {
        this.disposed = true;
        this.sequence += 1;
        this.taskSequences.clear();
        this.visualizer.dispose();
    }

    private async _renderAll(
        tasks: IntegralTask[],
        objects: SceneObject[],
        diagnostics: IntegralDiagnosticFn,
    ): Promise<void> {
        for (const task of tasks) {
            const taskSequence = this.taskSequences.get(task.name) ?? this.sequence;
            const source = objects.find((object) => object.id === task.objectId);
            if (!source || (source.kind !== 'curve' && source.kind !== 'surface')) {
                diagnostics('error', `积分 ${task.name} 找不到可积分的源对象`);
                continue;
            }

            try {
                const result = await this.computeEngine.integrate(task, source);
                const value = result.value;
                if (this.disposed || this.taskSequences.get(task.name) !== taskSequence) return;

                if (task.show) {
                    this._visualize(task, source, result, diagnostics);
                }
                diagnostics('info', `积分 ${task.name}: S = ${value.toFixed(6)}`);
            } catch (error) {
                if (this.disposed || this.taskSequences.get(task.name) !== taskSequence) return;
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
        result: IntegralResult,
        diagnostics: IntegralDiagnosticFn,
    ): void {
        if (source.kind === 'curve') {
            const [a, b] = task.range as [number, number];
            const fn = this._makeFn1D(a, b, result);
            const segments = task.segments;

            switch (task.method) {
                case 'riemann':
                case 'trapezoid':
                case 'simpson': {
                    const visual = clampIntegral1DVisualization(segments);
                    if (visual.decimated) {
                        diagnostics(
                            'warning',
                            `积分 ${task.name} 的绘图分段已从 ${segments} 降采样到 ${visual.segments}`,
                        );
                    }

                    if (task.method === 'riemann') {
                        this.visualizer.visualize2DRiemann(
                            source,
                            fn,
                            a,
                            b,
                            visual.segments,
                            task.name,
                        );
                    } else if (task.method === 'trapezoid') {
                        this.visualizer.visualize2DTrapezoid(
                            source,
                            fn,
                            a,
                            b,
                            visual.segments,
                            task.name,
                        );
                    } else {
                        this.visualizer.visualize2DSimpson(
                            source,
                            fn,
                            a,
                            b,
                            visual.segments,
                            task.name,
                        );
                    }
                    break;
                }
                case 'lebesgue': {
                    const visualLebesgue1D = clampLebesgue1DVisualization(
                        segments,
                        task.layers,
                    );
                    if (visualLebesgue1D.decimated) {
                        diagnostics(
                            'warning',
                            `积分 ${task.name} 的勒贝格绘图已降采样为 sampleN=${visualLebesgue1D.sampleN}, layers=${visualLebesgue1D.layers}`,
                        );
                    }
                    this.visualizer.visualize2DLebesgue(
                        source,
                        fn,
                        a,
                        b,
                        visualLebesgue1D.layers,
                        visualLebesgue1D.sampleN,
                        task.name,
                    );
                    break;
                }
            }
            return;
        }

        const [xMin, xMax, yMin, yMax] = task.range as [number, number, number, number];
        const fn = this._makeFn2D(xMin, xMax, yMin, yMax, result);
        const segments = task.segments;

        switch (task.method) {
            case 'riemann':
            case 'trapezoid':
            case 'simpson': {
                const visual = clampIntegral2DVisualization(segments);
                if (visual.decimated) {
                    diagnostics(
                        'warning',
                        `积分 ${task.name} 的二维绘图每轴已从 ${segments} 降采样到 ${visual.segments}`,
                    );
                }

                if (task.method === 'riemann') {
                    this.visualizer.visualize3DRiemann(
                        source,
                        fn,
                        [xMin, xMax],
                        [yMin, yMax],
                        visual.segments,
                        visual.segments,
                        task.name,
                    );
                } else if (task.method === 'trapezoid') {
                    this.visualizer.visualize3DTrapezoid(
                        source,
                        fn,
                        [xMin, xMax],
                        [yMin, yMax],
                        visual.segments,
                        visual.segments,
                        task.name,
                    );
                } else {
                    this.visualizer.visualize3DSimpson(
                        source,
                        fn,
                        [xMin, xMax],
                        [yMin, yMax],
                        visual.segments,
                        visual.segments,
                        task.name,
                    );
                }
                break;
            }
            case 'lebesgue': {
                const visualLebesgue2D = clampLebesgue2DVisualization(
                    segments,
                    task.layers,
                );
                if (visualLebesgue2D.decimated) {
                    diagnostics(
                        'warning',
                        `积分 ${task.name} 的二维勒贝格绘图已降采样为 res=${visualLebesgue2D.res}, layers=${visualLebesgue2D.layers}`,
                    );
                }
                this.visualizer.visualize3DLebesgue(
                    source,
                    fn,
                    [xMin, xMax],
                    [yMin, yMax],
                    visualLebesgue2D.layers,
                    visualLebesgue2D.res,
                    task.name,
                );
                break;
            }
        }
    }

    private _makeFn1D(
        a: number,
        b: number,
        result: IntegralResult,
    ): (x: number) => number {
        const samples = result.samples;
        if (!samples) return () => NaN;

        if (result.sampleShape === '1d-mid') {
            const n = samples.length;
            const h = (b - a) / n;
            return (x: number) => {
                const idx = Math.max(0, Math.min(n - 1, Math.round((x - a) / h - 0.5)));
                return samples[idx] ?? NaN;
            };
        }

        const n = samples.length - 1;
        const h = (b - a) / n;
        return (x: number) => {
            const idx = Math.max(0, Math.min(n, Math.round((x - a) / h)));
            return samples[idx] ?? NaN;
        };
    }

    private _makeFn2D(
        xMin: number,
        xMax: number,
        yMin: number,
        yMax: number,
        result: IntegralResult,
    ): (x: number, y: number) => number {
        const samples = result.samples;
        const n = result.n ?? 0;
        const m = result.m ?? n;
        if (!samples) return () => NaN;

        if (result.sampleShape === '2d-corner') {
            const hx = (xMax - xMin) / n;
            const hy = (yMax - yMin) / m;
            return (x: number, y: number) => {
                const i = Math.max(0, Math.min(n - 1, Math.floor((x - xMin) / hx)));
                const j = Math.max(0, Math.min(m - 1, Math.floor((y - yMin) / hy)));
                return samples[j * n + i] ?? NaN;
            };
        }

        const hx = (xMax - xMin) / n;
        const hy = (yMax - yMin) / m;
        return (x: number, y: number) => {
            const i = Math.max(0, Math.min(n, Math.round((x - xMin) / hx)));
            const j = Math.max(0, Math.min(m, Math.round((y - yMin) / hy)));
            return samples[j * (n + 1) + i] ?? NaN;
        };
    }

}
