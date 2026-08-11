import * as THREE from 'three';
import { IRenderer } from './renderers/IRenderer';
import { CurveRenderer } from './renderers/CurveRenderer';
import { SurfaceRenderer } from './renderers/SurfaceRenderer';
import { PointRenderer } from './renderers/PointRenderer';
import { VectorRenderer } from './renderers/VectorRenderer';
import type { MathObject, CurveExpr, SurfaceExpr, PointEntity, VectorEntity, VectorFieldExpr } from '../types';
import { VectorFieldRenderer } from './renderers/VectorFieldRenderer';

/**
 * 绘图门面 -- 将四种数学对象路由到对应的专属渲染器
 *
 * 职责:
 * - 管理 rendererMap<id, IRenderer> 的增删查
 * - 模式切换时同步各渲染器的 modeVisible
 * - 全部与主线程帧同步
 *
 * 不做的事:
 * - 不再直接操作 BufferGeometry / Material / Mesh
 * - 不采样数据
 * - 不管理 GPU 资源释放细节
 */
export class Plotter {
    private readonly plotContainer = new THREE.Group();
    private readonly rendererMap = new Map<number, IRenderer>();
    private currentMode: '2d' | '3d' = '2d';

    constructor(private readonly scene: THREE.Scene) {
        this.scene.add(this.plotContainer);
    }

    // ============================================================
    //  公开 API(签名与旧版完全兼容)
    // ============================================================

    drawCurve(curve: CurveExpr): void {
        let renderer = this.rendererMap.get(curve.id);
        if (!(renderer instanceof CurveRenderer)) {
            // 之前是另一种类型或不存在 -- 清理旧的,创建新的
            renderer?.dispose();
            if (renderer) this.plotContainer.remove(renderer.group);

            renderer = new CurveRenderer(curve);
            this.plotContainer.add(renderer.group);
            this.rendererMap.set(curve.id, renderer);
        }
        // 更新引用和可见性
        // 更好的做法是 CurveRenderer 暴露 updateMathObject 方法,但为了兼容先这样
        // 实际:CurveRenderer.draw() 中使用 this.curve,我们需要更新它
        this._refreshCurveRenderer(curve, renderer as CurveRenderer);
        this._syncModeVisibility(renderer);
        renderer.setVisible(curve.enabled);
        renderer.draw();
    }

    drawSurface(surface: SurfaceExpr): void {
        let renderer = this.rendererMap.get(surface.id);
        if (!(renderer instanceof SurfaceRenderer)) {
            renderer?.dispose();
            if (renderer) this.plotContainer.remove(renderer.group);

            renderer = new SurfaceRenderer(surface);
            this.plotContainer.add(renderer.group);
            this.rendererMap.set(surface.id, renderer);
        }
        this._refreshSurfaceRenderer(surface, renderer as SurfaceRenderer);
        this._syncModeVisibility(renderer);
        renderer.setVisible(surface.enabled);
        renderer.draw();
    }

    drawPoint(point: PointEntity): void {
        let renderer = this.rendererMap.get(point.id);
        if (!(renderer instanceof PointRenderer)) {
            renderer?.dispose();
            if (renderer) this.plotContainer.remove(renderer.group);

            renderer = new PointRenderer(point);
            this.plotContainer.add(renderer.group);
            this.rendererMap.set(point.id, renderer);
        }
        (renderer as PointRenderer).updateRef(point);
        renderer.draw();
    }

    drawVector(vec: VectorEntity): void {
        let renderer = this.rendererMap.get(vec.id);
        if (!(renderer instanceof VectorRenderer)) {
            renderer?.dispose();
            if (renderer) this.plotContainer.remove(renderer.group);

            renderer = new VectorRenderer(vec);
            this.plotContainer.add(renderer.group);
            this.rendererMap.set(vec.id, renderer);
        }
        (renderer as VectorRenderer).updateRef(vec);
        renderer.draw();
    }

    drawVectorField(vf: VectorFieldExpr): void {
        let renderer = this.rendererMap.get(vf.id);
        if (!(renderer instanceof VectorFieldRenderer)) {
            renderer?.dispose();
            if (renderer) this.plotContainer.remove(renderer.group);

            renderer = new VectorFieldRenderer(vf);
            this.plotContainer.add(renderer.group);
            this.rendererMap.set(vf.id, renderer);
        }
        (renderer as VectorFieldRenderer).updateRef(vf);
        this._syncModeVisibility(renderer);
        renderer.setVisible(vf.enabled);
        renderer.draw();
    }

    remove(id: number): void {
        const renderer = this.rendererMap.get(id);
        if (!renderer) return;
        renderer.dispose();
        this.plotContainer.remove(renderer.group);
        this.rendererMap.delete(id);
    }

    setVisible(id: number, visible: boolean): void {
        this.rendererMap.get(id)?.setVisible(visible);
    }

    /**
     * 根据对象数据刷新绘制(表达式字符串改变 / 模式切换时调用)
     */
    updateObject(obj: MathObject, mode: '2d' | '3d'): void {
        switch (obj.kind) {
            case 'curve':
                if (mode === '2d') this.drawCurve(obj);
                break;
            case 'surface':
                if (mode === '3d') this.drawSurface(obj);
                break;
            case 'point':
                this.drawPoint(obj);
                break;
            case 'vector':
                this.drawVector(obj);
                break;
            case 'vector_field':
                if (mode === '3d') this.drawVectorField(obj);
                break;
        }
    }

    updateMode(mode: '2d' | '3d'): void {
        this.currentMode = mode;
        for (const renderer of this.rendererMap.values()) {
            this._syncModeVisibility(renderer);
        }
    }

    dispose(): void {
        for (const [id] of this.rendererMap) {
            this.remove(id);
        }
        this.scene.remove(this.plotContainer);
    }

    // ============================================================
    //  内部
    // ============================================================

    /**
     * 同步模式可见性到渲染器
     * - CurveRenderer 仅在 2D 模式下可见
     * - SurfaceRenderer 仅在 3D 模式下可见
     * - Point / Vector 始终 modeVisible = true
     */
    private _syncModeVisibility(renderer: IRenderer): void {
        if (renderer instanceof CurveRenderer) {
            renderer.setModeVisible(this.currentMode === '2d');
        } else if (renderer instanceof SurfaceRenderer) {
            renderer.setModeVisible(this.currentMode === '3d');
        } else if (renderer instanceof VectorFieldRenderer) {
            renderer.setModeVisible(this.currentMode === '3d');
            // PointRenderer / VectorRenderer 没有 setModeVisible,group 始终按 userVisible
        }
    }
    /**
     * 由于 CurveRenderer 构造函数持有 CurveExpr 引用,
     * 当原对象被替换(derive 生成新对象复用了 id)时,需要更新内部引用.
     */
    private _refreshCurveRenderer(curve: CurveExpr, renderer: CurveRenderer): void {
        renderer.updateRef(curve);
    }

    private _refreshSurfaceRenderer(surface: SurfaceExpr, renderer: SurfaceRenderer): void {
        renderer.updateRef(surface);
    }
}