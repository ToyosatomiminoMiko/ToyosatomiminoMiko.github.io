import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { SceneObject } from '../ir/types';

// ============================================================
// 渲染常量
// ============================================================
const BAR_GAP = 0.05;
const DEPTH_2D = 0.3;
const OPACITY_RIEMANN = 0.5;
const OPACITY_LEBESGUE = 0.5;
const EDGE_OPACITY_RIEMANN = 0.4;

// 所有柱条共享同一个单位立方体及其线框几何体,避免每次可视化重复分配.
const SHARED_BOX_GEOMETRY = new THREE.BoxGeometry(1, 1, 1);
const SHARED_EDGE_GEOMETRY = new THREE.EdgesGeometry(SHARED_BOX_GEOMETRY);

// ============================================================
// 内部类型
// ============================================================

interface BarDef {
    pos: [number, number, number];
    scale: [number, number, number];
    color: THREE.Color;
}

interface BarOptions {
    opacity?: number;
    color?: THREE.Color;
    edgeOpacity?: number;
    edgeColor?: THREE.Color;
}

type LayerCallback = (
    threshold: number,
    centerY: number,
    k: number,
    color: THREE.Color,
    dy: number,
) => BarDef[] | undefined;

// ============================================================
// IntegralVisualizer — 黎曼 / 梯形 / 辛普森 / 勒贝格积分可视化
// ============================================================
export class IntegralVisualizer {
    scene: THREE.Scene;
    group: THREE.Group;
    cache: Map<number | string, { type: string; objects: THREE.Group }>;

    constructor(scene: THREE.Scene) {
        this.scene = scene;
        this.group = new THREE.Group();
        this.scene.add(this.group);
        this.cache = new Map();
    }

    clearAll(): void {
        while (this.group.children.length > 0) {
            const child = this.group.children[0];
            this.group.remove(child);
            this._disposeGroup(child);
        }
        this.cache.clear();
    }

    clear(id: number | string): void {
        // 清除黎曼可视化缓存
        const entry = this.cache.get(id);
        if (entry) {
            this.group.remove(entry.objects);
            this._disposeGroup(entry.objects);
            this.cache.delete(id);
        }
        // 清除勒贝格可视化缓存;键名后缀为 '_lebesgue'
        const lebesgueKey = `${id}_lebesgue`;
        const lebesgueEntry = this.cache.get(lebesgueKey);
        if (lebesgueEntry) {
            this.group.remove(lebesgueEntry.objects);
            this._disposeGroup(lebesgueEntry.objects);
            this.cache.delete(lebesgueKey);
        }
    }

    dispose(): void {
        this.clearAll();
        this.scene.remove(this.group);
    }

    // ============================================================
    // 2D / 3D 黎曼和可视化
    // ============================================================

    /** 2D 黎曼和可视化 */
    visualize2DRiemann(
        obj: SceneObject,
        fn: (x: number) => number,
        a: number,
        b: number,
        N: number,
        cacheKey: number | string = obj.id,
    ): void {
        const h = (b - a) / N;
        const color = new THREE.Color(obj.color);
        const bars: BarDef[] = [];

        for (let i = 0; i < N; i++) {
            const x0 = a + i * h;
            const yVal = fn(x0);
            if (!isFinite(yVal) || Math.abs(yVal) < 1e-12) continue;
            bars.push({
                pos: [x0 + h / 2, yVal / 2, 0],
                scale: [h * (1 - BAR_GAP), Math.abs(yVal), DEPTH_2D],
                color,
            });
        }

        if (bars.length === 0) return;
        const group = this._instancedMeshGroup(bars, {
            opacity: OPACITY_RIEMANN,
            edgeOpacity: EDGE_OPACITY_RIEMANN,
            edgeColor: color,
        });
        this.group.add(group);
        this.cache.set(cacheKey, { type: '2d', objects: group });
    }

