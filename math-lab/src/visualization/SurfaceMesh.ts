import * as THREE from 'three';
import type { Coefficient } from '../types';
import { sample_and_process, generate_full_indices } from './SurfaceMeshWasm';

// ============================================================
// SurfaceMesh — 可复用的 3D 曲面网格封装
// 几何体只创建一次,后续调用 update() 仅修改 attribute 数据
// 大幅减少 GC 压力,适合高频交互(如拖动参数滑块)
// ============================================================
export class SurfaceMesh {
    cols: number;
    rows: number;
    geometry: THREE.BufferGeometry;
    material: THREE.MeshPhongMaterial;
    wireframeMat: THREE.MeshBasicMaterial;
    mesh: THREE.Mesh;
    wireframe: THREE.Mesh;
    group: THREE.Group;

    /**
     * @param cols - x 方向网格分段数
     * @param rows - y 方向网格分段数
     */
    constructor(cols: number = 128, rows: number = 128) {
        this.cols = cols;
        this.rows = rows;

        // 预分配 BufferGeometry
        const vertexCount = (cols + 1) * (rows + 1);
        const posArray = new Float32Array(vertexCount * 3);
        const colorArray = new Float32Array(vertexCount * 3);

        this.geometry = new THREE.BufferGeometry();
        this.geometry.setAttribute(
            'position', new THREE.BufferAttribute(posArray, 3));
        this.geometry.setAttribute(
            'color', new THREE.BufferAttribute(colorArray, 3));

        // 初始索引用全网格(包含所有三角形),后续 update 时会根据 NaN 动态剔除
        const fullIndices = generate_full_indices(cols, rows);
        this.geometry.setIndex(fullIndices);

        // 材质:Phong + 顶点颜色 + 双面渲染
        this.material = new THREE.MeshPhongMaterial({
            vertexColors: true,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.85,
            shininess: 30,
            specular: new THREE.Color(0x222244),
            depthWrite: true, // 曲面主体保持深度写入
        });

        // 独立线框 mesh,单独控制透明度与深度写入
        this.wireframeMat = new THREE.MeshBasicMaterial({
            color: 0x88aaff,
            wireframe: true,
            transparent: true,
            opacity: 0.15,
            depthWrite: false, // 避免线框在曲面背后产生 z-fighting
        });

        this.mesh = new THREE.Mesh(this.geometry, this.material);
        this.wireframe = new THREE.Mesh(this.geometry, this.wireframeMat);

        // 将曲面和线框组织到一个 Group,方便场景中添加/移除
        this.group = new THREE.Group();
        this.group.add(this.mesh);
        this.group.add(this.wireframe);
    }

    /**
     * 核心更新方法:传入新的函数表达式和范围,动态刷新坐标与颜色.
     * 不重新创建几何体,仅修改内部 Float32Array 并通知 WebGL.
     *
     * @param compiled    - mathjs 编译后的求值函数
     * @param coefficients - 系数列表
     * @param xMin        - x 范围下界
     * @param xMax        - x 范围上界
     * @param yMin        - y 范围下界
     * @param yMax        - y 范围上界
     * @returns 本次计算的 z 极值
     */
    update(
        expr: string,
        coefficients: Coefficient[],
        xMin: number, xMax: number,
        yMin: number, yMax: number,
    ): { zMin: number; zMax: number } {
        //console.log('[SurfaceMesh] expr received:', JSON.stringify(expr));
        const coeffNames = coefficients.map(c => c.name);
        const coeffValues = new Float64Array(coefficients.map(c => c.value));

        const result = sample_and_process(
            expr,
            coeffNames,
            coeffValues,
            xMin, xMax, yMin, yMax,
            this.cols, this.rows,
        );

        // positions 写入
        const posAttr = this.geometry.attributes.position;
        posAttr.array.set(result.positions);
        posAttr.needsUpdate = true;

        // colors 写入
        const colAttr = this.geometry.attributes.color;
        colAttr.array.set(result.colors);
        colAttr.needsUpdate = true;

        // 索引更新
        this.geometry.setIndex(Array.from(result.valid_indices));
        // 类型"Uint32Array<ArrayBufferLike>"的参数不能赋给类型
        // "number[] | BufferAttribute<BufferAttributeEventMap> | null"的参数
        // this.geometry.setIndex(result.valid_indices);

        // 重算法线
        this.geometry.computeVertexNormals();

        return { zMin: result.z_min, zMax: result.z_max };
    }

    /**
     * 完全释放 GPU 资源.在不再需要此曲面或切换分段数时调用.
     */
    dispose(): void {
        this.geometry.dispose();
        this.material.dispose();
        this.wireframeMat.dispose();
    }
}

export default SurfaceMesh;