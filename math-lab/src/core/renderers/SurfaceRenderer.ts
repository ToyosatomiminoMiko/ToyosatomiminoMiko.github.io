import * as THREE from 'three';
import { SurfaceMesh } from '../../visualization/SurfaceMesh';
import type { IRenderer } from './IRenderer';
import type { SurfaceExpr } from '../../math_objects/types';

/**
 * 曲面渲染器
 * - 复用 SurfaceMesh,仅分段数变化时才重建
 * - draw() 仅触发 SurfaceMesh.update(),零 GC 压力
 */
export class SurfaceRenderer implements IRenderer {
    readonly group = new THREE.Group();
    private mesh: SurfaceMesh | null = null;
    private userVisible = true;
    private modeVisible = false;

    constructor(
        private readonly surface: SurfaceExpr,
        private readonly range: [number, number] = [-6, 6],
        private segments: number = 64,
    ) { }

    get visible(): boolean {
        return this.userVisible && this.modeVisible;
    }

    draw(): void {
        // 分段数变化时重建（罕见路径）
        if (this.mesh && (this.mesh.cols !== this.segments || this.mesh.rows !== this.segments)) {
            this.group.remove(this.mesh.group);
            this.mesh.dispose();
            this.mesh = null;
        }

        if (!this.mesh) {
            this.mesh = new SurfaceMesh(this.segments, this.segments);
            this.group.add(this.mesh.group);
        }

        const compiled = this.surface.node.compile();
        this.mesh.update(
            compiled,
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
        (this as any).surface = surface;
    }

    dispose(): void {
        if (this.mesh) {
            this.mesh.dispose();
            this.mesh = null;
        }
    }
}