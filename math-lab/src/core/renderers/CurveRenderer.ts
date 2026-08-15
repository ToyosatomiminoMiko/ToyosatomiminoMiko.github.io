import * as THREE from 'three';
import { parse, type EvalFunction } from 'mathjs';
import type { IRenderer } from './IRenderer';
import type { CurveObject } from '../../ir/types';
import { compilationCache } from '../../math_objects/CompilationCache';
import { sample_curve as wasmSampleCurve } from '../../wasm/ml_wasm';
import { ensureWasmReady } from '../../wasmRuntime';
import { logWarning } from '../../service/logger';

let wasmReady = false;
const wasmInit = ensureWasmReady().then(() => {
    wasmReady = true;
}).catch(() => {
    wasmReady = false;
});

void wasmInit;

export class CurveRenderer implements IRenderer {
    readonly group = new THREE.Group();
    private line: THREE.Line | null = null;
    private userVisible = true;
    private xRange: [number, number];
    private steps: number;

    constructor(public curve: CurveObject) {
        this.xRange = curve.range ?? [-8, 8];
        this.steps = curve.segments ?? 320;
    }

    get visible(): boolean {
        return this.userVisible;
    }

    /**
     * 更新曲线: 复用 BufferGeometry / Material, 仅替换 position 数组
     */
    draw(): void {
        const compiled = this._compiled();

        // 预分配足够大的 buffer
        const maxVerts = this.steps + 2;
        const needed = maxVerts * 3;

        if (!this.line) {
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute(
                'position',
                new THREE.BufferAttribute(new Float32Array(needed), 3),
            );
            const material = new THREE.LineBasicMaterial({
                color: this.curve.color || '#ffffff',
                linewidth: 1,
                transparent: true,
                opacity: 0.95,
            });
            this.line = new THREE.Line(geometry, material);
            this.group.add(this.line);
        }

        let posAttr = this.line.geometry.attributes['position'] as THREE.BufferAttribute;
        if (posAttr.array.length < needed) {
            posAttr.array = new Float32Array(needed);
        }

        // 直接写入,零分配
        const target = posAttr.array as Float32Array;
        const pointCount = wasmReady
            ? this._sampleCurveWasm(target)
            : this._sampleCurveDirect(compiled, target, 0);

        if (pointCount < 2) {
            this.group.visible = false;
            return;
        }

        posAttr.needsUpdate = true;
        this.line.geometry.setDrawRange(0, pointCount);
        this.group.visible = this.visible;
    }

    setVisible(v: boolean): void {
        this.userVisible = v;
        this.group.visible = this.visible;
    }

    /** 更新数学对象引用(系数/颜色变化时由 Plotter 调用) */
    updateRef(curve: CurveObject): void {
        this.curve = curve;
        this.xRange = curve.range ?? [-8, 8];
        this.steps = curve.segments ?? 320;
    }

    dispose(): void {
        if (this.line) {
            this.line.geometry?.dispose();
            const mat = this.line.material;
            (Array.isArray(mat) ? mat : [mat]).forEach(m => m?.dispose());
            this.line = null;
        }
    }

    // -------------------------------------------------------
    // 内部:采样
    // -------------------------------------------------------
    /**
     * 采样并直接写入 target Float32Array
     * @returns 实际写入的顶点数
     */
    private _sampleCurveDirect(
        compiled: EvalFunction,
        target: Float32Array,
        startOffset: number,
    ): number {
        const [xMin, xMax] = this.xRange;
        const step = (xMax - xMin) / this.steps;
        // scope 复用(已优化)
        const scope: Record<string, number> = {};
        for (const c of this.curve.coefficients) scope[c.name] = c.value;

        let count = 0;
        for (let x = xMin; x <= xMax; x += step) {
            scope.x = x;
            try {
                const y = compiled.evaluate(scope) as number;
                if (isFinite(y)) {
                    const dest = startOffset + count * 3;
                    target[dest] = x;
                    target[dest + 1] = y;
                    target[dest + 2] = 0;
                    count++;
                }
            } catch (_) { /* 跳过奇异点 */ }
        }
        return count;
    }

    /** 把字符串表达式编译成可复用的 mathjs 求值函数. */
    private _compiled(): EvalFunction {
        const coeffsKey = this.curve.coefficients
            .map((coefficient) => `${coefficient.name}=${coefficient.value}`)
            .join(',');
        return compilationCache.getByExpr(
            this.curve.expr,
            coeffsKey,
            () => parse(this.curve.expr).compile(),
        );
    }

    /**
     * 使用 Rust/WASM 采样曲线,并直接写入目标数组.
     *
     * 返回实际写入的顶点数.若 WASM 调用失败,则回退到 mathjs 采样.
     */
    private _sampleCurveWasm(target: Float32Array): number {
        try {
            const sampled = wasmSampleCurve(
                this.curve.expr,
                this.curve.coefficients.map((coefficient) => coefficient.name),
                new Float64Array(this.curve.coefficients.map((coefficient) => coefficient.value)),
                this.xRange[0],
                this.xRange[1],
                this.steps,
            );

            const count = sampled.length / 3;
            if (count * 3 > target.length) {
                target.set(sampled.subarray(0, target.length));
                return target.length / 3;
            }

            target.set(sampled);
            return count;
        } catch (error) {
            logWarning('CurveRenderer', 'WASM 曲线采样失败,回退到 mathjs:', error);
            const compiled = this._compiled();
            return this._sampleCurveDirect(compiled, target, 0);
        }
    }
}
