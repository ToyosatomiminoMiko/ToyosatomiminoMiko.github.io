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
import { logWarning } from '../../../service/logger';

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
    private userVisible = true;
    private xRange: [number, number];
    private steps: number;
    private disposed = false;
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
                logWarning('CurveRenderer', '曲线采样失败:', error);
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
        this.steps = curve.segments ?? NUMERIC_CONFIG.curve.defaultSegments;
    }

    dispose(): void {
        this.disposed = true;
        this.executor.dispose();
        if (this.line) {
            this.line.geometry?.dispose();
            const mat = this.line.material;
            (Array.isArray(mat) ? mat : [mat]).forEach((material) => material?.dispose());
            this.line = null;
        }
    }

    private _ensureLine(): THREE.BufferAttribute {
        if (this.line) {
            return this.line.geometry.attributes.position as THREE.BufferAttribute;
        }

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
        return geometry.attributes.position as THREE.BufferAttribute;
    }

    private _writeSampled(sampled: Float32Array, target: Float32Array): number {
        const count = sampled.length / 3;
        const writeCount = Math.min(count, Math.floor(target.length / 3));
        target.set(sampled.subarray(0, writeCount * 3));
        return writeCount;
    }
}