    /** 3D 黎曼和可视化 */
    visualize3DRiemann(
        obj: SceneObject,
        fn: (x: number, y: number) => number,
        xRange: [number, number],
        yRange: [number, number],
        N: number,
        M: number,
        cacheKey: number | string = obj.id,
    ): void {
        const [xMin, xMax] = xRange;
        const [yMin, yMax] = yRange;
        const hx = (xMax - xMin) / N;
        const hy = (yMax - yMin) / M;
        const baseColor = new THREE.Color(obj.color);
        const bars: BarDef[] = [];

        for (let j = 0; j < M; j++) {
            for (let i = 0; i < N; i++) {
                const x0 = xMin + i * hx;
                const y0 = yMin + j * hy;
                const zVal = fn(x0, y0);
                if (!isFinite(zVal) || Math.abs(zVal) < 1e-12) continue;

                const c = baseColor.clone();
                c.multiplyScalar(Math.max(0.3, Math.min(1.2, 0.6 + 0.4 * (zVal / 4 + 0.5))));

                bars.push({
                    pos: [x0 + hx / 2, y0 + hy / 2, zVal / 2],
                    scale: [hx * (1 - BAR_GAP), hy * (1 - BAR_GAP), Math.abs(zVal)],
                    color: c,
                });
            }
        }

        if (bars.length === 0) return;
        const group = this._instancedMeshGroup(bars, {
            opacity: OPACITY_RIEMANN - 0.05,
            edgeOpacity: 0.15,
            edgeColor: baseColor.clone().multiplyScalar(1.3),
        });
        this.group.add(group);
        this.cache.set(cacheKey, { type: '3d', objects: group });
    }

    // ============================================================
    // 2D / 3D 梯形积分可视化
    // ============================================================

    /** 一维梯形积分:每个区间画一个真实梯形棱柱. */
    visualize2DTrapezoid(
        obj: SceneObject,
        fn: (x: number) => number,
        a: number,
        b: number,
        N: number,
        cacheKey: number | string = obj.id,
    ): void {
        const h = (b - a) / N;
        const segments: Array<{ x0: number; x1: number; y0: number; y1: number }> = [];

        for (let i = 0; i < N; i += 1) {
            const x0 = a + i * h;
            const x1 = a + (i + 1) * h;
            segments.push({ x0, x1, y0: fn(x0), y1: fn(x1) });
        }

        this._areaPrismGroup(
            segments,
            new THREE.Color(obj.color),
            OPACITY_RIEMANN,
            cacheKey,
            '2d_trapezoid',
        );
    }

    /** 一维辛普森积分:每个双区间画插值抛物线下的面积. */
    visualize2DSimpson(
        obj: SceneObject,
        fn: (x: number) => number,
        a: number,
        b: number,
        N: number,
        cacheKey: number | string = obj.id,
    ): void {
        if (N < 2 || N % 2 !== 0) return;

        const h = (b - a) / N;
        const samples = 12;
        const segments: Array<{ x0: number; x1: number; y0: number; y1: number }> = [];

        for (let pair = 0; pair < N / 2; pair += 1) {
            const x0 = a + pair * 2 * h;
            const x1 = x0 + h;
            const x2 = x0 + 2 * h;
            const points = this._quadraticPoints(
                x0,
                x1,
                x2,
                fn(x0),
                fn(x1),
                fn(x2),
                samples,
            );

            for (let i = 0; i < points.length - 1; i += 1) {
                segments.push({
                    x0: points[i].x,
                    x1: points[i + 1].x,
                    y0: points[i].y,
                    y1: points[i + 1].y,
                });
            }
        }

        this._areaPrismGroup(
            segments,
            new THREE.Color(obj.color),
            OPACITY_RIEMANN - 0.08,
            cacheKey,
            '2d_simpson',
        );
    }

    /** 二维梯形积分:绘制被积函数曲面和侧壁,不再误画黎曼柱. */
    visualize3DTrapezoid(
        obj: SceneObject,
        fn: (x: number, y: number) => number,
        xRange: [number, number],
        yRange: [number, number],
        N: number,
        M: number,
        cacheKey: number | string = obj.id,
    ): void {
        this._trapezoid2DAreaGroup(
            fn,
            xRange,
            yRange,
            N,
            M,
            new THREE.Color(obj.color),
            OPACITY_RIEMANN - 0.05,
            cacheKey,
            '3d_trapezoid',
        );
    }

