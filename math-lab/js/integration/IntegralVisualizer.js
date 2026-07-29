import * as THREE from 'three';

/*
黎曼 & 勒贝格积分可视化
*/
// 渲染常量
const BAR_GAP = 0.05;        // 方块间隙比例
const DEPTH_2D = 0.3;        // 2D 柱体 z 轴深度
const OPACITY_RIEMANN = 0.5;
const OPACITY_LEBESGUE = 0.5;
const EDGE_OPACITY_RIEMANN = 0.4;

export class IntegralVisualizer {
    constructor(scene) {
        this.scene = scene;
        this.group = new THREE.Group();
        this.scene.add(this.group);
        this.cache = new Map(); // id -> { type, objects }
    }

    clearAll() {
        while (this.group.children.length > 0) {
            const child = this.group.children[0];
            this.group.remove(child);
            this._disposeGroup(child);
        }
        this.cache.clear();
    }

    clear(id) {
        const entry = this.cache.get(id);
        if (entry) {
            this.group.remove(entry.objects);
            this._disposeGroup(entry.objects);
            this.cache.delete(id);
        }
    }

    _disposeGroup(group) {
        group.traverse(node => {
            if (node.isMesh) {
                node.geometry?.dispose();
                if (Array.isArray(node.material)) {
                    node.material.forEach(m => m.dispose());
                } else {
                    node.material?.dispose();
                }
            }
        });
    }

