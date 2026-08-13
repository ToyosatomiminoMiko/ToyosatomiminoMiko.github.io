import * as THREE from 'three';
import type { IRenderer } from './IRenderer';
import type { VectorFieldExpr } from '../../math_objects/types';
import { sampleVectorField } from '../../math_objects/VectorField';
import { VectorFieldMesh } from '../../visualization/VectorFieldMesh';

/**
 * 向量场渲染器
 * - 桥接数据层 VectorFieldExpr 和可视化层 VectorFieldMesh
 * - 实现 IRenderer,纳入 Plotter 路由体系
 */
export class VectorFieldRenderer implements IRenderer {
    readonly group: THREE.Group;
    private _mesh: VectorFieldMesh | null = null;

    // 网格坐标缓存:只有在 range 或 gridSize 变化时才重建
    private _positions: Float32Array | null = null;
    private _positionsKey = '';

    constructor(private _data: VectorFieldExpr) {
        this.group = new THREE.Group();
    }

    get visible(): boolean {
        return this._data.enabled;
    }

    draw(): void {
        const { nodeP, nodeQ, nodeR, coefficients, range, gridSize, glyphScale, color } = this._data;

        // 1. 采样向量值(每次都需要,因为系数/表达式可能变了)
        const vectors = sampleVectorField(
            { P: nodeP, Q: nodeQ, R: nodeR },
            coefficients,
            range,
            gridSize,
        );

        // 2. 网格点世界坐标(仅 range/gridSize 变化时重建)
        const key = this.getPositionsKey(range, gridSize);
        if (!this._positions || this._positionsKey !== key) {
            this._positions = this.buildPositions(range, gridSize);
            this._positionsKey = key;
        }
        const positions = this._positions;

        // 3. 创建或更新 mesh
        if (!this._mesh) {
            this._mesh = new VectorFieldMesh(positions, vectors, color, glyphScale);
            this.group.add(this._mesh.group);
        } else {
            this._mesh.update(positions, vectors, glyphScale);
            this._mesh.setColor(color);
        }

        this.group.visible = this._data.enabled;
    }

    /** 根据当前 range 和 gridSize 生成网格点世界坐标 */
    private buildPositions(
        range: VectorFieldExpr['range'],
        gridSize: VectorFieldExpr['gridSize'],
    ): Float32Array {
        const [gx, gy, gz] = gridSize;
        const total = gx * gy * gz;
        const positions = new Float32Array(total * 3);

        // 保留原来的防除零处理:某维为 1 时步长为 0
        const dx = (range.x[1] - range.x[0]) / (gx - 1 || 1);
        const dy = (range.y[1] - range.y[0]) / (gy - 1 || 1);
        const dz = (range.z[1] - range.z[0]) / (gz - 1 || 1);

        let i = 0;
        for (let iz = 0; iz < gz; iz++) {
            const z = range.z[0] + iz * dz;
            for (let iy = 0; iy < gy; iy++) {
                const y = range.y[0] + iy * dy;
                for (let ix = 0; ix < gx; ix++) {
                    const x = range.x[0] + ix * dx;
                    positions[i] = x;
                    positions[i + 1] = y;
                    positions[i + 2] = z;
                    i += 3;
                }
            }
        }

        return positions;
    }

    /** 生成 range + gridSize 的缓存 key */
    private getPositionsKey(
        range: VectorFieldExpr['range'],
        gridSize: VectorFieldExpr['gridSize'],
    ): string {
        return JSON.stringify([range, gridSize]);
    }

    setVisible(v: boolean): void {
        this.group.visible = v;
    }

    /** 供 Plotter 模式切换时调用 */
    setModeVisible(v: boolean): void {
        // 向量场仅在 3D 模式显示
        this.group.visible = this._data.enabled && v;
    }

    updateRef(data: VectorFieldExpr): void {
        this._data = data;
    }

    dispose(): void {
        this._mesh?.dispose();
        this._mesh = null;
    }
}