    /** 二维辛普森积分:同样绘制被积函数曲面,不误画黎曼柱. */
    visualize3DSimpson(
        obj: SceneObject,
        fn: (x: number, y: number) => number,
        xRange: [number, number],
        yRange: [number, number],
        N: number,
        M: number,
        cacheKey: number | string = obj.id,
    ): void {
        this._surfaceAreaGroup(
            fn,
            xRange,
            yRange,
            N,
            M,
            new THREE.Color(obj.color),
            OPACITY_RIEMANN - 0.1,
            cacheKey,
            '3d_simpson',
        );
    }

    // ============================================================
    // 2D / 3D 勒贝格可视化
    // ============================================================

    /** 2D 勒贝格可视化 */
    visualize2DLebesgue(
        obj: SceneObject,
        fn: (x: number) => number,
        a: number,
        b: number,
        layers: number,
        sampleN: number,
        cacheKey: number | string = obj.id,
    ): void {
        const baseColor = new THREE.Color(obj.color);

        const h = (b - a) / sampleN;
        const samples: { x: number; y: number }[] = [];
        let yMin = Infinity;
        let yMax = -Infinity;
        for (let x = a; x <= b; x += h) {
            const y = fn(x);
            if (isFinite(y)) {
                samples.push({ x, y });
                if (y < yMin) yMin = y;
                if (y > yMax) yMax = y;
            }
        }
        if (samples.length === 0) return;

        const scanIntervals = (predicate: (y: number) => boolean): [number, number][] => {
            const intervals: [number, number][] = [];
            let start: number | null = null;
            for (let i = 0; i < samples.length; i++) {
                const inRange = isFinite(samples[i].y) && predicate(samples[i].y);
                if (inRange && start === null) start = samples[i].x;
                if (!inRange && start !== null) {
                    intervals.push([start, samples[i].x]);
                    start = null;
                }
            }
            if (start !== null) intervals.push([start, b]);
            return intervals;
        };

        const strips = this._layerLoop(yMin, yMax, layers, baseColor, 0.15,
            (threshold, centerY, _k, color, dy) => {
                const result: BarDef[] = [];
                const pred = centerY >= 0
                    ? (y: number) => y > threshold
                    : (y: number) => y < -threshold;
                const intervals = scanIntervals(pred);
                for (const [xStart, xEnd] of intervals) {
                    const w = xEnd - xStart;
                    if (w < 1e-6) continue;
                    result.push({
                        pos: [(xStart + xEnd) / 2, centerY, 0],
                        scale: [w * (1 - BAR_GAP), dy * (1 - BAR_GAP), 0.15],
                        color,
                    });
                }
                return result;
            },
        );

        if (strips.length === 0) return;
        const group = this._instancedMeshGroup(strips, { opacity: OPACITY_LEBESGUE });
        this.group.add(group);
        // id + 后缀记得清理
        this.cache.set(`${cacheKey}_lebesgue`, { type: '2d', objects: group });
    }