    // 返回 THREE.Group
    _instancedMeshGroup(bars, opts = {}) {
        const { opacity, color, edgeOpacity, edgeColor } = opts;
        const boxGeo = new THREE.BoxGeometry(1, 1, 1);
        const mat = new THREE.MeshPhongMaterial({
            transparent: true,
            opacity: opacity ?? 0.6,
            side: THREE.DoubleSide,
        });

        const mesh = new THREE.InstancedMesh(boxGeo, mat, bars.length);
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
        mesh.instanceColor.needsUpdate = true;

        const group = new THREE.Group();
        group.add(mesh);

        // 可选线框
        if (edgeOpacity && edgeOpacity > 0) {
            const edgeGeo = new THREE.EdgesGeometry(boxGeo);
            const edgeMat = new THREE.LineBasicMaterial({
                color: edgeColor ?? color ?? 0xffffff,
                transparent: true,
                opacity: edgeOpacity,
            });
            const wireMesh = new THREE.InstancedMesh(edgeGeo, edgeMat, bars.length);
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

    _layerLoop(yMin, yMax, layers, baseColor, blueTint, callback) {
        const bars = [];

        //  正部:从 0 向上
        if (yMax > 1e-12) {
            const dy = yMax / layers;
            if (dy >= 1e-12) {
                for (let k = 0; k < layers; k++) {
                    const threshold = k * dy;
                    const center = (threshold + (k + 1) * dy) / 2;
                    const c = baseColor.clone().lerp(
                        new THREE.Color(0xffffff),
                        (k / layers) * 0.5
                    );
                    const layerBars = callback(threshold, center, k, c, dy);
                    if (layerBars) bars.push(...layerBars);
                }
            }
        }

        //  负部:从 0 向下
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

    // 2D 黎曼和可视化
    // 用 InstancedMesh 合并所有方块,减少 draw call
    // 间隙 gap 控制方块之间的视觉间隔,gap=0 为紧贴
    visualize2DRiemann(expr, a, b, N) {
        const fn = expr.fn;
        const h = (b - a) / N;
        const color = new THREE.Color(expr.color);
        const bars = [];

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
        this.cache.set(expr.id, { type: '2d', objects: group });
    }

    visualize3DRiemann(expr, xRange, yRange, N, M) {
        const fn = expr.fn;
        const [xMin, xMax] = xRange;
        const [yMin, yMax] = yRange;
        const hx = (xMax - xMin) / N;
        const hy = (yMax - yMin) / M;
        const baseColor = new THREE.Color(expr.color);
        const bars = [];

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
            opacity: OPACITY_RIEMANN - 0.05,   // 原来 0.55
            edgeOpacity: 0.15,
            edgeColor: baseColor.clone().multiplyScalar(1.3),
        });
        this.group.add(group);
        this.cache.set(expr.id, { type: '3d', objects: group });
    }

    // 2D勒贝格可视化
    visualize2DLebesgue(expr, a, b, layers, sampleN) {
        const fn = expr.fn;
        const baseColor = new THREE.Color(expr.color);

        const h = (b - a) / sampleN;
        const samples = [];
        let yMin = Infinity, yMax = -Infinity;
        for (let x = a; x <= b; x += h) {
            const y = fn(x);
            if (isFinite(y)) {
                samples.push({ x, y });
                if (y < yMin) yMin = y;
                if (y > yMax) yMax = y;
            }
        }
        if (samples.length === 0) return;

        const scanIntervals = (predicate) => {
            const intervals = [];
            let start = null;
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

        //  分层生成条带 
        const strips = this._layerLoop(yMin, yMax, layers, baseColor, 0.15,
            (threshold, centerY, _k, color, dy) => {
                const result = [];
                const pred = centerY >= 0
                    ? (y) => y > threshold
                    : (y) => y < -threshold;
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
            }
        );

        if (strips.length === 0) return;
        const group = this._instancedMeshGroup(strips, { opacity: OPACITY_LEBESGUE });
        this.group.add(group);
        this.cache.set(expr.id + '_lebesgue', { type: '2d', objects: group });
    }

    // ================================================================
    // 3D 勒贝格积分可视化(等高线切片)
    // 数学逻辑:严格区分正部(z>0,向上堆叠)和负部(z<0,向下堆叠)
    // 阈值全部从 z=0 开始计算,确保准确反映函数与 xOy 平面围成的有符号体积
    // ================================================================
    visualize3DLebesgue(expr, xRange, yRange, res) {
        const fn = expr.fn;
        const [xMin, xMax] = xRange;
        const [yMin, yMax] = yRange;
        const baseColor = new THREE.Color(expr.color);
        const hx = (xMax - xMin) / res;
        const hy = (yMax - yMin) / res;

        // ── 网格采样 ──
        let zMin = Infinity, zMax = -Infinity;
        const grid = [];
        for (let j = 0; j <= res; j++) {
            const y = yMin + j * hy;
            const row = [];
            for (let i = 0; i <= res; i++) {
                const z = fn(xMin + i * hx, y);
                if (isFinite(z)) {
                    row.push(z);
                    if (z < zMin) zMin = z;
                    if (z > zMax) zMax = z;
                } else {
                    row.push(NaN);
                }
            }
            grid.push(row);
        }
        if (!isFinite(zMin) || !isFinite(zMax)) return;

        // ── 分层生成切片 ──
        const slices = this._layerLoop(zMin, zMax, res, baseColor, 0,
            (threshold, centerZ, _k, color, _dy) => {
                const result = [];
                const predicate = centerZ >= 0
                    ? (z) => z > threshold
                    : (z) => z < -threshold;

                for (let j = 0; j < res; j++) {
                    for (let i = 0; i < res; i++) {
                        const z00 = grid[j][i], z10 = grid[j][i + 1];
                        const z01 = grid[j + 1][i], z11 = grid[j + 1][i + 1];
                        if (!isFinite(z00) || !isFinite(z10) || !isFinite(z01) || !isFinite(z11))
                            continue;
                        if (predicate(z00) && predicate(z10) && predicate(z01) && predicate(z11)) {
                            result.push({
                                pos: [xMin + (i + 0.5) * hx, yMin + (j + 0.5) * hy, centerZ],
                                scale: [hx * (1 - BAR_GAP), hy * (1 - BAR_GAP), 0.05],
                                color,
                            });
                        }
                    }
                }
                return result;
            }
        );

        if (slices.length === 0) return;
        const group = this._instancedMeshGroup(slices, { opacity: OPACITY_LEBESGUE - 0.1 });
        this.group.add(group);
        this.cache.set(expr.id + '_lebesgue', { type: '3d', objects: group });
    }
}