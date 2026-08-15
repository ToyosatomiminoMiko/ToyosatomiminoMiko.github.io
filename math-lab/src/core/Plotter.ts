import * as THREE from 'three';
import { type IRenderer } from './renderers/IRenderer';
import { CurveRenderer } from './renderers/CurveRenderer';
import { SurfaceRenderer } from './renderers/SurfaceRenderer';
import { PointRenderer } from './renderers/PointRenderer';
import { VectorRenderer } from './renderers/VectorRenderer';
import { VectorFieldRenderer } from './renderers/VectorFieldRenderer';
import type {
    CurveObject,
    PointObject,
    SceneObject,
    SurfaceObject,
    VectorFieldObject,
    VectorObject,
} from '../ir/types';

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
 * 统一 3D 场景:curve 默认绘制在 z=0 平面，surface\point\vector\
 * vector_field 都共存于同一个场景.
 */
export class Plotter {
    /** 所有渲染器的 Group 挂载点,挂到 Scene 下 */
    private readonly plotContainer = new THREE.Group();

    /** id → 渲染器 映射 */
    private readonly rendererMap = new Map<number, IRenderer>();

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

    // ============================================================
    //  生命周期 & 可见性
    // ============================================================

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

    updateObject(obj: SceneObject): void {
        switch (obj.kind) {
            case 'curve':
                this.drawCurve(obj);
                break;
            case 'surface':
                this.drawSurface(obj);
                break;
            case 'point':
                this.drawPoint(obj);
                break;
            case 'vector':
                this.drawVector(obj);
                break;
            case 'vector_field':
                this.drawVectorField(obj);
                break;
        }
    }

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
}
