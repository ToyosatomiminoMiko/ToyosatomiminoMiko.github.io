/**
 * 曲线渲染器。
 * 数值采样统一走 MathComputeEngine，渲染层不再自行解析表达式。
 */
import * as THREE from 'three';
import type { IRenderer } from './IRenderer';
import type { CurveObject } from '../../../compiler/ir/types';
import { MathComputeEngine } from '../../../math/compute/MathComputeEngine';
import { logWarning } from '../../../service/logger';

const curveComputeEngine = new MathComputeEngine();

export class CurveRenderer implements IRenderer {
    readonly group = new THREE.Group();
    private line: THREE.Line | null = null;
    private userVisible = true;
    private xRange: [number, number];
    private steps: number;
    private disposed = false;

    constructor(public curve: CurveObject) {
        this.xRange = curve.range ?? [-8, 8];
        this.steps = curve.segments ?? 320;
    }

    get visible(): boolean {
        return this.userVisible;
    }

    draw(): void {
        const posAttr = this._ensureLine();
        const target = posAttr.array as Float32Array;

        void curveComputeEngine
            .sampleCurve({
                expr: this.curve.expr,
                coefficients: this.curve.coefficients,
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
                if (this.disposed) return;
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
        this.xRange = curve.range ?? [-8, 8];
        this.steps = curve.segments ?? 320;
    }

    dispose(): void {
        this.disposed = true;
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