    /** 3D 勒贝格积分可视化(等高线切片) */
    visualize3DLebesgue(
        obj: SceneObject,
        fn: (x: number, y: number) => number,
        xRange: [number, number],
        yRange: [number, number],
        layers: number,
        res: number,
        cacheKey: number | string = obj.id,
    ): void {
        const [xMin, xMax] = xRange;
        const [yMin, yMax] = yRange;
        const baseColor = new THREE.Color(obj.color);
        const hx = (xMax - xMin) / res;
        const hy = (yMax - yMin) / res;

        let zMin = Infinity;
        let zMax = -Infinity;
        const stride = res + 1;
        const grid = new Float64Array(stride * stride);
        for (let j = 0; j <= res; j++) {
            const y = yMin + j * hy;
            for (let i = 0; i <= res; i++) {
                const z = fn(xMin + i * hx, y);
                if (isFinite(z)) {
                    grid[j * stride + i] = z;
                    if (z < zMin) zMin = z;
                    if (z > zMax) zMax = z;
                } else {
                    grid[j * stride + i] = NaN;
                }
            }
        }
        if (!isFinite(zMin) || !isFinite(zMax)) return;

        const slices = this._layerLoop(zMin, zMax, layers, baseColor, 0,
            (threshold, centerZ, _k, color, _dy) => {
                const result: BarDef[] = [];
                const predicate = centerZ >= 0
                    ? (z: number) => z > threshold
                    : (z: number) => z < -threshold;

                for (let j = 0; j < res; j++) {
                    for (let i = 0; i < res; i++) {
                        const z00 = grid[j * stride + i];
                        if (!isFinite(z00)) continue;
                        if (predicate(z00)) {
                            result.push({
                                pos: [xMin + (i + 0.5) * hx, yMin + (j + 0.5) * hy, centerZ],
                                scale: [hx * (1 - BAR_GAP), hy * (1 - BAR_GAP), 0.05],
                                color,
                            });
                        }
                    }
                }
                return result;
            },
        );

        if (slices.length === 0) return;
        const group = this._instancedMeshGroup(slices, { opacity: OPACITY_LEBESGUE - 0.1 });
        this.group.add(group);
        // id + 后缀
        this.cache.set(`${cacheKey}_lebesgue`, { type: '3d', objects: group });
    }

    // ============================================================
    //  内部方法
    // ============================================================

    /** 用若干带符号的一维面积多边形生成棱柱并合并成单个 Group. */
    private _areaPrismGroup(
        segments: Array<{ x0: number; x1: number; y0: number; y1: number }>,
        color: THREE.Color,
        opacity: number,
        cacheKey: number | string,
        cacheType: string,
    ): void {
        const geometries: THREE.BufferGeometry[] = [];

        for (const segment of segments) {
            for (const polygon of this._signedAreaPolygons(segment)) {
                const shape = new THREE.Shape(polygon.map(([x, y]) => new THREE.Vector2(x, y)));
                const geometry = new THREE.ExtrudeGeometry(shape, {
                    depth: DEPTH_2D,
                    bevelEnabled: false,
                });
                geometry.translate(0, 0, -DEPTH_2D / 2);
                geometries.push(geometry);
            }
        }

        if (geometries.length === 0) return;
        const merged = mergeGeometries(geometries);
        geometries.forEach((geometry) => geometry.dispose());
        if (!merged) return;

        const material = new THREE.MeshPhongMaterial({
            color,
            transparent: true,
            opacity,
            side: THREE.DoubleSide,
            depthWrite: false,
        });
        const mesh = new THREE.Mesh(merged, material);
        const group = new THREE.Group();
        group.add(mesh);

        const edges = new THREE.LineSegments(
            new THREE.EdgesGeometry(merged, 30),
            new THREE.LineBasicMaterial({
                color,
                transparent: true,
                opacity: 0.35,
            }),
        );
        group.add(edges);

        this.group.add(group);
        this.cache.set(cacheKey, { type: cacheType, objects: group });
    }

    /** 把单个梯形区间拆成不跨零的简单多边形. */
    private _signedAreaPolygons(
        segment: { x0: number; x1: number; y0: number; y1: number },
    ): number[][][] {
        const { x0, x1, y0, y1 } = segment;
        if (!isFinite(y0) || !isFinite(y1)) return [];
        if (Math.abs(y0) < 1e-12 && Math.abs(y1) < 1e-12) return [];

        if (Math.abs(y0) < 1e-12) {
            return [[[x0, 0], [x1, y1], [x1, 0]]];
        }
        if (Math.abs(y1) < 1e-12) {
            return [[[x0, 0], [x0, y0], [x1, 0]]];
        }
        if (y0 * y1 < 0) {
            const xc = x0 - (y0 * (x1 - x0)) / (y1 - y0);
            return [
                [[x0, 0], [x0, y0], [xc, 0]],
                [[xc, 0], [x1, y1], [x1, 0]],
            ];
        }

        return [[[x0, 0], [x0, y0], [x1, y1], [x1, 0]]];
    }

