import * as THREE from 'three';

export class VectorFieldMesh {
    public group: THREE.Group;

    private shaftInstanced: THREE.InstancedMesh;
    private headInstanced: THREE.InstancedMesh;
    private count: number;
    private readonly threshold = 1e-8; // 模长小于此值则隐藏该箭头

    // 固定几何参数
    private readonly shaftRadius = 0.05;
    private readonly headRadius = 0.15;
    private readonly headLengthRatio = 0.2; // 头部占总长度的比例

    // 临时向量/矩阵/四元数,减少GC
    private readonly direction = new THREE.Vector3();
    private readonly quaternion = new THREE.Quaternion();
    private readonly matrix = new THREE.Matrix4();
    private readonly position = new THREE.Vector3();
    private readonly scale = new THREE.Vector3();

    constructor(
        positions: Float32Array, // [px0, py0, pz0, ...]
        vectors: Float32Array,   // [vx0, vy0, vz0, ...]
        color: string,
        scale: number
    ) {
        this.count = positions.length / 3;
        if (this.count !== vectors.length / 3) {
            throw new Error('positions and vectors must have the same number of points');
        }

        this.group = new THREE.Group();

        // ---------- 创建几何体(底部在原点,沿 +Y 方向延伸)----------
        // 杆:高为1,半径为 shaftRadius
        const shaftGeo = new THREE.CylinderGeometry(1, 1, 1, 8);
        shaftGeo.translate(0, 0.5, 0); // 底部在原点,顶部在 (0,1,0)

        // 头:高为1,底部半径为 headRadius
        const headGeo = new THREE.ConeGeometry(1, 1, 8);
        headGeo.translate(0, 0.5, 0); // 底部在原点,尖端在 (0,1,0)

        // ---------- 材质 ----------
        const material = new THREE.MeshStandardMaterial({
            color: color,
            roughness: 0.6,
            metalness: 0.2,
        });

        // ---------- 实例化网格 ----------
        this.shaftInstanced = new THREE.InstancedMesh(shaftGeo, material, this.count);
        this.headInstanced = new THREE.InstancedMesh(headGeo, material, this.count);

        this.group.add(this.shaftInstanced);
        this.group.add(this.headInstanced);

        // 第一次更新
        this.update(positions, vectors, scale);
    }

    /**
     * 更新所有箭头
     * @param positions 网格点坐标
     * @param vectors   向量值
     * @param scale     全局缩放因子(总长度 = 向量模长 × scale)
     */
    public update(positions: Float32Array, vectors: Float32Array, scale: number): void {
        const count = positions.length / 3;
        if (count !== this.count) {
            throw new Error('Number of points cannot change after construction');
        }

        const shaftMatrix = this.matrix;
        const headMatrix = new THREE.Matrix4(); // 独立矩阵,避免相互影响
        const dir = this.direction;
        const quat = this.quaternion;
        const pos = this.position;
        const scl = this.scale;

        for (let i = 0; i < count; i++) {
            const i3 = i * 3;
            const vx = vectors[i3];
            const vy = vectors[i3 + 1];
            const vz = vectors[i3 + 2];
            const len = Math.sqrt(vx * vx + vy * vy + vz * vz);

            // 网格点位置
            const px = positions[i3];
            const py = positions[i3 + 1];
            const pz = positions[i3 + 2];

            // 判断是否隐藏(模长 < 阈值)
            const hidden = len < this.threshold;

            // 计算方向(归一化)
            dir.set(vx, vy, vz);
            if (!hidden) {
                dir.divideScalar(len);
                quat.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
            } else {
                // 隐藏时方向任意,但缩放为0即可
                quat.identity();
            }

            // ---------- 杆 ----------
            const totalLen = len * scale;
            const shaftLen = hidden ? 0 : totalLen * (1 - this.headLengthRatio);
            const headLen = hidden ? 0 : totalLen * this.headLengthRatio;

            // 杆的位置:网格点
            pos.set(px, py, pz);
            // 杆的缩放:(半径, 长度, 半径)
            scl.set(this.shaftRadius, shaftLen, this.shaftRadius);
            shaftMatrix.compose(pos, quat, scl);
            this.shaftInstanced.setMatrixAt(i, shaftMatrix);

            // ---------- 头 ----------
            if (!hidden) {
                // 头的位置:网格点 + 方向 × 杆长
                pos.set(px + dir.x * shaftLen, py + dir.y * shaftLen, pz + dir.z * shaftLen);
                // 头的缩放:(半径, 长度, 半径)
                scl.set(this.headRadius, headLen, this.headRadius);
                headMatrix.compose(pos, quat, scl);
            } else {
                // 隐藏:缩放为0
                scl.set(0, 0, 0);
                pos.set(px, py, pz); // 位置任意
                headMatrix.compose(pos, quat, scl);
            }
            this.headInstanced.setMatrixAt(i, headMatrix);
        }

        // 标记矩阵更新
        this.shaftInstanced.instanceMatrix.needsUpdate = true;
        this.headInstanced.instanceMatrix.needsUpdate = true;
    }

    /**
     * 修改所有箭头的颜色
     */
    public setColor(color: string): void {
        const col = new THREE.Color(color);
        const shaftMat = this.shaftInstanced.material as THREE.MeshStandardMaterial;
        const headMat = this.headInstanced.material as THREE.MeshStandardMaterial;
        shaftMat.color.copy(col);
        headMat.color.copy(col);
    }

    /**
     * 释放GPU资源
     */
    public dispose(): void {
        this.shaftInstanced.geometry.dispose();
        (this.shaftInstanced.material as THREE.MeshStandardMaterial).dispose();
        this.headInstanced.geometry.dispose();
        (this.headInstanced.material as THREE.MeshStandardMaterial).dispose();
        // 从group中移除
        this.group.remove(this.shaftInstanced);
        this.group.remove(this.headInstanced);
    }
}