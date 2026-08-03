import * as THREE from 'three';
import { SurfaceMesh } from './SurfaceMesh';
import type { Expression, Coefficient } from '../types';
import * as math from 'mathjs'
import { ArrowMesh } from '../vector-field/ArrowMesh';

// ============================================================
// 内部类型:绘图条目
// ============================================================
interface PlotEntry {
    type: '2d' | '3d' | 'point' | 'vector';
    group: THREE.Group;
    object: THREE.Line | null;
    surface: SurfaceMesh | null;
    mesh: THREE.Mesh | null;      // 点的小球
    arrow: ArrowMesh | null;      // 向量箭头
    enabled: boolean;
}

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
    /** id → PlotEntry 映射表 */
    plotMap: Map<number, PlotEntry>;
    /** 当前渲染模式 */
    currentMode: '2d' | '3d';
    /** 顶层容器:所有表达式 Group 都挂在这里 */
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
     * 绘制 2D 曲线（若 Group 不存在则创建,若已存在则更新几何体）
     */
    draw2D(
        expr: Expression,
        xRange: [number, number] = [-8, 8],
        steps: number = 320,
    ): void {
        const { id, color, enabled } = expr;
        const compiled = expr.node.compile();
        let entry = this.plotMap.get(id);

        if (!entry) {
            const group = new THREE.Group();
            this.plotContainer.add(group);
            entry = {
                type: '2d',
                group,
                object: null,
                surface: null,
                mesh: null,
                arrow: null,
                enabled: enabled ?? true,
            };
            this.plotMap.set(id, entry);
        }

        if (entry.object) {
            entry.group.remove(entry.object);
            entry.object.geometry?.dispose();
            const mat = entry.object.material;
            if (Array.isArray(mat)) {
                mat.forEach(m => m.dispose());
            } else {
                mat?.dispose();
            }
            entry.object = null;
        }

        const points = this._sample2D(expr, compiled, xRange, steps);
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
        entry.object = line;
        entry.enabled = enabled ?? true;

        this._applyVisibility(entry);
    }

    /**
     * 绘制 / 更新 3D 曲面（复用 SurfaceMesh,仅在分段数改变时重建）
     */
    draw3D(
        expr: Expression,
        range: [number, number] = [-6, 6],
        segments: number = 64,
    ): void {
        const { id, enabled } = expr;
        const compiled = expr.node.compile();
        let entry = this.plotMap.get(id);

        if (!entry) {
            const group = new THREE.Group();
            this.plotContainer.add(group);
            entry = {
                type: '3d',
                group,
                object: null,
                surface: null,
                mesh: null,
                arrow: null,
                enabled: enabled ?? true,
            };
            this.plotMap.set(id, entry);
        }

        if (entry.surface) {
            if (entry.surface.cols !== segments || entry.surface.rows !== segments) {
                entry.group.remove(entry.surface.group);
                entry.surface.dispose();
                entry.surface = null;
            }
        }

        if (!entry.surface) {
            const surface = new SurfaceMesh(segments, segments);
            entry.group.add(surface.group);
            entry.surface = surface;
        }

        entry.surface.update(
            compiled,
            expr.coefficients,
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

        if (entry.type === '2d' && entry.object) {
            entry.object.geometry?.dispose();
            const mat = entry.object.material;
            if (Array.isArray(mat)) {
                mat.forEach(m => m.dispose());
            } else {
                mat?.dispose();
            }
        }
        // 释放点的小球
        if (entry.mesh) {
            entry.mesh.geometry?.dispose();
            const mat = entry.mesh.material;
            if (Array.isArray(mat)) {
                mat.forEach(m => m.dispose());
            } else {
                mat?.dispose();
            }
        }
        // 释放向量箭头
        if (entry.arrow) {
            entry.arrow.dispose();
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
     * 更新表达式数据（表达式字符串改变时调用,会重建几何体）
     */
    updateExpr(expr: Expression, mode: '2d' | '3d'): void {
        if (mode === '2d' && expr.type === '2d') {
            this.draw2D(expr);
        } else if (mode === '3d' && expr.type === '3d') {
            this.draw3D(expr);
        }
    }

    /**
     * 模式切换:仅更新所有 Group 的可见性,不销毁任何几何体
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
    drawPoint(expr: Expression): void {
        const { id, color, enabled } = expr;
        let entry = this.plotMap.get(id);

        if (!entry) {
            const group = new THREE.Group();
            this.plotContainer.add(group);

            const geo = new THREE.SphereGeometry(0.2, 16, 16);
            const mat = new THREE.MeshPhongMaterial({
                color: color || '#ffffff',
                emissive: 0x000000,
                specular: 0x333333,
                shininess: 40,
            });
            const mesh = new THREE.Mesh(geo, mat);
            group.add(mesh);

            entry = {
                type: 'point',
                group,
                object: null,
                surface: null,
                mesh,
                arrow: null,
                enabled: enabled ?? true,
            };
            this.plotMap.set(id, entry);
        }

        // 从系数读取位置
        const x = expr.coefficients.find(c => c.name === 'x')?.value ?? 0;
        const y = expr.coefficients.find(c => c.name === 'y')?.value ?? 0;
        const z = expr.coefficients.find(c => c.name === 'z')?.value ?? 0;
        entry.mesh!.position.set(x, y, z);

        // 颜色可能变化
        const mat = entry.mesh!.material as THREE.MeshPhongMaterial;
        mat.color.set(color);

        entry.enabled = enabled ?? true;
        this._applyVisibility(entry);
    }

    /**
     * 绘制 / 更新一个向量箭头
     */
    drawVector(expr: Expression): void {
        const { id, color, enabled } = expr;
        let entry = this.plotMap.get(id);

        if (!entry) {
            const arrow = new ArrowMesh(color);
            entry = {
                type: 'vector',
                group: arrow.group,
                object: null,
                surface: null,
                mesh: null,
                arrow,
                enabled: enabled ?? true,
            };
            this.plotContainer.add(arrow.group);
            this.plotMap.set(id, entry);
        }

        // 从系数读取方向和起点
        const getC = (n: string): number =>
            expr.coefficients.find(c => c.name === n)?.value ?? 0;
        const origin = new THREE.Vector3(getC('ox'), getC('oy'), getC('oz'));
        const direction = new THREE.Vector3(getC('dx'), getC('dy'), getC('dz'));

        entry.arrow!.setTransform(origin, direction);
        entry.arrow!.setColor(color);
        entry.enabled = enabled ?? true;
        this._applyVisibility(entry);
    }

    // =====================================================
    //  内部辅助
    // =====================================================

    /**
     * 2D 采样:对 x 范围进行均匀采样,跳过奇异点
     */
    private _sample2D(
        expr: Expression,
        compiled: math.EvalFunction,
        xRange: [number, number],
        steps: number,
    ): THREE.Vector3[] {
        const points: THREE.Vector3[] = [];
        const step = (xRange[1] - xRange[0]) / steps;
        const scope: Record<string, number> = {};
        for (const c of expr.coefficients) scope[c.name] = c.value;

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
        // point / vector 始终可见 不受 2D/3D 模式切换影响
        if (entry.type === 'point' || entry.type === 'vector') {
            entry.group.visible = entry.enabled;
            return;
        }
        const modeMatch =
            (this.currentMode === '2d' && entry.type === '2d') ||
            (this.currentMode === '3d' && entry.type === '3d');
        entry.group.visible = modeMatch && entry.enabled;
    }
}