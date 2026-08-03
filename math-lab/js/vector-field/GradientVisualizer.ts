import * as THREE from 'three';

/**
 * GradientVisualizer — 梯度临时可视化
 *
 * 在场景中绘制三个临时对象：
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
        x0: number,
        y0: number,
        z0: number,
        fx: number,
        fy: number,
        normalDir: [number, number, number],
        baseColor: string,
    ): void {
        this.clear();

        const color = new THREE.Color(baseColor);

        // ---- 1. 标记点 ----
        const dotGeo = new THREE.SphereGeometry(0.08, 16, 16);
        const dotMat = new THREE.MeshPhongMaterial({
            color: 0xffdd44,
            emissive: 0x331100,
            emissiveIntensity: 0.5,
        });
        const dot = new THREE.Mesh(dotGeo, dotMat);
        dot.position.set(x0, y0, z0);
        this._group.add(dot);

        // ---- 2. 法向量箭头 ----
        const [nx, ny, nz] = normalDir;
        const arrowLength = 1.5;
        const arrowOrigin = new THREE.Vector3(x0, y0, z0);
        const arrowDir = new THREE.Vector3(nx, ny, nz).normalize();
        const arrow = new THREE.ArrowHelper(
            arrowDir,
            arrowOrigin,
            arrowLength,
            0xff6b8a, // 粉红,区别于其他箭头
            0.20,
            0.10,
        );
        this._group.add(arrow);

        // ---- 3. 切平面（小方片） ----
        const planeSize = 2.0;           // 半边长度
        const planeGeo = new THREE.PlaneGeometry(
            planeSize * 2,
            planeSize * 2,
        );
        const planeMat = new THREE.MeshPhongMaterial({
            color: 0x44aaff,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.8, // 不透明度
            depthWrite: false,
        });
        const planeMesh = new THREE.Mesh(planeGeo, planeMat);

        // 将平面定位到切点,并旋转使法线对齐
        planeMesh.position.set(x0, y0, z0);

        // Three.js PlaneGeometry 默认法线是 (0,0,1)
        const defaultNormal = new THREE.Vector3(0, 0, 1);
        const quat = new THREE.Quaternion().setFromUnitVectors(
            defaultNormal,
            arrowDir,
        );
        planeMesh.setRotationFromQuaternion(quat);

        this._group.add(planeMesh);
    }

    /** 清除所有临时对象 */
    clear(): void {
        while (this._group.children.length > 0) {
            const child = this._group.children[0];
            this._group.remove(child);
            this._disposeObject(child);
        }
    }

    /** 完全销毁（组件卸载时调用） */
    dispose(): void {
        this.clear();
        this._scene.remove(this._group);
    }

    // ============================================================
    //  内部方法
    // ============================================================

    /** 递归释放几何体和材质 */
    private _disposeObject(obj: THREE.Object3D): void {
        obj.traverse((node) => {
            if (node instanceof THREE.Mesh) {
                node.geometry?.dispose();
                if (Array.isArray(node.material)) {
                    node.material.forEach((m) => m.dispose());
                } else {
                    node.material?.dispose();
                }
            }
        });
    }
}