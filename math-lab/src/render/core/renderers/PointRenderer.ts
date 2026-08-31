import * as THREE from 'three';
import type { IRenderer } from './IRenderer';
import type { PointObject } from '../../../compiler/ir/types';

/** 点对象的全局渲染样式,由右侧"点"面板控制. */
export interface PointStyle {
    radius: number;
    visible: boolean;
}

/**
 * 空间点渲染器 —— 小球
 * - 使用单位球,半径通过 scale 控制,避免每次改值重建几何体
 * - draw() 更新 position/color/尺寸,并组合对象与全局可见性
 */
export class PointRenderer implements IRenderer {
    readonly group = new THREE.Group();
    private sphere: THREE.Mesh;
    private material: THREE.MeshPhongMaterial;
    private style: PointStyle;

    constructor(
        private point: PointObject,
        style?: PointStyle,
    ) {
        this.style = style ?? { radius: 0.2, visible: true };
        const geo = new THREE.SphereGeometry(1, 16, 16);
        this.material = new THREE.MeshPhongMaterial({
            color: point.color,
            emissive: 0x000000,
            specular: 0x333333,
            shininess: 40,
        });
        this.sphere = new THREE.Mesh(geo, this.material);
        this.group.add(this.sphere);
    }

    get visible(): boolean {
        return this.point.enabled && this.style.visible;
    }

    draw(): void {
        this.sphere.position.set(this.point.x, this.point.y, this.point.z);
        this.material.color.set(this.point.color);
        this.sphere.scale.setScalar(this.style.radius);
        this.group.visible = this.point.enabled && this.style.visible;
    }

    setVisible(v: boolean): void {
        // 对象列表控制 enabled,这里同步;全局隐藏仍要生效
        this.group.visible = v && this.style.visible;
    }

    /** 应用全局点样式(尺寸/可见性)并立即刷新 */
    setStyle(style: PointStyle): void {
        this.style = style;
        this.sphere.scale.setScalar(style.radius);
        this.group.visible = this.point.enabled && style.visible;
    }

    updateRef(point: PointObject): void {
        this.point = point;
    }

    dispose(): void {
        this.sphere.geometry.dispose();
        this.material.dispose();
    }
}
