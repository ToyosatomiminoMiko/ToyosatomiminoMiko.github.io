import * as THREE from 'three';
import type { IRenderer } from './IRenderer';
import type { PointEntity } from '../../math_objects/types';

/**
 * 空间点渲染器 —— 小球
 * - geometry 是静态的(SphereGeometry 复用)
 * - draw() 仅更新 position 和 color
 */
export class PointRenderer implements IRenderer {
    readonly group = new THREE.Group();
    private sphere: THREE.Mesh;
    private material: THREE.MeshPhongMaterial;

    constructor(private readonly point: PointEntity) {
        const geo = new THREE.SphereGeometry(0.2, 16, 16);
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
        // point 不受 2D/3D 模式限制，始终显示
        return this.point.enabled;
    }

    draw(): void {
        this.sphere.position.set(this.point.x, this.point.y, this.point.z);
        this.material.color.set(this.point.color);
        this.group.visible = this.visible;
    }

    setVisible(v: boolean): void {
        // point 的 enabled 由 MathObjectManager 管理，这里同步
        // 注意: PointEntity.enabled 可能已被外部修改
        // 这里只控制 group.visible，不修改 point.enabled
        this.group.visible = v;
    }

    updateRef(point: PointEntity): void {
        (this as any).point = point;
    }

    dispose(): void {
        this.sphere.geometry.dispose();
        this.material.dispose();
    }
}