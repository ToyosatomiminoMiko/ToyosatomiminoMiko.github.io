import * as THREE from 'three';

/**
 * GradientVisualizer
 *
 * 在场景中绘制三个临时对象:
 *   1. 标记点  — 小球,表示 (x₀, y₀, z₀)
 *   2. 法向量  — 箭头,从切点出发,沿法线方向
 *   3. 切平面  — 半透明小方片,贴在曲面上
 *
 * 每次 update 先清除上一帧内容,不产生垃圾对象堆积
 */
export class GradientVisualizer {
    private _scene: THREE.Scene;
    /** 所有临时对象放在同一个 group 里 */
    private _group: THREE.Group;
    /** 固定 id,区分于积分可视化等其他临时对象 */
    private static readonly ID = '__gradient_preview__';
    // 预创建并复用的对象
    private _dot: THREE.Mesh | null = null;
    private _arrow: THREE.ArrowHelper | null = null;
    private _plane: THREE.Mesh | null = null;
    constructor(scene: THREE.Scene) {
        this._scene = scene;
        this._group = new THREE.Group();
        this._group.name = GradientVisualizer.ID;
        this._scene.add(this._group);
    }

    // ============================================================
    //  公开方法
    // ============================================================

    /**
     * 更新预览（先清除旧的再重新画）
     *
     * @param x0   切点 x
     * @param y0   切点 y
     * @param z0   f(x₀, y₀)
     * @param fx   ∂f/∂x |(x₀,y₀)
     * @param fy   ∂f/∂y |(x₀,y₀)
     * @param normalDir  归一化法向量 [nx, ny, nz]
     * @param baseColor  曲面颜色,切平面将沿用此色调
     */
    update(
        x0: number, y0: number, z0: number,
        fx: number, fy: number,
        normalDir: [number, number, number],
        baseColor: string,
    ): void {
        const [nx, ny, nz] = normalDir;

        // --- 标记点:只移动不重建 ---
        if (!this._dot) {
            const geo = new THREE.SphereGeometry(0.08, 16, 16);
            const mat = new THREE.MeshPhongMaterial({
                color: 0xffdd44,
                emissive: 0x331100,
                emissiveIntensity: 0.5,
            });
            this._dot = new THREE.Mesh(geo, mat);
            this._group.add(this._dot);
        }
        this._dot.position.set(x0, y0, z0);

        // --- 法向量箭头:只改方向和起点 ---
        if (!this._arrow) {
            this._arrow = new THREE.ArrowHelper(
                new THREE.Vector3(0, 0, 1),
                new THREE.Vector3(),
                1.5,
                0xff6b8a,
                0.20,
                0.10,
            );
            this._group.add(this._arrow);
        }
        this._arrow.position.set(x0, y0, z0);
        this._arrow.setDirection(new THREE.Vector3(nx, ny, nz));

        // --- 切平面:只改位置和旋转 ---
        if (!this._plane) {
            const size = 2.0;
            const geo = new THREE.PlaneGeometry(size * 2, size * 2);
            const mat = new THREE.MeshPhongMaterial({
                color: 0x44aaff,
                side: THREE.DoubleSide,
                transparent: true,
                opacity: 0.8,
                depthWrite: false,
            });
            this._plane = new THREE.Mesh(geo, mat);
            this._group.add(this._plane);
        }
        this._plane.position.set(x0, y0, z0);
        const quat = new THREE.Quaternion().setFromUnitVectors(
            new THREE.Vector3(0, 0, 1),
            new THREE.Vector3(nx, ny, nz),
        );
        this._plane.setRotationFromQuaternion(quat);
    }

    /** 清除所有临时对象 */
    clear(): void {
        // 不再 dispose,只隐藏或从场景移除
        if (this._dot) {
            this._group.remove(this._dot);
            this._disposeObject(this._dot);
            this._dot = null;
        }
        if (this._arrow) {
            this._group.remove(this._arrow);
            this._disposeObject(this._arrow);
            this._arrow = null;
        }
        if (this._plane) {
            this._group.remove(this._plane);
            this._disposeObject(this._plane);
            this._plane = null;
        }
    }

    /** 完全销毁（组件卸载时调用） */
    dispose(): void {
        this.clear();
        this._scene.remove(this._group);
    }

    //  内部方法
    /** 递归释放几何体和材质 */
    private _disposeObject(obj: THREE.Object3D): void {
        obj.traverse((node) => {
            if (node instanceof THREE.Mesh) {
                node.geometry?.dispose();
                if (Array.isArray(node.material)) {
                    node.material.forEach(m => m.dispose());
                } else {
                    node.material?.dispose();
                }
            } else if (node instanceof THREE.Line) {
                node.geometry?.dispose();
                if (Array.isArray(node.material)) {
                    node.material.forEach(m => m.dispose());
                } else {
                    (node.material as THREE.Material)?.dispose();
                }
            }
        });
    }
}