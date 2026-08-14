import * as THREE from 'three';
import { SurfaceMesh } from '../../visualization/SurfaceMesh';
import type { IRenderer } from './IRenderer';
import type { SurfaceExpr } from '../../math_objects/types';

/**
 * 曲面渲染器
 * - 复用 SurfaceMesh,仅分段数变化时才重建
 * - draw() 触发 SurfaceMesh.update(),后者把重采样交给 Worker,
 *   主线程只等待结果并更新 BufferGeometry
 */
export class SurfaceRenderer implements IRenderer {
    readonly group = new THREE.Group();
    readonly mode = '3d' as const;
    private mesh: SurfaceMesh | null = null;
    private userVisible = true;
    private modeVisible = false;
    constructor(
        private surface: SurfaceExpr,
        private readonly range: [number, number] = [-6, 6],
        private segments: number = 64,
    ) { }

    get visible(): boolean {
        return this.userVisible && this.modeVisible;
    }

    draw(): void {
        // 分段数变化时重建(罕见路径)
        if (this.mesh && (this.mesh.cols !== this.segments || this.mesh.rows !== this.segments)) {
            this.group.remove(this.mesh.group);
            this.mesh.dispose();
            this.mesh = null;
        }

        if (!this.mesh) {
            this.mesh = new SurfaceMesh(this.segments, this.segments);
            this.group.add(this.mesh.group);
        }
        // 不再需要 compile,改成 toString 标准化.自动处理隐式乘法,e^x 等语法糖
        const expr = this.surface.node.toString();

        this.mesh.update(
            expr, // 字符串,不再是 CompiledFn
            this.surface.coefficients,
            this.range[0], this.range[1],
            this.range[0], this.range[1],
        );

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

    updateRef(surface: SurfaceExpr): void {
        this.surface = surface;
    }

    dispose(): void {
        if (this.mesh) {
            this.mesh.dispose();
            this.mesh = null;
        }
    }
}
