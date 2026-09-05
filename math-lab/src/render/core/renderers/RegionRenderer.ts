/**
 * 区域(region)渲染器.
 *
 * 把两条边界曲线在 region x 区间上采成折线,并绘制二者围成的带状填充面:
 * - 填充面:相邻两采样站的四边形三角形带(z=0,半透明双面);
 * - 边界描边:两条折线,颜色取各自边界曲线的颜色.
 *
 * 数值采样统一走 MathComputeEngine 的曲线 Worker(与 CurveRenderer 同源),
 * 渲染层不自行解析表达式;RegionRenderer 每次 draw() 对两条边界各发起一次
 * latest-only 采样,都返回后再重建几何.两曲线在采样站非有限值会被跳过,
 * 填充面在缺口两侧自动断开,避免画出越界的假带.
 *
 * 后续规划(roadmap):y 型区域 / 极坐标 r-θ 区域 / 三条以上曲线边界 /
 * 区域参与求交,见 compiler/ir/types.ts RegionObject 注释.
 */
import * as THREE from 'three';
import type { IRenderer } from '../renderers/IRenderer';
import type { CurveObject, RegionObject } from '../../../compiler/ir/types';
import { sharedCurveSamplingEngine as regionComputeEngine } from '../../../math/compute/MathComputeEngine';
import {
    LatestRequestExecutor,
    type RequestClient,
} from '../../../math/compute/workers/LatestRequestExecutor';
import { splitCoefficients } from '../../../math/coefficientUtils';
import { reportSamplingFailure } from '../samplingErrors';

type RegionSampleRequest = {
    id: number;
    expr: string;
    coeffNames: string[];
    coeffValues: number[];
    range: [number, number];
    segments: number;
};

// @cache 与 CurveRenderer 共享同一采样门面(共享模块级 worker client).
const regionRequestClient: RequestClient<RegionSampleRequest, Float32Array> = {
    request(request) {
        return regionComputeEngine.sampleCurve(request);
    },
};

interface BoundaryState {
    curve: CurveObject;
    executor: LatestRequestExecutor<RegionSampleRequest, Float32Array>;
    /** 最近一次采样结果(扁平 [x, y, 0, ...] 三元组). */
    points: Float32Array;
    /** 采样站点数(非有限值被跳过后的实际点数). */
    count: number;
}

export class RegionRenderer implements IRenderer {
    readonly group = new THREE.Group();

    private fill: THREE.Mesh | null = null;
    private lineA: THREE.Line | null = null;
    private lineB: THREE.Line | null = null;
    private readonly boundaries: [BoundaryState, BoundaryState];
    private userVisible = true;
    private disposed = false;
    private xRange: [number, number];
    private steps: number;

    constructor(
        private region: RegionObject,
        curveA: CurveObject,
        curveB: CurveObject,
    ) {
        this.xRange = region.range;
        this.steps = region.segments;
        this.boundaries = [
            { curve: curveA, executor: this._createExecutor(), points: new Float32Array(0), count: 0 },
            { curve: curveB, executor: this._createExecutor(), points: new Float32Array(0), count: 0 },
        ];
    }

    get visible(): boolean {
        return this.userVisible;
    }

    updateRef(region: RegionObject, curves?: [CurveObject, CurveObject]): void {
        this.region = region;
        this.xRange = region.range;
        this.steps = region.segments;
        if (curves) {
            this.boundaries[0].curve = curves[0];
            this.boundaries[1].curve = curves[1];
        }
    }

    draw(): void {
        const requests = this.boundaries.map((boundary) => {
            const { names, values } = splitCoefficients(boundary.curve.coefficients);
            return boundary.executor.request({
                expr: boundary.curve.expr,
                coeffNames: names,
                coeffValues: values,
                range: this.xRange,
                segments: this.steps,
            });
        });

        void Promise.all(requests)
            .then(([pointsA, pointsB]) => {
                if (this.disposed) return;
                this.boundaries[0].points = pointsA;
                this.boundaries[0].count = pointsA.length / 3;
                this.boundaries[1].points = pointsB;
                this.boundaries[1].count = pointsB.length / 3;
                this._rebuild();
            })
            .catch((error: Error) => {
                if (this.disposed || error.message === 'superseded') return;
                reportSamplingFailure({
                    kind: 'curve',
                    name: this.region.name,
                    message: error.message,
                });
                this.group.visible = false;
            });
    }

