import * as THREE from 'three';
import * as math from 'mathjs';
import type { IRenderer } from './IRenderer';
import type { CurveExpr } from '../../math_objects/types';

export class CurveRenderer implements IRenderer {
    readonly group = new THREE.Group();
    private line: THREE.Line | null = null;
    private userVisible = true;
    private modeVisible = false;  // 由 Plotter 路由控制
    // 编译缓存
    private _compiledNode: math.MathNode | null = null;
    private _compiledFn: math.EvalFunction | null = null;
    constructor(
        public curve: CurveExpr,
        private readonly xRange: [number, number] = [-8, 8],
        private readonly steps: number = 320,
    ) { }

    get visible(): boolean {
        return this.userVisible && this.modeVisible;
    }

    /**
     * 更新曲线: 复用 BufferGeometry / Material, 仅替换 position 数组
     */
    draw(): void {
        // 编译缓存
        if (this._compiledNode !== this.curve.node || !this._compiledFn) {
            this._compiledFn = this.curve.node.compile();
            this._compiledNode = this.curve.node;
        }

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
        const pointCount = this._sampleCurveDirect(
            this._compiledFn!,
            posAttr.array as Float32Array,
            0,
        );

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

    /** 供 Plotter 模式切换时调用 */
    setModeVisible(v: boolean): void {
        this.modeVisible = v;
        this.group.visible = this.visible;
    }

    /** 更新数学对象引用(系数/颜色变化时由 Plotter 调用) */
    updateRef(curve: CurveExpr): void {
        (this as any).curve = curve;
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
        compiled: math.EvalFunction,
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
}