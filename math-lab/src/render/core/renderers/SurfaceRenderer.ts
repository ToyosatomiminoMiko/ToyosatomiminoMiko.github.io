import * as THREE from 'three';
import { NUMERIC_CONFIG } from '../../../config/numericConfig';
import { SurfaceMesh } from '../../visualization/SurfaceMesh';
import type { IRenderer } from './IRenderer';
import type { SurfaceObject } from '../../../compiler/ir/types';

/**
 * 曲面渲染器
 * - 复用 SurfaceMesh,仅分段数变化时才重建
 * - draw() 触发 SurfaceMesh.update(),后者把重采样交给 Worker,
 *   主线程只等待结果并更新 BufferGeometry
 */
export class SurfaceRenderer implements IRenderer {
    readonly group = new THREE.Group();
    private mesh: SurfaceMesh | null = null;
    private userVisible = true;
    private xRange: [number, number];
    private yRange: [number, number];
    private segments: number;

    constructor(private surface: SurfaceObject) {
        const range = surface.range;
        this.xRange = range
            ? [range[0], range[1]]
            : [NUMERIC_CONFIG.surface.defaultRange[0], NUMERIC_CONFIG.surface.defaultRange[1]];
        this.yRange = range
            ? [range[2], range[3]]
            : [NUMERIC_CONFIG.surface.defaultRange[2], NUMERIC_CONFIG.surface.defaultRange[3]];
        this.segments = surface.segments ?? NUMERIC_CONFIG.surface.defaultSegments;
    }

    get visible(): boolean {
        return this.userVisible;
    }

    draw(): void {
        // 分段数变化时重建(罕见路径)
        if (this.mesh && (this.mesh.cols !== this.segments || this.mesh.rows !== this.segments)) {
            this.group.remove(this.mesh.group);
            this.mesh.dispose();
            this.mesh = null;
        }

        if (!this.mesh) {
            this.mesh = new SurfaceMesh(this.segments, this.segments);
            this.group.add(this.mesh.group);
        }
        // SurfaceMesh 只接受字符串表达式,因此这里直接传递归一化后的表达式字符串。
        // 重新序列化成字符串,避免在渲染器里保留编译函数.
        // 注意:toString 只是序列化,不会把 e^x 自动转换成 exp(x)；
        // evalexpr 能否解析由表达式来源保证,不能把兼容性归因到这一步.
        const expr = this.surface.expr;

        this.mesh.update(
            expr, // 字符串,不再是 CompiledFn
            this.surface.coefficients,
            this.xRange[0], this.xRange[1],
            this.yRange[0], this.yRange[1],
        );

        this.group.visible = this.visible;
    }

    setVisible(v: boolean): void {
        this.userVisible = v;
        this.group.visible = this.visible;
    }

    updateRef(surface: SurfaceObject): void {
        this.surface = surface;
        const range = surface.range;
        this.xRange = range
            ? [range[0], range[1]]
            : [NUMERIC_CONFIG.surface.defaultRange[0], NUMERIC_CONFIG.surface.defaultRange[1]];
        this.yRange = range
            ? [range[2], range[3]]
            : [NUMERIC_CONFIG.surface.defaultRange[2], NUMERIC_CONFIG.surface.defaultRange[3]];
        this.segments = surface.segments ?? NUMERIC_CONFIG.surface.defaultSegments;
    }

    dispose(): void {
        if (this.mesh) {
            this.mesh.dispose();
            this.mesh = null;
        }
    }
}