    /** 通过拉格朗日插值生成 Simpson 抛物线采样点. */
    private _quadraticPoints(
        x0: number,
        x1: number,
        x2: number,
        y0: number,
        y1: number,
        y2: number,
        samples: number,
    ): Array<{ x: number; y: number }> {
        if (!isFinite(y0) || !isFinite(y1) || !isFinite(y2)) return [];

        const l0 = (x: number): number => ((x - x1) * (x - x2)) / ((x0 - x1) * (x0 - x2));
        const l1 = (x: number): number => ((x - x0) * (x - x2)) / ((x1 - x0) * (x1 - x2));
        const l2 = (x: number): number => ((x - x0) * (x - x1)) / ((x2 - x0) * (x2 - x1));
        const points: Array<{ x: number; y: number }> = [];

        for (let i = 0; i <= samples; i += 1) {
            const x = x0 + ((x2 - x0) * i) / samples;
            points.push({ x, y: y0 * l0(x) + y1 * l1(x) + y2 * l2(x) });
        }
        return points;
    }

    /** 二维梯形积分:每个网格单元生成一个真实梯形棱柱. */
    private _trapezoid2DAreaGroup(
        fn: (x: number, y: number) => number,
        xRange: [number, number],
        yRange: [number, number],
        nx: number,
        ny: number,
        color: THREE.Color,
        opacity: number,
        cacheKey: number | string,
        cacheType: string,
    ): void {
        const [xMin, xMax] = xRange;
        const [yMin, yMax] = yRange;
        const hx = (xMax - xMin) / nx;
        const hy = (yMax - yMin) / ny;
        const positions: number[] = [];
        const indices: number[] = [];

        const addVertex = (x: number, y: number, z: number): number => {
            positions.push(x, y, z);
            return positions.length / 3 - 1;
        };
        const addQuad = (a: number, b: number, c: number, d: number): void => {
            indices.push(a, b, c, a, c, d);
        };

        for (let j = 0; j < ny; j += 1) {
            const y0 = yMin + j * hy;
            const y1 = yMin + (j + 1) * hy;
            for (let i = 0; i < nx; i += 1) {
                const x0 = xMin + i * hx;
                const x1 = xMin + (i + 1) * hx;
                const z00 = fn(x0, y0);
                const z10 = fn(x1, y0);
                const z01 = fn(x0, y1);
                const z11 = fn(x1, y1);
                if (!isFinite(z00) || !isFinite(z10) || !isFinite(z01) || !isFinite(z11)) {
                    continue;
                }

                const b00 = addVertex(x0, y0, 0);
                const b10 = addVertex(x1, y0, 0);
                const b01 = addVertex(x0, y1, 0);
                const b11 = addVertex(x1, y1, 0);
                const t00 = addVertex(x0, y0, z00);
                const t10 = addVertex(x1, y0, z10);
                const t01 = addVertex(x0, y1, z01);
                const t11 = addVertex(x1, y1, z11);

                addQuad(t00, t10, t11, t01);
                addQuad(b00, b10, b11, b01);
                addQuad(b00, t00, t10, b10);
                addQuad(b10, t10, t11, b11);
                addQuad(b11, t11, t01, b01);
                addQuad(b01, t01, t00, b00);
            }
        }

        if (indices.length === 0) return;
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();

        const material = new THREE.MeshPhongMaterial({
            color,
            transparent: true,
            opacity,
            side: THREE.DoubleSide,
            depthWrite: false,
        });
        const mesh = new THREE.Mesh(geometry, material);
        const group = new THREE.Group();
        group.add(mesh);

        const edges = new THREE.LineSegments(
            new THREE.EdgesGeometry(geometry, 30),
            new THREE.LineBasicMaterial({
                color,
                transparent: true,
                opacity: 0.3,
            }),
        );
        group.add(edges);

        this.group.add(group);
        this.cache.set(cacheKey, { type: cacheType, objects: group });
    }

