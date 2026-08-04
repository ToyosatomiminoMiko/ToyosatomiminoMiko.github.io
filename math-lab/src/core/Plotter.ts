import * as THREE from 'three';
import { SurfaceMesh } from '../visualization/SurfaceMesh';
import type {
    CurveExpr,
    SurfaceExpr,
    PointEntity,
    VectorEntity,
    MathObject,
} from '../types';
import * as math from 'mathjs';
import { ArrowMesh } from '../visualization/ArrowMesh';

// ============================================================
// 内部类型：绘图条目（discriminated union）
// ============================================================

interface CurveEntry {
    objectKind: 'curve';
    group: THREE.Group;
    line: THREE.Line | null;
    enabled: boolean;
}

interface SurfaceEntry {
    objectKind: 'surface';
    group: THREE.Group;
    mesh: SurfaceMesh | null;
    enabled: boolean;
}

interface PointEntry {
    objectKind: 'point';
    group: THREE.Group;
    sphere: THREE.Mesh;
    enabled: boolean;
}

interface VectorEntry {
    objectKind: 'vector';
    group: THREE.Group;
    arrow: ArrowMesh;
    enabled: boolean;
}

type PlotEntry = CurveEntry | SurfaceEntry | PointEntry | VectorEntry;

/**
 * 增量式绘图器 —— 每个表达式拥有独立的 THREE.Group
 *
 * 设计原则:
 * - add/remove 仅操作目标 Group
 * - toggle 仅设置 Group.visible
 * - 模式切换仅遍历更新 visible
 * - 绝不执行 clearAll 式清空
 */

export class Plotter {
    scene: THREE.Scene;
    plotMap: Map<number, PlotEntry>;
    currentMode: '2d' | '3d';
    plotContainer: THREE.Group;

    constructor(scene: THREE.Scene) {
        this.scene = scene;
        this.plotMap = new Map();
        this.currentMode = '2d';
        this.plotContainer = new THREE.Group();
        this.scene.add(this.plotContainer);
    }

    // =====================================================
    //  公开 API
    // =====================================================

    /**
     * 绘制 / 更新 2D 曲线
     */
    drawCurve(
        curve: CurveExpr,
        xRange: [number, number] = [-8, 8],
        steps: number = 320,
    ): void {
        const { id, color, enabled } = curve;
        const compiled = curve.node.compile();
        let entry = this.plotMap.get(id);

        if (!entry || entry.objectKind !== 'curve') {
            const group = new THREE.Group();
            this.plotContainer.add(group);
            entry = {
                objectKind: 'curve',
                group,
                line: null,
                enabled: enabled ?? true,
            };
            this.plotMap.set(id, entry);
        }

        // 清理旧 line
        if (entry.line) {
            entry.group.remove(entry.line);
            entry.line.geometry?.dispose();
            const mat = entry.line.material;
            if (Array.isArray(mat)) {
                mat.forEach(m => m.dispose());
            } else {
                mat?.dispose();
            }
            entry.line = null;
        }

        const points = this._sampleCurve(curve, compiled, xRange, steps);
        if (points.length < 2) {
            entry.enabled = enabled ?? true;
            this._applyVisibility(entry);
            return;
        }

        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const material = new THREE.LineBasicMaterial({
            color: color || '#ffffff',
            linewidth: 1,
            transparent: true,
            opacity: 0.95,
        });
        const line = new THREE.Line(geometry, material);
        entry.group.add(line);
        entry.line = line;
        entry.enabled = enabled ?? true;
        this._applyVisibility(entry);
    }

    /**
     * 绘制 / 更新 3D 曲面（复用 SurfaceMesh,仅在分段数改变时重建）
     */
    drawSurface(
        surface: SurfaceExpr,
        range: [number, number] = [-6, 6],
        segments: number = 64,
    ): void {
        const { id, enabled } = surface;
        const compiled = surface.node.compile();
        let entry = this.plotMap.get(id);

        if (!entry || entry.objectKind !== 'surface') {
            const group = new THREE.Group();
            this.plotContainer.add(group);
            entry = {
                objectKind: 'surface',
                group,
                mesh: null,
                enabled: enabled ?? true,
            };
            this.plotMap.set(id, entry);
        }

        // 分段数变化时重建 SurfaceMesh
        if (entry.mesh) {
            if (entry.mesh.cols !== segments || entry.mesh.rows !== segments) {
                entry.group.remove(entry.mesh.group);
                entry.mesh.dispose();
                entry.mesh = null;
            }
        }

        if (!entry.mesh) {
            const mesh = new SurfaceMesh(segments, segments);
            entry.group.add(mesh.group);
            entry.mesh = mesh;
        }

        entry.mesh.update(
            compiled,
            surface.coefficients,
            range[0], range[1], range[0], range[1],
        );
        entry.enabled = enabled ?? true;
        this._applyVisibility(entry);
    }

    /**
     * 移除表达式（销毁 Group 及所有子对象,释放 GPU 资源）
     */
    remove(id: number): void {
        const entry = this.plotMap.get(id);
        if (!entry) return;

        switch (entry.objectKind) {
            case 'curve':
                if (entry.line) {
                    entry.line.geometry?.dispose();
                    const mat = entry.line.material;
                    if (Array.isArray(mat)) {
                        mat.forEach(m => m.dispose());
                    } else {
                        mat?.dispose();
                    }
                }
                break;

            case 'surface':
                if (entry.mesh) {
                    entry.mesh.dispose();
                }
                break;

            case 'point':
                if (entry.sphere) {
                    entry.sphere.geometry?.dispose();
                    const mat = entry.sphere.material;
                    if (Array.isArray(mat)) {
                        mat.forEach(m => m.dispose());
                    } else {
                        mat?.dispose();
                    }
                }
                break;

            case 'vector':
                if (entry.arrow) {
                    entry.arrow.dispose();
                }
                break;
        }

        this.plotContainer.remove(entry.group);
        this.plotMap.delete(id);
    }

