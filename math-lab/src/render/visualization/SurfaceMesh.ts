import * as THREE from 'three';
import type { Coefficient } from '../../compiler/ir/types';
import { splitCoefficients } from '../../math/adapters/coefficientUtils';
import { RENDER_CONFIG } from '../../config/renderConfig';
import {
    surfaceComputeClient,
} from '../../math/compute/workers/SurfaceComputeClient';
import { LatestRequestExecutor } from '../../math/compute/workers/LatestRequestExecutor';
import { reportSamplingFailure } from '../core/samplingErrors';
import {
    installSurfaceVertexColor,
    type SurfaceColorHandle,
} from './surfaceColorMap';
import type { SurfaceStyle } from '../types';
import type {
    SurfaceWorkerRequest,
    SurfaceWorkerResponse,
} from '../../math/compute/workers/SurfaceWorker';

// ============================================================
// SurfaceMesh - 可复用的 3D 曲面网格封装
//
// 架构流程:
//   SurfaceRenderer.draw()
//     -> SurfaceMesh.update()
//     -> SurfaceComputeClient.request()
//     -> SurfaceWorker
//     -> Rust/WASM 采样 + 后处理
//     -> SurfaceMesh.applyResult()
//     -> Three.js BufferGeometry
//
// 几何体只创建一次;高频更新只改 attribute 数据
//
// 配色:不再生成 color attribute / 不再用 vertexColors 通道.
// 伪彩色由顶点着色器按 position.z 与 z_min/z_max 实时计算
// (见 surfaceColorMap.ts),每次采样结果只更新 uZRange uniform.
// 此外还有两个着色器 uniform 控制颜色映射开关与基色:
//   - uSurfaceColorMapEnabled:颜色映射全局开关(关闭时曲面显示基色);
//   - uSurfaceBaseColor:颜色映射关闭时的均匀基色(曲面对象的 color).
// 这两个值由 setSurfaceStyle()/setBaseColor() 刷新,不需要重建材质.
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
    /** z 极值 + 颜色映射开关 + 基色的 uniform 句柄 */
    private readonly colorRange: SurfaceColorHandle;
    /** dispose 后不再接受任何异步结果 */
    private _disposed = false;
    /** 曲面线框网格是否显示(全局"曲面"面板控制) */
    private _wireframeVisible = RENDER_CONFIG.surfaceMesh.wireframeVisible;
    /** 是否启用 z->HSL 伪彩色映射(全局"曲面"面板控制) */
    private _colorMapEnabled = RENDER_CONFIG.surfaceMesh.colorMapEnabled;

    /**
     * @cache
     * 缓存目的:把曲面采样请求收敛为 latest-only,主线程只等待最新结果.
     * 键/失效策略:单飞队列;新请求取代 pending 请求.
     * 生命周期:跟随 SurfaceMesh 实例.
     */
    private readonly executor = new LatestRequestExecutor<
        SurfaceWorkerRequest,
        SurfaceWorkerResponse
    >(surfaceComputeClient);

    /**
     * @param cols - x 方向网格分段数
     * @param rows - y 方向网格分段数
     * @param name - 所属曲面对象名,用于采样失败诊断
     * @param baseColor - 曲面对象自身基色;颜色映射关闭时以它作为均匀 diffuse
     */
    constructor(
        cols: number = RENDER_CONFIG.surfaceMesh.defaultSegments,
        rows: number = RENDER_CONFIG.surfaceMesh.defaultSegments,
        private readonly name = '曲面',
        baseColor = '#ffffff',
    ) {
        this.cols = cols;
        this.rows = rows;

        // 预分配 BufferGeometry(position + normal;颜色不再预分配,
        // 由顶点着色器按 z 实时计算)
        const vertexCount = (cols + 1) * (rows + 1);
        const posArray = new Float32Array(vertexCount * 3);
        const normalArray = new Float32Array(vertexCount * 3);

        this.geometry = new THREE.BufferGeometry();
        this.geometry.setAttribute(
            'position', new THREE.BufferAttribute(posArray, 3));
        this.geometry.setAttribute(
            'normal', new THREE.BufferAttribute(normalArray, 3));

        // 初始索引保持为空,等第一次 Worker 结果带回有效索引再设置.
        //
        // 这里不再生成 cols*rows*6 个 u32 的完整索引:
        // 该数组在主线程会再被复制成 JS number[],随后很快被 Worker 的
        // 有效索引替换,属于一次完全没有收益的大块分配.
        this.geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(0), 1));

        // 材质:Phong + 双面渲染.
        // 顶点配色不再走 vertexColors 通道,而是由 installSurfaceVertexColor
        // 注入的顶点着色器按 position.z 实时计算(等价于 diffuse 乘以顶点色).
        this.material = new THREE.MeshPhongMaterial({
            side: THREE.DoubleSide,
            transparent: true,
            opacity: RENDER_CONFIG.surfaceMesh.materialOpacity,
            shininess: RENDER_CONFIG.surfaceMesh.shininess,
            specular: new THREE.Color(RENDER_CONFIG.surfaceMesh.specular),
            depthWrite: true, // 曲面主体保持深度写入
        });
        this.colorRange = installSurfaceVertexColor(this.material);
        this.colorRange.setBaseColor(baseColor);
        this.colorRange.setColorMapEnabled(this._colorMapEnabled);

        // 独立线框 mesh,单独控制透明度与深度写入
        this.wireframeMat = new THREE.MeshBasicMaterial({
            color: RENDER_CONFIG.surfaceMesh.wireframeColor,
            wireframe: true,
            transparent: true,
            opacity: RENDER_CONFIG.surfaceMesh.wireframeOpacity,
            depthWrite: false, // 避免线框在曲面背后产生 z-fighting
        });

        this.mesh = new THREE.Mesh(this.geometry, this.material);
        this.wireframe = new THREE.Mesh(this.geometry, this.wireframeMat);
        this.wireframe.visible = this._wireframeVisible;

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
    /**
     * @cache_access
     * 通过 latest-only executor 发起采样;几何体本身复用.
     */
    update(
        expr: string,
        coefficients: Coefficient[],
        xMin: number, xMax: number,
        yMin: number, yMax: number,
    ): void {
        if (this._disposed) return;

        const { names, values } = splitCoefficients(coefficients);
        const request: Omit<SurfaceWorkerRequest, 'id'> = {
            expr,
            coeffNames: names,
            coeffValues: values,
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
                reportSamplingFailure({
                    kind: 'surface',
                    name: this.name,
                    message: error.message,
                });
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

        // 颜色不再写入 attribute:由顶点着色器依据 position.z 实时计算,
        // 这里只把本次采样的 z 极值更新进 uniform
        this.colorRange.setRange(result.zMin, result.zMax);

        // normals 写入:法线已经在 Worker 里的 Rust/WASM 侧算好,
        // 主线程不再调用 computeVertexNormals()
        const normalAttr = this.geometry.attributes.normal;
        normalAttr.array.set(result.normals);
        normalAttr.needsUpdate = true;

        // 索引更新:优先复用已有 BufferAttribute,只写数据;
        // 首帧 currentIndex 为空,会在这里创建真正的有效索引.
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
     * 应用全局"曲面"面板样式到本网格:线框显隐 + 颜色映射开关.
     *
     * 调用时机:
     * - 用户在视图面板切换"网格"/"颜色映射"开关(RenderController 收到
     *   `surface:changed` 后遍历所有 SurfaceRenderer 转发到此);
     * - SurfaceRenderer 新建 mesh 时用当前全局样式初始化.
     */
    setSurfaceStyle(style: SurfaceStyle): void {
        this._wireframeVisible = style.wireframeVisible;
        this._colorMapEnabled = style.colorMapEnabled;
        this.wireframe.visible = this._wireframeVisible;
        this.colorRange.setColorMapEnabled(this._colorMapEnabled);
    }

    /**
     * 同步曲面对象的基色(颜色映射关闭时的均匀 diffuse).
     *
     * 每次 draw() 都会调用,保证对象 color 在重新运行/换色后落到着色器,
     * 无需在分段数不变时重建材质.
     */
    setBaseColor(color: string): void {
        this.colorRange.setBaseColor(color);
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
