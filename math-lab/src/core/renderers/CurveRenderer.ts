import * as THREE from 'three';
import * as math from 'mathjs';
import type { IRenderer } from './IRenderer';
import type { CurveExpr } from '../../math_objects/types';

export class CurveRenderer implements IRenderer {
    readonly group = new THREE.Group();
    private line: THREE.Line | null = null;
    private userVisible = true;
    private modeVisible = false;  // 由 Plotter 路由控制

    constructor(
        public readonly curve: CurveExpr,
        private readonly xRange: [number, number] = [-8, 8],
        private readonly steps: number = 320,
    ) { }

    get visible(): boolean {
        return this.userVisible && this.modeVisible;
    }

    /**
     * 更新曲线 —— 复用 BufferGeometry / Material, 仅替换 position 数组
     */
    draw(): void {
        const compiled = this.curve.node.compile();
        const points = this._sampleCurve(compiled);

        if (points.length < 2) {
            this.group.visible = false;
            return;
        }

        // 仅首次创建 geometry + material
        if (!this.line) {
            const geometry = new THREE.BufferGeometry();
            // 初始分配 points.length 个顶点,后续可能增长
            geometry.setAttribute(
                'position',
                new THREE.BufferAttribute(new Float32Array(points.length * 3), 3),
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

        // 原地更新 position buffer
        const posAttr = this.line.geometry.attributes['position'] as THREE.BufferAttribute;
        const currentArray = posAttr.array as Float32Array;
        const needed = points.length * 3;

        // 如果当前 buffer 不够大,替换为更大的
        let targetArray: Float32Array;
        if (currentArray.length < needed) {
            targetArray = new Float32Array(needed);
            posAttr.array = targetArray;
        } else {
            targetArray = currentArray;
        }

        for (let i = 0; i < points.length; i++) {
            const offset = i * 3;
            targetArray[offset] = points[i].x;
            targetArray[offset + 1] = points[i].y;
            targetArray[offset + 2] = points[i].z;
        }

        posAttr.needsUpdate = true;
        // 控制实际绘制范围（顶点数可能比 buffer 容量小）
        this.line.geometry.setDrawRange(0, points.length);

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
    private _sampleCurve(compiled: math.EvalFunction): THREE.Vector3[] {
        const result: THREE.Vector3[] = [];
        const [xMin, xMax] = this.xRange;
        const step = (xMax - xMin) / this.steps;
        const scope: Record<string, number> = {};
        for (const c of this.curve.coefficients) scope[c.name] = c.value;

        for (let x = xMin; x <= xMax; x += step) {
            try {
                scope.x = x;
                const y = compiled.evaluate(scope);
                if (isFinite(y)) result.push(new THREE.Vector3(x, y, 0));
            } catch (_) { /* 跳过奇异点 */ }
        }
        return result;
    }
}