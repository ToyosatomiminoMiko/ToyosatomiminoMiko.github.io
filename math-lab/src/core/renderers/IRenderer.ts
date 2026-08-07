import * as THREE from 'three';

/**
 * 渲染器抽象接口
 * - 每个具体渲染器负责一种数学对象的 WebGL 表现
 * - 生命周期: new -> draw/update -> setVisible -> dispose
 */
export interface IRenderer {
    /** THREE.Group 容器，挂载到场景中 */
    readonly group: THREE.Group;

    /** 当前可见性（含模式过滤后的结果） */
    readonly visible: boolean;

    /**
     * 更新渲染内容
     * - 首次调用等同于"创建"
     * - 后续调用应复用几何体和材质，只更新数据
     */
    draw(): void;

    /**
     * 设置用户控制的可见性
     * - 最终 visible = userEnabled && modeMatch
     */
    setVisible(v: boolean): void;

    /** 释放所有 GPU 资源 (geometry / material / mesh) */
    dispose(): void;
}