    /**
     * 设置表达式可见性（toggle 专用）
     */
    setVisible(id: number, visible: boolean): void {
        const entry = this.plotMap.get(id);
        if (!entry) return;
        entry.enabled = visible;
        this._applyVisibility(entry);
    }

    /**
     * 根据对象数据刷新绘制（表达式字符串改变 / 模式切换时调用）
     */
    updateObject(obj: MathObject, mode: '2d' | '3d'): void {
        switch (obj.kind) {
            case 'curve':
                if (mode === '2d') this.drawCurve(obj);
                break;
            case 'surface':
                if (mode === '3d') this.drawSurface(obj);
                break;
            case 'point':
                this.drawPoint(obj);
                break;
            case 'vector':
                this.drawVector(obj);
                break;
        }
    }

    /**
     * 模式切换：仅更新所有 Group 的可见性,不销毁任何几何体
     */
    updateMode(mode: '2d' | '3d'): void {
        this.currentMode = mode;
        for (const [, entry] of this.plotMap) {
            this._applyVisibility(entry);
        }
    }

    /**
     * 销毁整个绘图器（仅在应用卸载时使用）
     */
    dispose(): void {
        for (const [id] of this.plotMap) {
            this.remove(id);
        }
        this.scene.remove(this.plotContainer);
    }

    /**
     * 绘制 / 更新一个空间点（小球）
     */
    drawPoint(point: PointEntity): void {
        const { id, x, y, z, color, enabled } = point;
        let entry = this.plotMap.get(id);

        if (!entry || entry.objectKind !== 'point') {
            const group = new THREE.Group();
            this.plotContainer.add(group);

            const geo = new THREE.SphereGeometry(0.2, 16, 16);
            const mat = new THREE.MeshPhongMaterial({
                color: color || '#ffffff',
                emissive: 0x000000,
                specular: 0x333333,
                shininess: 40,
            });
            const sphere = new THREE.Mesh(geo, mat);
            group.add(sphere);

            entry = {
                objectKind: 'point',
                group,
                sphere,
                enabled: enabled ?? true,
            };
            this.plotMap.set(id, entry);
        }

        entry.sphere.position.set(x, y, z);
        const mat = entry.sphere.material as THREE.MeshPhongMaterial;
        mat.color.set(color);
        entry.enabled = enabled ?? true;
        this._applyVisibility(entry);
    }

    /**
     * 绘制 / 更新空间向量箭头
     */
    drawVector(vec: VectorEntity): void {
        const { id, color, enabled } = vec;
        let entry = this.plotMap.get(id);

        if (!entry || entry.objectKind !== 'vector') {
            const arrow = new ArrowMesh(color);
            const group = arrow.group;
            entry = {
                objectKind: 'vector',
                group,
                arrow,
                enabled: enabled ?? true,
            };
            this.plotContainer.add(group);
            this.plotMap.set(id, entry);
        }

        const origin = new THREE.Vector3(
            vec.origin.x, vec.origin.y, vec.origin.z,
        );
        const direction = new THREE.Vector3(
            vec.direction.x, vec.direction.y, vec.direction.z,
        );

        entry.arrow.setTransform(origin, direction);
        entry.arrow.setColor(color);
        entry.enabled = enabled ?? true;
        this._applyVisibility(entry);
    }

    // =====================================================
    //  内部辅助
    // =====================================================

    /**
     * 2D 采样：对 x 范围进行均匀采样,跳过奇异点
     */
    private _sampleCurve(
        curve: CurveExpr,
        compiled: math.EvalFunction,
        xRange: [number, number],
        steps: number,
    ): THREE.Vector3[] {
        const points: THREE.Vector3[] = [];
        const step = (xRange[1] - xRange[0]) / steps;
        const scope: Record<string, number> = {};
        for (const c of curve.coefficients) scope[c.name] = c.value;

        for (let x = xRange[0]; x <= xRange[1]; x += step) {
            try {
                scope.x = x;
                const y = compiled.evaluate(scope);
                if (isFinite(y)) {
                    points.push(new THREE.Vector3(x, y, 0));
                }
            } catch (_) {
                /* 跳过无效点 */
            }
        }
        return points;
    }

    /**
     * 根据 currentMode 和 enabled 设置 Group 可见性
     * - 2D 模式下只显示 2D 曲线
     * - 3D 模式下只显示 3D 曲面
     * - 用户主动 toggle 的 disabled 状态始终生效
     */
    private _applyVisibility(entry: PlotEntry): void {
        // point / vector 始终可见,不受 2D/3D 模式切换影响
        if (entry.objectKind === 'point' || entry.objectKind === 'vector') {
            entry.group.visible = entry.enabled;
            return;
        }

        const modeMatch =
            (this.currentMode === '2d' && entry.objectKind === 'curve') ||
            (this.currentMode === '3d' && entry.objectKind === 'surface');
        entry.group.visible = modeMatch && entry.enabled;
    }
}