    setVisible(v: boolean): void {
        this.userVisible = v;
        this.group.visible = this.visible;
    }

    dispose(): void {
        this.disposed = true;
        for (const boundary of this.boundaries) {
            boundary.executor.dispose();
        }
        this._disposeGeometry();
    }

    private _createExecutor(): LatestRequestExecutor<RegionSampleRequest, Float32Array> {
        return new LatestRequestExecutor(regionRequestClient);
    }

    /**
     * @cache_access
     * 用最新采样重建填充面与两条边界线;只有部分站存在缺口时,
     * 以"x 对齐配对"方式跳过不成对的列.
     */
    private _rebuild(): void {
        const columns: Array<{ x: number; ya: number; yb: number }> = [];
        const a = this.boundaries[0];
        const b = this.boundaries[1];
        const [xa, xb] = this.xRange;
        const h = (xb - xa) / Math.max(1, this.steps);
        const tolerance = h * 0.75;

        let ia = 0;
        let ib = 0;
        while (ia < a.count && ib < b.count) {
            const xA = a.points[ia * 3];
            const xB = b.points[ib * 3];
            if (Math.abs(xA - xB) <= tolerance) {
                columns.push({ x: xA, ya: a.points[ia * 3 + 1], yb: b.points[ib * 3 + 1] });
                ia += 1;
                ib += 1;
            } else if (xA < xB) {
                ia += 1;
            } else {
                ib += 1;
            }
        }

        this._rebuildFill(columns);
        this._rebuildEdge(0);
        this._rebuildEdge(1);
    }

    private _rebuildFill(columns: Array<{ x: number; ya: number; yb: number }>): void {
        if (this.fill) {
            this.group.remove(this.fill);
            this.fill.geometry?.dispose();
            this.fill = null;
        }
        if (columns.length < 2) return;

        const h = (this.xRange[1] - this.xRange[0]) / Math.max(1, this.steps);
        const positions: number[] = [];
        for (let i = 0; i + 1 < columns.length; i++) {
            const p0 = columns[i];
            const p1 = columns[i + 1];
            // 相邻列间距明显超过一档(中间整列缺失)时断开,不拉斜边.
            if (p1.x - p0.x > h * 1.75) continue;
            positions.push(p0.x, p0.ya, 0, p1.x, p1.ya, 0, p0.x, p0.yb, 0);
            positions.push(p1.x, p1.ya, 0, p1.x, p1.yb, 0, p0.x, p0.yb, 0);
        }
        if (positions.length === 0) return;

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
        const material = new THREE.MeshBasicMaterial({
            color: this.region.color,
            transparent: true,
            opacity: this.region.opacity,
            side: THREE.DoubleSide,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: -1,
        });
        this.fill = new THREE.Mesh(geometry, material);
        this.fill.renderOrder = 2;
        this.group.add(this.fill);
    }

    private _rebuildEdge(index: 0 | 1): void {
        const line = index === 0 ? this.lineA : this.lineB;
        const points = this.boundaries[index].points;
        const curve = this.boundaries[index].curve;

        if (line) {
            this.group.remove(line);
            line.geometry?.dispose();
        }
        if (points.length < 6) return;

        const positions = new Float32Array(points.length);
        positions.set(points);
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const material = new THREE.LineBasicMaterial({
            color: curve.color || this.region.color,
            transparent: true,
            opacity: 0.9,
            depthWrite: false,
        });
        const next = new THREE.Line(geometry, material);
        next.renderOrder = 3;
        this.group.add(next);
        if (index === 0) {
            this.lineA = next;
        } else {
            this.lineB = next;
        }
    }

    private _disposeGeometry(): void {
        if (this.fill) {
            this.group.remove(this.fill);
            this.fill.geometry?.dispose();
            (Array.isArray(this.fill.material) ? this.fill.material : [this.fill.material])
                .forEach((material) => material?.dispose());
            this.fill = null;
        }
        for (const line of [this.lineA, this.lineB]) {
            if (!line) continue;
            this.group.remove(line);
            line.geometry?.dispose();
            const material = line.material;
            (Array.isArray(material) ? material : [material]).forEach((entry) => entry?.dispose());
        }
        this.lineA = null;
        this.lineB = null;
    }
}
