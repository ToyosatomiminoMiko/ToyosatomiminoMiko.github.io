import * as THREE from 'three';
import type {
    IntegralTask,
    RiemannSide,
    SceneObject,
} from '../../compiler/ir/types';
import type { Mat4 } from '../../math/tensor/rowMajorMatrix';
import { IntegralVisualizer } from './IntegralVisualizer';
import type { MathComputeEngine } from '../../math/compute/MathComputeEngine';
import type { IntegralResult } from '../../math/compute/IntegralWasm';
import {
    clampIntegral1DVisualization,
    clampIntegral2DVisualization,
    clampIntegral3DVisualization,
    clampLebesgue1DVisualization,
    clampLebesgue2DVisualization,
} from '../../config/resourceBudget';

export type IntegralResultCallback = (name: string, value: number) => void;
export type IntegralErrorCallback = (name: string, message: string) => void;
export type IntegralDiagnosticFn = (
    level: 'warning' | 'error',
    message: string,
) => void;

/** 从整串方法名取出黎曼端点. */
function riemannSideOf(method: IntegralTask['method']): RiemannSide {
    switch (method) {
        case 'riemann:left':
            return 'left';
        case 'riemann:right':
            return 'right';
        case 'riemann:mid':
            return 'mid';
        default:
            throw new Error(`方法 ${method} 不是黎曼方法`);
    }
}

function isRiemann(method: IntegralTask['method']): boolean {
    return method.startsWith('riemann:');
}

/**
 * DSL 积分可视化执行器.
 *
 * 输入是编译后的 IntegralTask,数值计算复用积分 Worker(维度/域语义由
 * task 的显式 `dim`/`domainKind` 决定),可视化复用 IntegralVisualizer,
 * 缓存键使用积分名而不是对象 id,以支持同一个对象存在多个积分声明.
 *
 * region 域被积表达式与域边界曲线的"额外参数"通过 task.integrandCoefficients
 * 参与参数刷新 dirty 判定:拖动滑块命中任一参数即重算.
 */
export class DslIntegralRenderer {
    private readonly visualizer: IntegralVisualizer;
    private sequence = 0;

    /**
     * @cache
     * 缓存目的:记录每个积分任务当前的请求序号,用于丢弃过期异步结果.
     * 键/失效策略:积分名 -> sequence;sync 时按 dirty 范围刷新.
     * 生命周期:跟随 DslIntegralRenderer 实例.
     */
    private readonly taskSequences = new Map<string, number>();
    private disposed = false;

    constructor(
        scene: THREE.Scene,
        private readonly computeEngine: MathComputeEngine,
    ) {
        this.visualizer = new IntegralVisualizer(scene);
    }

