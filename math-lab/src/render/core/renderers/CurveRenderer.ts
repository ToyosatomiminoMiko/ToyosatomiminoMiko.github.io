/**
 * 曲线渲染器.
 * 数值采样统一走 MathComputeEngine,渲染层不再自行解析表达式.
 */
import * as THREE from 'three';
import { NUMERIC_CONFIG } from '../../../config/numericConfig';
import type { IRenderer } from './IRenderer';
import type { CurveObject } from '../../../compiler/ir/types';
import { MathComputeEngine } from '../../../math/compute/MathComputeEngine';
import {
    LatestRequestExecutor,
    type RequestClient,
} from '../../../math/compute/workers/LatestRequestExecutor';
import { reportSamplingFailure } from '../samplingErrors';

/**
 * @cache
 * 缓存目的:所有 CurveRenderer 共享同一个 MathComputeEngine,避免重复持有
 *           worker client 状态.
 * 键/失效策略:模块级单例;不手动失效.
 * 生命周期:模块级,随页面存活,worker 由应用级 dispose 统一释放.
 */
const curveComputeEngine = new MathComputeEngine();

type CurveRendererRequest = {
    id: number;
    expr: string;
    coeffNames: string[];
    coeffValues: number[];
    range: [number, number];
    segments: number;
};

// 把 CurveRenderer 自己的 latest-only 请求形状适配到 MathComputeEngine.
// 每个曲线 renderer 都有一个 executor,拖动滑块时不会向共享 worker 堆积旧请求.
const curveRequestClient: RequestClient<CurveRendererRequest, Float32Array> = {
    request(request) {
        return curveComputeEngine.sampleCurve({
            expr: request.expr,
            coefficients: request.coeffNames.map((name, index) => ({
                name,
                value: request.coeffValues[index] ?? 0,
                min: 0,
                max: 0,
                step: 1,
            })),
            range: request.range,
            segments: request.segments,
        });
    },
};

export class CurveRenderer implements IRenderer {
    readonly group = new THREE.Group();
    private line: THREE.Line | null = null;
    /**
     * @cache
     * 缓存目的:记录当前顶点缓冲能容纳的最大分段数,避免低 segments 创建的
     *           buffer 被高 segments 悄悄截断.
     * 键/失效策略:与 line/geometry 生命周期绑定;segments 超过容量时重建并更新.
     * 生命周期:跟随 CurveRenderer 实例.
     */
    private capacitySteps = 0;
    private userVisible = true;
    private xRange: [number, number];
    private steps: number;
    private disposed = false;
    /**
     * @cache
     * 缓存目的:把曲线采样请求收敛为 latest-only,避免高频参数刷新积压旧任务.
     * 键/失效策略:单飞队列;新请求会取代 pending 请求.
     * 生命周期:跟随 CurveRenderer 实例.
     */
    private readonly executor = new LatestRequestExecutor<
        CurveRendererRequest,
        Float32Array
    >(curveRequestClient);

    constructor(public curve: CurveObject) {
        this.xRange = curve.range ?? ([...NUMERIC_CONFIG.curve.defaultRange] as [number, number]);
        this.steps = curve.segments ?? NUMERIC_CONFIG.curve.defaultSegments;
    }

    get visible(): boolean {
        return this.userVisible;
    }

    draw(): void {
        const posAttr = this._ensureLine();
        const target = posAttr.array as Float32Array;

        void this.executor
            .request({
                expr: this.curve.expr,
                coeffNames: this.curve.coefficients.map((coefficient) => coefficient.name),
                coeffValues: this.curve.coefficients.map((coefficient) => coefficient.value),
                range: this.xRange,
                segments: this.steps,
            })
            .then((sampled) => {
                if (this.disposed) return;
                const pointCount = this._writeSampled(sampled, target);
                if (pointCount < 2) {
                    this.group.visible = false;
                    return;
                }
                posAttr.needsUpdate = true;
                this.line!.geometry.setDrawRange(0, pointCount);
                this.group.visible = this.visible;
            })
            .catch((error: Error) => {
                if (this.disposed || error.message === 'superseded') return;
                reportSamplingFailure({
                    kind: 'curve',
                    name: this.curve.name,
                    message: error.message,
                });
                this.group.visible = false;
            });
    }

    setVisible(v: boolean): void {
        this.userVisible = v;
        this.group.visible = this.visible;
    }

    updateRef(curve: CurveObject): void {
        this.curve = curve;
        this.xRange = curve.range ?? ([...NUMERIC_CONFIG.curve.defaultRange] as [number, number]);
        const nextSteps = curve.segments ?? NUMERIC_CONFIG.curve.defaultSegments;

        // 分段数变大时必须释放旧 line 并重新分配.
        // 否则 _writeSampled() 只能按旧容量截断,用户会看到一条被裁剪的曲线.
        if (nextSteps > this.capacitySteps) {
            this._disposeLine();
        }

        this.steps = nextSteps;
    }

    dispose(): void {
        this.disposed = true;
        this.executor.dispose();
        this._disposeLine();
    }

    /**
     * @cache-access
     * 命中已有 line 缓冲;容量不足时重建并更新 capacitySteps.
     */
    private _ensureLine(): THREE.BufferAttribute {
        if (this.line && this.capacitySteps >= this.steps) {
            return this.line.geometry.attributes.position as THREE.BufferAttribute;
        }

        this._disposeLine();

        const geometry = new THREE.BufferGeometry();
        const maxVerts = this.steps + 2;
        geometry.setAttribute(
            'position',
            new THREE.BufferAttribute(new Float32Array(maxVerts * 3), 3),
        );
        const material = new THREE.LineBasicMaterial({
            color: this.curve.color || '#ffffff',
            linewidth: 1,
            transparent: true,
            opacity: 0.95,
        });
        this.line = new THREE.Line(geometry, material);
        this.group.add(this.line);
        this.capacitySteps = this.steps;
        return geometry.attributes.position as THREE.BufferAttribute;
    }

    /**
     * @cache-access
     * 释放 line 并把容量缓存归零.
     */
    private _disposeLine(): void {
        if (!this.line) return;

        this.group.remove(this.line);
        this.line.geometry?.dispose();
        const mat = this.line.material;
        (Array.isArray(mat) ? mat : [mat]).forEach((material) => material?.dispose());
        this.line = null;
        this.capacitySteps = 0;
    }

    private _writeSampled(sampled: Float32Array, target: Float32Array): number {
        const count = sampled.length / 3;
        const writeCount = Math.min(count, Math.floor(target.length / 3));
        target.set(sampled.subarray(0, writeCount * 3));
        return writeCount;
    }
}
