import * as THREE from 'three';
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
// IntegralVisualizer — 黎曼 / 勒贝格积分可视化
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