    /** 二维积分曲面可视化:透明被积函数曲面 + 边界侧壁. */
    private _surfaceAreaGroup(
        fn: (x: number, y: number) => number,
        xRange: [number, number],
        yRange: [number, number],
        nx: number,
        ny: number,
        color: THREE.Color,
        opacity: number,
        cacheKey: number | string,
        cacheType: string,
    ): void {
        const [xMin, xMax] = xRange;
        const [yMin, yMax] = yRange;
        const stride = nx + 1;
        const xs = new Float64Array(stride);
        const ys = new Float64Array(stride);
        const zs = new Float64Array(stride * stride);
        let hasFinite = false;

        for (let i = 0; i <= nx; i += 1) xs[i] = xMin + ((xMax - xMin) * i) / nx;
        for (let j = 0; j <= ny; j += 1) ys[j] = yMin + ((yMax - yMin) * j) / ny;
        for (let j = 0; j <= ny; j += 1) {
            for (let i = 0; i <= nx; i += 1) {
                const z = fn(xs[i], ys[j]);
                if (isFinite(z)) {
                    zs[j * stride + i] = z;
                    hasFinite = true;
                } else {
                    zs[j * stride + i] = NaN;
                }
            }
        }
        if (!hasFinite) return;

        const positions: number[] = [];
        const indices: number[] = [];
        const topIndex = new Int32Array(stride * stride);
        topIndex.fill(-1);

        for (let j = 0; j <= ny; j += 1) {
            for (let i = 0; i <= nx; i += 1) {
                const idx = j * stride + i;
                topIndex[idx] = positions.length / 3;
                positions.push(xs[i], ys[j], isFinite(zs[idx]) ? zs[idx] : 0);
            }
        }

        for (let j = 0; j < ny; j += 1) {
            for (let i = 0; i < nx; i += 1) {
                const i00 = j * stride + i;
                const i10 = i00 + 1;
                const i01 = i00 + stride;
                const i11 = i01 + 1;
                if (
                    !isFinite(zs[i00])
                    || !isFinite(zs[i10])
                    || !isFinite(zs[i01])
                    || !isFinite(zs[i11])
                ) {
                    continue;
                }

                const a = topIndex[i00];
                const b = topIndex[i10];
                const c = topIndex[i01];
                const d = topIndex[i11];
                indices.push(a, b, d, a, d, c);
            }
        }

        const addVerticalQuad = (
            i0: number,
            j0: number,
            i1: number,
            j1: number,
        ): void => {
            const idx0 = j0 * stride + i0;
            const idx1 = j1 * stride + i1;
            if (!isFinite(zs[idx0]) || !isFinite(zs[idx1])) return;
            if (Math.max(Math.abs(zs[idx0]), Math.abs(zs[idx1])) < 1e-12) return;

            const top0 = topIndex[idx0];
            const top1 = topIndex[idx1];
            const bottom0 = positions.length / 3;
            positions.push(xs[i0], ys[j0], 0);
            const bottom1 = positions.length / 3;
            positions.push(xs[i1], ys[j1], 0);
            indices.push(top0, bottom0, bottom1, top0, bottom1, top1);
        };

        for (let j = 0; j < ny; j += 1) {
            addVerticalQuad(0, j, 0, j + 1);
            addVerticalQuad(nx, j, nx, j + 1);
        }
        for (let i = 0; i < nx; i += 1) {
            addVerticalQuad(i, 0, i + 1, 0);
            addVerticalQuad(i, ny, i + 1, ny);
        }

        if (indices.length === 0) return;
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();

        const material = new THREE.MeshPhongMaterial({
            color,
            transparent: true,
            opacity,
            side: THREE.DoubleSide,
            depthWrite: false,
        });
        const mesh = new THREE.Mesh(geometry, material);
        const group = new THREE.Group();
        group.add(mesh);

        const edges = new THREE.LineSegments(
            new THREE.EdgesGeometry(geometry, 30),
            new THREE.LineBasicMaterial({
                color,
                transparent: true,
                opacity: 0.3,
            }),
        );
        group.add(edges);

        this.group.add(group);
        this.cache.set(cacheKey, { type: cacheType, objects: group });
    }