    /**
     * @cache-access
     * 更新任务序号缓存,并只清理/重算受 dirty 对象或 dirty 参数影响的积分.
     */
    sync(
        tasks: IntegralTask[],
        objects: SceneObject[],
        transforms: Readonly<Record<number, Mat4>>,
        diagnostics: IntegralDiagnosticFn,
        dirtyObjectIds: ReadonlySet<number> | null = null,
        changedParams: ReadonlySet<string> | null = null,
        onResult?: IntegralResultCallback,
        onError?: IntegralErrorCallback,
    ): void {
        const affected = (task: IntegralTask): boolean =>
            (dirtyObjectIds?.has(task.objectId) ?? false)
            || task.integrandCoefficients.some((coefficient) =>
                changedParams?.has(coefficient.name) ?? false,
            );

        if (dirtyObjectIds || changedParams) {
            // 参数/对象只影响部分任务时,只清除受影响积分的可视化,
            // 其他积分继续保留,避免每次滑块变化都销毁/重建整组 GPU 对象.
            for (const task of tasks) {
                if (task.enabled && affected(task)) {
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

        const activeTasks = tasks.filter((task) => task.enabled);
        const tasksToRender = (dirtyObjectIds || changedParams)
            ? activeTasks.filter(affected)
            : activeTasks;
        if (tasksToRender.length === 0) return;

        void this._renderAll(
            tasksToRender,
            objects,
            transforms,
            diagnostics,
            onResult,
            onError,
        );
    }

    /**
     * @cache-access
     * 清理任务序号缓存并释放可视化资源.
     */
    dispose(): void {
        this.disposed = true;
        this.sequence += 1;
        this.taskSequences.clear();
        this.visualizer.dispose();
    }

    private async _renderAll(
        tasks: IntegralTask[],
        objects: SceneObject[],
        transforms: Readonly<Record<number, Mat4>>,
        diagnostics: IntegralDiagnosticFn,
        onResult?: IntegralResultCallback,
        onError?: IntegralErrorCallback,
    ): Promise<void> {
        for (const task of tasks) {
            const taskSequence = this.taskSequences.get(task.name) ?? this.sequence;
            const source = objects.find((object) => object.id === task.objectId);
            if (!source) {
                const message = `积分 ${task.name} 找不到被积分的源对象`;
                diagnostics('error', message);
                onError?.(task.name, message);
                continue;
            }
            // 区域实体被隐藏 => 不参与计算(语义见 feature.md).
            if (source.kind === 'region' && !source.enabled) {
                this.visualizer.clear(task.name);
                continue;
            }

            try {
                const result = await this.computeEngine.integrate(
                    task,
                    objects,
                    transforms,
                );
                const value = result.value;
                if (this.disposed || this.taskSequences.get(task.name) !== taskSequence) return;

                if (task.show) {
                    this._visualize(task, source, result, diagnostics);
                }
                onResult?.(task.name, value);
            } catch (error) {
                if (this.disposed || this.taskSequences.get(task.name) !== taskSequence) return;
                const message =
                    `积分 ${task.name} 计算失败: ${error instanceof Error ? error.message : String(error)}`;
                diagnostics('error', message);
                onError?.(task.name, message);
            }
        }
    }

    private _visualize(
        task: IntegralTask,
        source: SceneObject,
        result: IntegralResult,
        diagnostics: IntegralDiagnosticFn,
    ): void {
        switch (task.domainKind) {
            case 'interval':
                if (source.kind === 'curve') {
                    this._visualize1D(task, source, result, diagnostics);
                }
                break;
            case 'rectangle':
                if (source.kind === 'surface') {
                    this._visualize2DRect(task, source, result, diagnostics);
                }
                break;
            case 'region':
                if (source.kind === 'region') {
                    this._visualize2DRegion(task, source, result, diagnostics);
                }
                break;
            case 'solid':
                if (source.kind === 'sphere' || source.kind === 'box' || source.kind === 'conic') {
                    this._visualize3DSolid(task, source, result, diagnostics);
                }
                break;
        }
    }

    // ---- 1D 曲线域 ----
    private _visualize1D(
        task: IntegralTask,
        source: Extract<SceneObject, { kind: 'curve' }>,
        result: IntegralResult,
        diagnostics: IntegralDiagnosticFn,
    ): void {
        const [a, b] = task.range as [number, number];
        const fn = this._makeFn1D(a, b, result);
        const segments = task.segments;

        if (task.method !== 'lebesgue') {
            const visual = clampIntegral1DVisualization(segments);
            if (visual.decimated) {
                diagnostics(
                    'warning',
                    `积分 ${task.name} 的绘图分段已从 ${segments} 降采样到 ${visual.segments}`,
                );
            }
            if (isRiemann(task.method)) {
                this.visualizer.visualize2DRiemann(
                    source,
                    fn,
                    a,
                    b,
                    visual.segments,
                    task.name,
                    riemannSideOf(task.method),
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
            return;
        }

        const visualLebesgue1D = clampLebesgue1DVisualization(segments, task.layers);
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
    }

    // ---- 2D 曲面矩形域 ----
    private _visualize2DRect(
        task: IntegralTask,
        source: Extract<SceneObject, { kind: 'surface' }>,
        result: IntegralResult,
        diagnostics: IntegralDiagnosticFn,
    ): void {
        const [xMin, xMax, yMin, yMax] = task.range as [number, number, number, number];
        const fn = this._makeFn2D(xMin, xMax, yMin, yMax, result);
        this._visualize2DColumns(
            task,
            source,
            fn,
            [xMin, xMax],
            [yMin, yMax],
            diagnostics,
        );
    }

    // ---- 2D 区域(带)域 ----
    private _visualize2DRegion(
        task: IntegralTask,
        source: Extract<SceneObject, { kind: 'region' }>,
        result: IntegralResult,
        diagnostics: IntegralDiagnosticFn,
    ): void {
        const [xMin, xMax] = task.range as [number, number];
        const yMin = result.ya ?? NaN;
        const yMax = result.yb ?? NaN;
        if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) return;
        // 采样网格在带外为 NaN,_makeFn2D 把它转成"该格不可见".
        const fn = this._makeFn2D(xMin, xMax, yMin, yMax, result);
        this._visualize2DColumns(
            task,
            source,
            fn,
            [xMin, xMax],
            [yMin, yMax],
            diagnostics,
        );
    }

    /** 2D 矩形/区域域共用的柱/面/层可视化(方法端采样规则由 fn 透传). */
    private _visualize2DColumns(
        task: IntegralTask,
        source: Extract<SceneObject, { kind: 'surface' | 'region' }>,
        fn: (x: number, y: number) => number,
        xRange: [number, number],
        yRange: [number, number],
        diagnostics: IntegralDiagnosticFn,
    ): void {
        const segments = task.segments;
        if (task.method === 'lebesgue') {
            const visual = clampLebesgue2DVisualization(segments, task.layers);
            if (visual.decimated) {
                diagnostics(
                    'warning',
                    `积分 ${task.name} 的二维勒贝格绘图已降采样为 res=${visual.res}, layers=${visual.layers}`,
                );
            }
            this.visualizer.visualize3DLebesgue(
                source,
                fn,
                xRange,
                yRange,
                visual.layers,
                visual.res,
                task.name,
            );
            return;
        }

        if (
            task.domainKind === 'region'
            && (task.method === 'trapezoid' || task.method === 'simpson')
        ) {
            // region 的梯形/辛普森数值是 B1 累次积分,体元/曲面可视化按
            // 中点单元网格近似示意(数值不受影响).
            diagnostics(
                'warning',
                `积分 ${task.name} 的区域梯形/辛普森为累次积分,可视化按中点网格近似示意`,
            );
        }

        const visual = clampIntegral2DVisualization(segments);
        if (visual.decimated) {
            diagnostics(
                'warning',
                `积分 ${task.name} 的二维绘图每轴已从 ${segments} 降采样到 ${visual.segments}`,
            );
        }
        if (isRiemann(task.method)) {
            this.visualizer.visualize3DRiemann(
                source,
                fn,
                xRange,
                yRange,
                visual.segments,
                visual.segments,
                task.name,
            );
        } else if (task.method === 'trapezoid') {
            this.visualizer.visualize3DTrapezoid(
                source,
                fn,
                xRange,
                yRange,
                visual.segments,
                visual.segments,
                task.name,
            );
        } else {
            this.visualizer.visualize3DSimpson(
                source,
                fn,
                xRange,
                yRange,
                visual.segments,
                visual.segments,
                task.name,
            );
        }
    }

    // ---- 3D 实体域 ----
    private _visualize3DSolid(
        task: IntegralTask,
        source: Extract<SceneObject, { kind: 'sphere' | 'box' | 'conic' }>,
        result: IntegralResult,
        diagnostics: IntegralDiagnosticFn,
    ): void {
        if (result.sampleShape === '3d-skip' || !result.samples) {
            // f≡1 的 3D lebesgue 直接返回测度,不生成体元/层几何.
            return;
        }
        const n = result.n ?? task.segments;
        if (n === 0 || !Number.isFinite(result.xa) || !Number.isFinite(result.za)) return;
        const visual = clampIntegral3DVisualization(n);
        if (visual.decimated) {
            diagnostics(
                'warning',
                `积分 ${task.name} 的三维体元绘图已从每轴 ${n} 降采样到 ${visual.segments}`,
            );
        }
        this.visualizer.visualize3DSolid(
            source,
            n,
            result.samples,
            result.xa!,
            result.xb!,
            result.ya!,
            result.yb!,
            result.za!,
            result.zb!,
            visual.segments,
            task.name,
        );
    }

    // ============================================================
    // 采样网格 -> 连续函数映射(数值与可视化同源)
    // ============================================================

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

    /**
     * 二维网格 -> 单元函数.
     *
     * 约定:对矩形(rectangle)与区域(region)域,数值采样与可视化都把每个
     * 网格单元看成一个"柱":单元采样端(左/右/中,由方法决定)在带内时该
     * 柱可见,柱高 = 采样端被积值.`fn` 按单元左下角定位单元,返回该单元的
     * 采样端值(带外/非有限为 NaN,可视化跳过).
     */
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
        if (!samples || n === 0 || m === 0) return () => NaN;

        // (n+1)×(m+1) 全网格采样(trapezoid/simpson 的网格样本).
        if (result.sampleShape === '2d-grid') {
            const hx = (xMax - xMin) / n;
            const hy = (yMax - yMin) / m;
            return (x: number, y: number) => {
                const i = Math.max(0, Math.min(n, Math.round((x - xMin) / hx)));
                const j = Math.max(0, Math.min(m, Math.round((y - yMin) / hy)));
                return samples[j * (n + 1) + i] ?? NaN;
            };
        }

        // 单元采样(左/右/中端):每个单元一个样本值,按 floor 定位单元.
        const hx = (xMax - xMin) / n;
        const hy = (yMax - yMin) / m;
        return (x: number, y: number) => {
            const i = Math.max(0, Math.min(n - 1, Math.floor((x - xMin) / hx)));
            const j = Math.max(0, Math.min(m - 1, Math.floor((y - yMin) / hy)));
            return samples[j * n + i] ?? NaN;
        };
    }
}
