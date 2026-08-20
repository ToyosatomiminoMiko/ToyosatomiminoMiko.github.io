import * as THREE from 'three';
import { type IRenderer } from './renderers/IRenderer';
import { CurveRenderer } from './renderers/CurveRenderer';
import { SurfaceRenderer } from './renderers/SurfaceRenderer';
import { PointRenderer } from './renderers/PointRenderer';
import { VectorRenderer } from './renderers/VectorRenderer';
import { VectorFieldRenderer } from './renderers/VectorFieldRenderer';
import { SolidRenderer } from './renderers/SolidRenderer';
import type {
    BoxObject,
    ConicSolidObject,
    CurveObject,
    PointObject,
    SceneObject,
    SphereObject,
    SurfaceObject,
    VectorFieldObject,
    VectorObject,
} from '../../compiler/ir/types';

/**
 * 扩展的渲染器接口 -- 在 IRenderer 基础上增加可选能力
 * - updateRef: 更新内部持有的数学对象引用(所有具体渲染器都有)
 */
interface UpdatableRenderer extends IRenderer {
    updateRef?(data: SceneObject): void;
}

/**
 * 绘图门面 -- 将数学对象路由到对应的专属渲染器
 *
 * 统一 3D 场景:curve 默认绘制在 z=0 平面,surface、point、vector
 * 与 vector_field 共存于同一个场景.
 */
export class Plotter {
    /** 所有渲染器的 Group 挂载点,挂到 Scene 下 */
    private readonly plotContainer = new THREE.Group();

    /**
     * @cache
     * 缓存目的:维护对象 id 到专属 renderer 的索引，避免每次刷新都创建 GPU 对象.
     * 键/失效策略:对象 id -> UpdatableRenderer;对象消失或类型变化时 remove/重建.
     * 生命周期:跟随 Plotter 实例，dispose 时清空.
     */
    private readonly rendererMap = new Map<number, UpdatableRenderer>();

    constructor(private readonly scene: THREE.Scene) {
        this.scene.add(this.plotContainer);
    }

    // ============================================================
    //  公开绘制 API
    // ============================================================

    drawCurve(curve: CurveObject): void {
        const renderer = this._getOrCreate(curve.id, CurveRenderer, curve);
        this._draw(renderer, curve);
    }

    drawSurface(surface: SurfaceObject): void {
        const renderer = this._getOrCreate(surface.id, SurfaceRenderer, surface);
        this._draw(renderer, surface);
    }

    drawPoint(point: PointObject): void {
        const renderer = this._getOrCreate(point.id, PointRenderer, point);
        this._draw(renderer, point);
    }

    drawVector(vec: VectorObject): void {
        const renderer = this._getOrCreate(vec.id, VectorRenderer, vec);
        this._draw(renderer, vec);
    }

    drawVectorField(vf: VectorFieldObject): void {
        const renderer = this._getOrCreate(vf.id, VectorFieldRenderer, vf);
        this._draw(renderer, vf);
    }

    drawSolid(solid: SphereObject | BoxObject | ConicSolidObject): void {
        const renderer = this._getOrCreate(solid.id, SolidRenderer, solid);
        this._draw(renderer, solid);
    }

    // ============================================================
    //  生命周期 & 可见性
    // ============================================================

    /**
     * @cache-access
     * 从 rendererMap 移除并释放指定 renderer.
     */
    remove(id: number): void {
        const renderer = this.rendererMap.get(id);
        if (!renderer) return;
        renderer.dispose();
        this.plotContainer.remove(renderer.group);
        this.rendererMap.delete(id);
    }

    /**
     * @cache-access
     * 命中 rendererMap 并同步可见性.
     */
    setVisible(id: number, visible: boolean): void {
        this.rendererMap.get(id)?.setVisible(visible);
    }

    /**
     * 对某个对象的渲染 group 应用 4x4 行主序场景变换.
     * 传入 null 时恢复单位变换.
     */
    applyTransform(id: number, matrix: number[][] | null): void {
        const renderer = this.rendererMap.get(id);
        if (!renderer) return;

        if (!matrix) {
            renderer.group.matrixAutoUpdate = true;
            renderer.group.matrix.identity();
            return;
        }

        const columnMajor = [
            matrix[0][0], matrix[1][0], matrix[2][0], matrix[3][0],
            matrix[0][1], matrix[1][1], matrix[2][1], matrix[3][1],
            matrix[0][2], matrix[1][2], matrix[2][2], matrix[3][2],
            matrix[0][3], matrix[1][3], matrix[2][3], matrix[3][3],
        ];
        const transform = new THREE.Matrix4();
        transform.fromArray(columnMajor);
        renderer.group.matrixAutoUpdate = false;
        renderer.group.matrix.copy(transform);
    }

    /**
     * @cache-access
     * 更新一个对象.
     *
     * @param redraw false 时只同步 renderer 内部的 SceneObject 引用,
     * 不重新触发数值采样/GPU 重建.这个能力供 DslApp 在参数只影响部分对象时
     * 使用,避免每次拖动滑块都重算所有 curve/surface/vector_field.
     */
    updateObject(obj: SceneObject, redraw = true): void {
        switch (obj.kind) {
            case 'curve':
                if (redraw) this.drawCurve(obj);
                else this._updateRef(obj);
                break;
            case 'surface':
                if (redraw) this.drawSurface(obj);
                else this._updateRef(obj);
                break;
            case 'point':
                if (redraw) this.drawPoint(obj);
                else this._updateRef(obj);
                break;
            case 'vector':
                if (redraw) this.drawVector(obj);
                else this._updateRef(obj);
                break;
            case 'vector_field':
                if (redraw) this.drawVectorField(obj);
                else this._updateRef(obj);
                break;
            case 'sphere':
            case 'box':
            case 'conic':
                if (redraw) this.drawSolid(obj);
                else this._updateRef(obj);
                break;
        }
    }

    /**
     * @cache-access
     * 遍历并清空 rendererMap，再把 plotContainer 从场景移除.
     */
    dispose(): void {
        for (const [id] of this.rendererMap) {
            this.remove(id);
        }
        this.scene.remove(this.plotContainer);
    }

    // ============================================================
    //  内部工具
    // ============================================================

    private _draw(renderer: UpdatableRenderer, data: SceneObject): void {
        renderer.updateRef?.(data);
        renderer.setVisible(data.enabled);
        renderer.draw();
    }

    /**
     * @cache-access
     * 从 rendererMap 命中已有 renderer，未命中或类型变化时创建并写入缓存.
     */
    private _getOrCreate<T extends UpdatableRenderer, D extends SceneObject>(
        id: number,
        Ctor: new (data: D) => T,
        initialData: D,
    ): T {
        let renderer = this.rendererMap.get(id);
        if (!(renderer instanceof Ctor)) {
            renderer?.dispose();
            if (renderer) this.plotContainer.remove(renderer.group);
            renderer = new Ctor(initialData);
            this.plotContainer.add(renderer.group);
            this.rendererMap.set(id, renderer);
        }
        return renderer as T;
    }

    /**
     * @cache-access
     * 只同步 renderer 引用和可见性，不触发数值采样与 GPU 重建.
     */
    private _updateRef(obj: SceneObject): void {
        const renderer = this.rendererMap.get(obj.id);
        if (!renderer) return;
        renderer.updateRef?.(obj);
        renderer.setVisible(obj.enabled);
    }
}
