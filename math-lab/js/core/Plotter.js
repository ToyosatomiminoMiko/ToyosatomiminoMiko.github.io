import * as THREE from 'three';
import { SurfaceMesh } from './SurfaceMesh.js';

/**
 * 增量式绘图器 —— 每个表达式拥有独立的 THREE.Group
 * 
 * 设计原则：
 * - add/remove 仅操作目标 Group
 * - toggle 仅设置 Group.visible
 * - 模式切换仅遍历更新 visible
 * - 绝不执行 clearAll 式清空
 * 
 * PlotEntry 结构：
 * {
 *   type: '2d' | '3d',
 *   group: THREE.Group,          // 本表达式独占容器
 *   object: THREE.Line | null,   // 2D 曲线对象
 *   surface: SurfaceMesh | null, // 3D 曲面对象
 *   enabled: boolean,            // 用户可见性开关
 * }
 */
export class Plotter {
    /**
     * @param {THREE.Scene} scene
     */
    constructor(scene) {
        this.scene = scene;
        this.plotMap = new Map(); // id -> PlotEntry

        // 当前渲染模式,由 updateMode() 设置
        this.currentMode = '2d';

        // 顶层容器：所有表达式 Group 都挂在这里,便于统一管理
        this.plotContainer = new THREE.Group();
        this.scene.add(this.plotContainer);
    }

    // =====================================================
    //  公开 API
    // =====================================================

    /**
     * 绘制 2D 曲线(若 Group 不存在则创建,若已存在则更新几何体)
     * @param {object} expr   - { id, fn, color, enabled }
     * @param {number[]} [xRange=[-8,8]]
     * @param {number} [steps=320]
     */
    draw2D(expr, xRange = [-8, 8], steps = 320) {
        const { id, color, enabled } = expr;
        const compiled = expr.node.compile();               // 编译一次
        let entry = this.plotMap.get(id);

        if (!entry) {
            const group = new THREE.Group();
            this.plotContainer.add(group);
            entry = {
                type: '2d',
                group,
                object: null,
                surface: null,
                enabled: enabled ?? true,
            };
            this.plotMap.set(id, entry);
        }

        if (entry.object) {
            entry.group.remove(entry.object);
            entry.object.geometry?.dispose();
            entry.object.material?.dispose();
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
     * 绘制 / 更新 3D 曲面(复用 SurfaceMesh,仅在分段数改变时重建)
     * @param {object} expr       - { id, fn, enabled }
     * @param {number[]} [range=[-6,6]]
     * @param {number} [segments=64]
     */
    draw3D(expr, range = [-6, 6], segments = 64) {
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

        // SurfaceMesh.update 原本接受 fn，现在需要传 compiled 和 coefficients
        entry.surface.update(compiled, expr.coefficients, range[0], range[1], range[0], range[1]);
        entry.enabled = enabled ?? true;

        this._applyVisibility(entry);
    }

    /**
     * 移除表达式(销毁 Group 及所有子对象,释放 GPU 资源)
     * @param {string} id
     */
    remove(id) {
        const entry = this.plotMap.get(id);
        if (!entry) return;

        if (entry.type === '2d' && entry.object) {
            entry.object.geometry?.dispose();
            entry.object.material?.dispose();
        } else if (entry.type === '3d' && entry.surface) {
            entry.surface.dispose();
        }

        this.plotContainer.remove(entry.group);
        this.plotMap.delete(id);
    }

    /**
     * 设置表达式可见性(toggle 专用)
     * @param {string} id
     * @param {boolean} visible
     */
    setVisible(id, visible) {
        const entry = this.plotMap.get(id);
        if (!entry) return;
        entry.enabled = visible;
        this._applyVisibility(entry);
    }

    /**
     * 更新表达式数据(表达式字符串改变时调用,会重建几何体)
     * @param {object} expr - 完整的表达式对象
     * @param {string} mode - 当前模式 '2d' | '3d'
     */
    updateExpr(expr, mode) {
        if (mode === '2d' && expr.type === '2d') {
            this.draw2D(expr);
        } else if (mode === '3d' && expr.type === '3d') {
            this.draw3D(expr);
        }
    }

    /**
     * 模式切换：仅更新所有 Group 的可见性,不销毁任何几何体
     * @param {string} mode - '2d' | '3d'
     */
    updateMode(mode) {
        this.currentMode = mode;
        for (const [, entry] of this.plotMap) {
            this._applyVisibility(entry);
        }
    }

    /**
     * 销毁整个绘图器(仅在应用卸载时使用)
     */
    dispose() {
        for (const [id] of this.plotMap) {
            this.remove(id);
        }
        this.scene.remove(this.plotContainer);
    }

    // =====================================================
    //  内部辅助
    // =====================================================

    /**
     * 2D 采样：对 x 范围进行均匀采样,跳过奇异点
     */
    _sample2D(expr, compiled, xRange, steps) {
        const points = [];
        const step = (xRange[1] - xRange[0]) / steps;
        const scope = {};
        for (const c of expr.coefficients) scope[c.name] = c.value;

        for (let x = xRange[0]; x <= xRange[1]; x += step) {
            try {
                scope.x = x;
                const y = compiled.evaluate(scope);
                if (isFinite(y)) {
                    points.push(new THREE.Vector3(x, y, 0));
                }
            } catch (_) { /* 跳过无效点 */ }
        }
        return points;
    }

    /**
     * 根据 currentMode 和 enabled 设置 Group 可见性
     * - 2D 模式下只显示 2D 曲线
     * - 3D 模式下只显示 3D 曲面
     * - 用户主动 toggle 的 disabled 状态始终生效
     */
    _applyVisibility(entry) {
        const modeMatch =
            (this.currentMode === '2d' && entry.type === '2d') ||
            (this.currentMode === '3d' && entry.type === '3d');
        entry.group.visible = modeMatch && entry.enabled;
    }
}