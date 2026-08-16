import * as THREE from 'three';
import type { Coefficient } from '../../compiler/ir/types';
import { generate_full_indices } from './SurfaceMeshWasm';
import {
    surfaceComputeClient,
} from '../../math/compute/workers/SurfaceComputeClient';
import { logWarning } from '../../service/logger';
import { LatestRequestExecutor } from '../../math/compute/workers/LatestRequestExecutor';
import type {
    SurfaceWorkerRequest,
    SurfaceWorkerResponse,
} from '../../math/compute/workers/surfaceWorker';

// ============================================================
// SurfaceMesh — 可复用的 3D 曲面网格封装
//
// 架构流程:
//   SurfaceRenderer.draw()
//     -> SurfaceMesh.update()
//     -> SurfaceComputeClient.request()
//     -> surfaceWorker
//     -> Rust/WASM 采样 + 后处理
//     -> SurfaceMesh.applyResult()
//     -> Three.js BufferGeometry
//
// 几何体只创建一次;高频更新只改 attribute 数据
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
    /** dispose 后不再接受任何异步结果 */
    private _disposed = false;
    private readonly executor = new LatestRequestExecutor<
        SurfaceWorkerRequest,
        SurfaceWorkerResponse
    >(surfaceComputeClient);

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
        const normalArray = new Float32Array(vertexCount * 3);

        this.geometry = new THREE.BufferGeometry();
        this.geometry.setAttribute(
            'position', new THREE.BufferAttribute(posArray, 3));
        this.geometry.setAttribute(
            'color', new THREE.BufferAttribute(colorArray, 3));
        this.geometry.setAttribute(
            'normal', new THREE.BufferAttribute(normalArray, 3));

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
     * 发起一次异步曲面采样
     *
     * 重计算在 Worker 中完成,主线程不会被表达式求值阻塞
     * 如果短时间内连续拖动滑块,只保留最后一次结果
     *
     * @param expr         标准化后的曲面表达式
     * @param coefficients 当前系数列表
     * @param xMin/xMax    x 采样范围
     * @param yMin/yMax    y 采样范围
     */
    update(
        expr: string,
        coefficients: Coefficient[],
        xMin: number, xMax: number,
        yMin: number, yMax: number,
    ): void {
        if (this._disposed) return;

        const coeffNames = coefficients.map(c => c.name);
        const coeffValues = coefficients.map(c => c.value);
        const request: Omit<SurfaceWorkerRequest, 'id'> = {
            expr,
            coeffNames,
            coeffValues,
            xMin,
            xMax,
            yMin,
            yMax,
            cols: this.cols,
            rows: this.rows,
        };

        this.executor
            .request(request)
            .then((result) => this._applyResult(result))
            .catch((error: Error) => {
                if (this._disposed || error.message === 'superseded') return;
                logWarning('SurfaceMesh', '曲面采样失败:', error.message);
            });
    }

    /**
     * Worker 结果回到主线程后,把数据写入 BufferGeometry
     * 过期结果会直接忽略
     */
    private _applyResult(result: SurfaceWorkerResponse): void {
        if (this._disposed) return;
        // positions 写入
        const posAttr = this.geometry.attributes.position;
        posAttr.array.set(result.positions);
        posAttr.needsUpdate = true;

        // colors 写入
        const colAttr = this.geometry.attributes.color;
        colAttr.array.set(result.colors);
        colAttr.needsUpdate = true;

        // normals 写入:法线已经在 Worker 里的 Rust/WASM 侧算好,
        // 主线程不再调用 computeVertexNormals()
        const normalAttr = this.geometry.attributes.normal;
        normalAttr.array.set(result.normals);
        normalAttr.needsUpdate = true;

        // 索引更新:优先复用已有 BufferAttribute,只写数据;
        // 只有在 NaN 剔除导致索引数量变化时才重新创建
        const validIndices = result.validIndices;
        const currentIndex = this.geometry.index as THREE.BufferAttribute | null;
        if (currentIndex && currentIndex.count === validIndices.length) {
            (currentIndex.array as Uint32Array).set(validIndices);
            currentIndex.needsUpdate = true;
        } else {
            this.geometry.setIndex(new THREE.BufferAttribute(validIndices, 1));
        }

    }

    /**
     * 完全释放 GPU 资源.在不再需要此曲面或切换分段数时调用.
     */
    dispose(): void {
        this._disposed = true;
        this.executor.dispose();
        this.geometry.dispose();
        this.material.dispose();
        this.wireframeMat.dispose();
    }
}

export default SurfaceMesh;
