import * as THREE from 'three';
import { type IRenderer } from './renderers/IRenderer';
import { CurveRenderer } from './renderers/CurveRenderer';
import { SurfaceRenderer } from './renderers/SurfaceRenderer';
import { PointRenderer } from './renderers/PointRenderer';
import { VectorRenderer } from './renderers/VectorRenderer';
import type { MathObject, CurveExpr, SurfaceExpr, PointEntity, VectorEntity, VectorFieldExpr } from '../types';
import { VectorFieldRenderer } from './renderers/VectorFieldRenderer';

/**
 * 扩展的渲染器接口 -- 在 IRenderer 基础上增加可选能力
 * - updateRef: 更新内部持有的数学对象引用(所有具体渲染器都有)
 */
interface UpdatableRenderer extends IRenderer {
    updateRef?(data: any): void;
}

/**
 * 绘图门面 -- 将数学对象路由到对应的专属渲染器
 *
 * 职责:
 * - 管理 rendererMap<id, IRenderer> 的增删查
 * - 模式切换时同步各渲染器的 2D/3D 可见性
 * - 全部绘制与主线程帧同步(脏标记驱动或事件驱动)
 *
 * 不做的事:
 * - 不直接操作 BufferGeometry / Material / Mesh
 * - 不采样数据(采样由渲染器内部完成)
 * - 不管理 GPU 资源释放细节(委托 dispose)
 */
export class Plotter {
    /** 所有渲染器的 Group 挂载点,挂到 Scene 下 */
    private readonly plotContainer = new THREE.Group();

    /** id → 渲染器 映射 */
    private readonly rendererMap = new Map<number, IRenderer>();

    /** 当前视图模式,影响 Curve / Surface / VectorField 的可见性 */
    private currentMode: '2d' | '3d' = '2d';

    constructor(private readonly scene: THREE.Scene) {
        this.scene.add(this.plotContainer);
    }

    // ============================================================
    //  公开绘制 API
    // ============================================================

    /** 绘制曲线(仅在 2D 模式可见) */
    drawCurve(curve: CurveExpr): void {
        const renderer = this._getOrCreate(curve.id, CurveRenderer, curve);
        this._drawModeFiltered(renderer, curve);
    }

    /** 绘制曲面(仅在 3D 模式可见) */
    drawSurface(surface: SurfaceExpr): void {
        const renderer = this._getOrCreate(surface.id, SurfaceRenderer, surface);
        this._drawModeFiltered(renderer, surface);
    }

    /** 绘制空间点(2D/3D 均可见) */
    drawPoint(point: PointEntity): void {
        const renderer = this._getOrCreate(point.id, PointRenderer, point);
        renderer.updateRef?.(point);
        renderer.draw();
    }

    /** 绘制单箭头向量(2D/3D 均可见) */
    drawVector(vec: VectorEntity): void {
        const renderer = this._getOrCreate(vec.id, VectorRenderer, vec);
        renderer.updateRef?.(vec);
        renderer.draw();
    }

    /** 绘制向量场(仅在 3D 模式可见) */
    drawVectorField(vf: VectorFieldExpr): void {
        const renderer = this._getOrCreate(vf.id, VectorFieldRenderer, vf);
        this._drawModeFiltered(renderer, vf);
    }

    // ============================================================
    //  生命周期 & 可见性
    // ============================================================

    /** 移除并销毁指定 id 的渲染器 */
    remove(id: number): void {
        const renderer = this.rendererMap.get(id);
        if (!renderer) return;
        renderer.dispose();
        this.plotContainer.remove(renderer.group);
        this.rendererMap.delete(id);
    }

    /** 设置用户控制的可见性 */
    setVisible(id: number, visible: boolean): void {
        this.rendererMap.get(id)?.setVisible(visible);
    }

    /**
     * 根据对象数据刷新绘制
     * - 模式切换时调用,确保只绘制当前模式可见的对象
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

    /**
     * 全局模式切换
     * - 遍历所有渲染器,按模式更新其 modeVisible
     */
    public updateMode(mode: '2d' | '3d'): void {
        this.currentMode = mode;
        for (const renderer of this.rendererMap.values()) {
            // 每个渲染器声明自己的 mode，不再依赖 instanceof 分支
            if (typeof renderer.setModeVisible === 'function') {
                renderer.setModeVisible(this._isModeVisible(renderer, mode));
            }
        }
    }

    /** 释放全部 GPU 资源 */
    dispose(): void {
        for (const [id] of this.rendererMap) {
            this.remove(id);
        }
        this.scene.remove(this.plotContainer);
    }

    // ============================================================
    //  内部工具
    // ============================================================

    /**
     * 获取或创建渲染器 -- 消除各 draw 方法中重复的"取/建"逻辑
     * @param id      数学对象 id
     * @param Ctor    渲染器构造函数
     * @param initialData 首次创建时传入构造函数的初始数据
     */
    private _getOrCreate<T extends UpdatableRenderer>(
        id: number,
        Ctor: new (data: any) => T,
        initialData: any,
    ): T {
        let renderer = this.rendererMap.get(id);
        if (!(renderer instanceof Ctor)) {
            // 类型不匹配或无渲染器 -- 清理旧实例后新建
            renderer?.dispose();
            if (renderer) this.plotContainer.remove(renderer.group);
            renderer = new Ctor(initialData);
            this.plotContainer.add(renderer.group);
            this.rendererMap.set(id, renderer);
        }
        return renderer as T;
    }

    /**
     * 需要模式过滤的渲染器的统一绘制流程：
     *  1. 更新内部引用(适应 derive 等替换对象场景)
     *  2. 根据当前模式设置 modeVisible
     *  3. 应用用户可见性
     *  4. 调用 draw
     */
    private _drawModeFiltered(renderer: UpdatableRenderer, data: any): void {
        // 更新内部数据引用
        renderer.updateRef?.(data);

        // 防御式模式可见性判断
        if (typeof renderer.setModeVisible === 'function') {
            renderer.setModeVisible(this._isModeVisible(renderer, this.currentMode));
        }

        renderer.setVisible(data.enabled);
        renderer.draw();
    }

    /** 根据渲染器声明的 mode 判断当前视图模式是否可见 */
    private _isModeVisible(renderer: IRenderer, mode: '2d' | '3d'): boolean {
        return renderer.mode === 'both' || renderer.mode === mode;
    }
}
