import * as THREE from 'three';

export type RendererMode = '2d' | '3d' | 'both';

/**
 * 渲染器抽象接口
 * - 每个具体渲染器负责一种数学对象的 WebGL 表现
 * - 生命周期: new -> draw/update -> setVisible -> dispose
 */
export interface IRenderer {
    /** THREE.Group 容器,挂载到场景中 */
    readonly group: THREE.Group;

    /** 渲染器所属视图模式;both 表示 2D/3D 均可见 */
    readonly mode: RendererMode;

    /** 当前可见性(含模式过滤后的结果) */
    readonly visible: boolean;

    /**
     * 更新渲染内容
     * - 首次调用等同于"创建"
     * - 后续调用应复用几何体和材质,只更新数据
     */
    draw(): void;

    /**
     * 设置用户控制的可见性
     * - 最终 visible = userEnabled && modeMatch
     */
    setVisible(v: boolean): void;

    /** 释放所有 GPU 资源 (geometry / material / mesh) */
    dispose(): void;

    //  可选扩展(不强制所有渲染器实现)
    /**
     * 模式可见性过滤
     * - 实现此方法表明该渲染器需要区分 2D/3D 模式可见性
     * - 不应实现的不需要此方法，始终按 userVisible 控制
     */
    setModeVisible?(v: boolean): void;
}