    /** 递归释放 Group 中所有 Mesh 的 GPU 资源 */
    private _disposeGroup(group: THREE.Object3D): void {
        group.traverse((node) => {
            if (node instanceof THREE.InstancedMesh) {
                // 释放 InstancedMesh 自己的 instanceMatrix/instanceColor.
                // geometry 是共享的,不能在这里 dispose.
                node.dispose();
                if (Array.isArray(node.material)) {
                    node.material.forEach(m => m.dispose());
                } else {
                    node.material?.dispose();
                }
            } else if (node instanceof THREE.Mesh) {
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
                    node.material?.dispose();
                }
            }
        });
    }

    /** 用 InstancedMesh 批量渲染柱子(减少 draw call) */
    private _instancedMeshGroup(bars: BarDef[], opts: BarOptions = {}): THREE.Group {
        const { opacity, color, edgeOpacity, edgeColor } = opts;
        const mat = new THREE.MeshPhongMaterial({
            transparent: true,
            opacity: opacity ?? 0.6,
            side: THREE.DoubleSide,
        });

        const mesh = new THREE.InstancedMesh(SHARED_BOX_GEOMETRY, mat, bars.length);
        const dummy = new THREE.Object3D();
        for (let i = 0; i < bars.length; i++) {
            const b = bars[i];
            dummy.position.set(b.pos[0], b.pos[1], b.pos[2]);
            dummy.scale.set(b.scale[0], b.scale[1], b.scale[2]);
            dummy.updateMatrix();
            mesh.setMatrixAt(i, dummy.matrix);
            mesh.setColorAt(i, b.color);
        }
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) {
            mesh.instanceColor.needsUpdate = true;
        }

        const group = new THREE.Group();
        group.add(mesh);

        // 可选线框
        if (edgeOpacity && edgeOpacity > 0) {
            const edgeMat = new THREE.LineBasicMaterial({
                color: edgeColor ?? color ?? 0xffffff,
                transparent: true,
                opacity: edgeOpacity,
            });
            const wireMesh = new THREE.InstancedMesh(SHARED_EDGE_GEOMETRY, edgeMat, bars.length);
            for (let i = 0; i < bars.length; i++) {
                const b = bars[i];
                dummy.position.set(b.pos[0], b.pos[1], b.pos[2]);
                dummy.scale.set(b.scale[0], b.scale[1], b.scale[2]);
                dummy.updateMatrix();
                wireMesh.setMatrixAt(i, dummy.matrix);
            }
            wireMesh.instanceMatrix.needsUpdate = true;
            group.add(wireMesh);
        }

        return group;
    }

    /** 分层循环工具:正部从 0 向上,负部从 0 向下 */
    private _layerLoop(
        yMin: number,
        yMax: number,
        layers: number,
        baseColor: THREE.Color,
        blueTint: number,
        callback: LayerCallback,
    ): BarDef[] {
        const bars: BarDef[] = [];

        // 正部:从 0 向上
        if (yMax > 1e-12) {
            const dy = yMax / layers;
            if (dy >= 1e-12) {
                for (let k = 0; k < layers; k++) {
                    const threshold = k * dy;
                    const center = (threshold + (k + 1) * dy) / 2;
                    const c = baseColor.clone().lerp(
                        new THREE.Color(0xffffff),
                        (k / layers) * 0.5,
                    );
                    const layerBars = callback(threshold, center, k, c, dy);
                    if (layerBars) bars.push(...layerBars);
                }
            }
        }

        // 负部:从 0 向下
        if (yMin < -1e-12) {
            const dy = -yMin / layers;
            if (dy >= 1e-12) {
                for (let k = 0; k < layers; k++) {
                    const threshold = k * dy;
                    const center = -(threshold + (k + 1) * dy) / 2;
                    const c = baseColor.clone()
                        .lerp(new THREE.Color(0xffffff), (k / layers) * 0.5);
                    if (blueTint > 0) {
                        c.lerp(new THREE.Color(0x4488ff), blueTint);
                    }
                    const layerBars = callback(threshold, center, k, c, dy);
                    if (layerBars) bars.push(...layerBars);
                }
            }
        }

        return bars;
    }
}
