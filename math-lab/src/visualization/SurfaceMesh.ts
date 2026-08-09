import * as THREE from 'three';
import type { Coefficient } from '../types';

// ============================================================
// 内部类型:mathjs 编译后的求值函数
// ============================================================
interface CompiledFn {
    evaluate(scope: Record<string, number>): number;
}

// ============================================================
// MathEvaluator — 纯数学网格采样引擎
// ============================================================
class MathEvaluator {
    /**
     * 在指定矩形区域内均匀采样二元函数 f(x,y),返回扁平坐标数组.
     * 无效点(无穷大/NaN/异常)置为 NaN,由上层决定如何剔除.
     */
    static computeGrid(
        fn: (x: number, y: number) => number,
        xMin: number,
        xMax: number,
        yMin: number,
        yMax: number,
        cols: number,
        rows: number,
    ): Float32Array {
        const total = (cols + 1) * (rows + 1);
        const positions = new Float32Array(total * 3);
        let idx = 0;
        for (let j = 0; j <= rows; j++) {
            const y = yMin + (yMax - yMin) * (j / rows);
            for (let i = 0; i <= cols; i++) {
                const x = xMin + (xMax - xMin) * (i / cols);
                let z: number;
                try {
                    z = fn(x, y);
                    // 数学策略:非有限值统一用 NaN 标记
                    if (!Number.isFinite(z)) z = NaN;
                } catch (_) {
                    z = NaN;
                }
                positions[idx++] = x;
                positions[idx++] = y;
                positions[idx++] = z;
            }
        }
        return positions;
    }

    /**
     * 生成共享顶点的三角索引数组(每单元格两个三角形).
     */
    static generateIndices(cols: number, rows: number): number[] {
        const indices: number[] = [];
        for (let j = 0; j < rows; j++) {
            for (let i = 0; i < cols; i++) {
                const a = j * (cols + 1) + i;
                const b = j * (cols + 1) + i + 1;
                const c = (j + 1) * (cols + 1) + i;
                const d = (j + 1) * (cols + 1) + i + 1;
                indices.push(a, b, d);
                indices.push(a, d, c);
            }
        }
        return indices;
    }
}

// ============================================================
// SurfaceMesh — 可复用的 3D 曲面网格封装
// 几何体只创建一次,后续调用 update() 仅修改 attribute 数据,
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
        this.geometry.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
        this.geometry.setAttribute('color', new THREE.BufferAttribute(colorArray, 3));

        // 初始索引用全网格(包含所有三角形),后续 update 时会根据 NaN 动态剔除
        const fullIndices = MathEvaluator.generateIndices(cols, rows);
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
        compiled: CompiledFn,
        coefficients: Coefficient[],
        xMin: number,
        xMax: number,
        yMin: number,
        yMax: number,
    ): { zMin: number; zMax: number } {
        // performance.mark('surface-update-start');
        // 组装求值闭包 —— 内部保持 (x,y)=>z 的签名,MathEvaluator 无需改动
        const scope: Record<string, number> = {};
        for (const c of coefficients) scope[c.name] = c.value;
        const fn = (x: number, y: number): number => {
            scope.x = x;
            scope.y = y;
            return compiled.evaluate(scope);
        };

        // 第一步:复用 MathEvaluator 进行网格采样(单一数据入口,便于测试)
        const positions = MathEvaluator.computeGrid(fn, xMin, xMax, yMin, yMax, this.cols, this.rows);
        const posAttr = this.geometry.attributes.position;
        // 直接替换内部数组(长度不变,无需重新创建 BufferAttribute)
        posAttr.array.set(positions);
        posAttr.needsUpdate = true;

        // 第二步:从采样结果中提取 z 值,计算全局极值
        const vertexCount = (this.cols + 1) * (this.rows + 1);
        const zValues = new Float32Array(vertexCount);
        let zMin = Infinity;
        let zMax = -Infinity;
        for (let i = 0; i < vertexCount; i++) {
            const z = positions[i * 3 + 2];
            zValues[i] = z;
            if (!isNaN(z)) {
                if (z < zMin) zMin = z;
                if (z > zMax) zMax = z;
            }
        }

        // 第三步:基于 z 值映射 HSL 彩虹颜色
        const colAttr = this.geometry.attributes.color;
        const colors = colAttr.array;
        const range = zMax - zMin;
        const _colorHelper = new THREE.Color(); // 复用对象,避免循环中 new

        for (let i = 0; i < vertexCount; i++) {
            const z = zValues[i];
            if (isNaN(z)) {
                // 无效顶点在动态索引剔除后不可见,颜色赋 0 即可
                colors[i * 3] = 0;
                colors[i * 3 + 1] = 0;
                colors[i * 3 + 2] = 0;
            } else {
                // 归一化 t ∈ [0, 1],彩虹映射:蓝(0.66) → 红(0.0)
                const t = range === 0 ? 0.5 : (z - zMin) / range;
                const hue = 0.66 - t * 0.66;
                _colorHelper.setHSL(hue, 0.9, 0.5 + t * 0.3);
                colors[i * 3] = _colorHelper.r;
                colors[i * 3 + 1] = _colorHelper.g;
                colors[i * 3 + 2] = _colorHelper.b;
            }
        }
        colAttr.needsUpdate = true;

        // 第四步:剔除含 NaN 的三角形,防止法线污染
        // 原理:任何包含 NaN 顶点的三角形,其面法线为 NaN,
        //       Three.js 的 computeVertexNormals 会把 NaN 通过顶点平均
        //       扩散到相邻的正常三角形,导致高光/阴影异常.
        // 修复:遍历所有三角形,只保留三个顶点 z 值均有限的三角形.
        const oldIndices = MathEvaluator.generateIndices(this.cols, this.rows);
        const newIndices: number[] = [];
        for (let i = 0; i < oldIndices.length; i += 3) {
            const a = oldIndices[i];
            const b = oldIndices[i + 1];
            const c = oldIndices[i + 2];
            const za = zValues[a];
            const zb = zValues[b];
            const zc = zValues[c];
            if (Number.isFinite(za) && Number.isFinite(zb) && Number.isFinite(zc)) {
                newIndices.push(a, b, c);
            }
        }
        this.geometry.setIndex(newIndices);

        // 第五步:重新计算法线(此时所有参与面均合法)
        this.geometry.computeVertexNormals();

        // performance.mark('surface-update-end');
        // performance.measure('surface-update', 'surface-update-start', 'surface-update-end');
        return { zMin, zMax };
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

export { MathEvaluator };
export default SurfaceMesh;