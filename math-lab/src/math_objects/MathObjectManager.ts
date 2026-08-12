import type {
    MathObject,
    CurveExpr,
    SurfaceExpr,
    PointEntity,
    VectorEntity,
    VectorFieldExpr,
} from './types';
import { parseCurve } from './Curve';
import { parseSurface } from './Surface';
import { createPoint, movePoint } from './Point';
import { createVector, transformVector } from './Vector';
import { differentiateCurve } from './Curve';
import { differentiateSurface } from './Surface';
import { parseVectorField } from './VectorField';
import { extractCoefficients } from './coefficientUtils';
import { ColorManager } from './ColorManager';
import { APP_CONFIG } from '../config/appConfig';
import * as math from 'mathjs';

// 系数提取时的变量名集合
const CURVE_VARS = new Set(['x']);
const SURFACE_VARS = new Set(['x', 'y']);

export class MathObjectManager {
    private _objects: MathObject[];
    private _nextId: number;
    private _colorManager: ColorManager;
    // 导数结果缓存
    private _derivCache = new WeakMap<math.MathNode, Map<string, math.MathNode>>();
    constructor(colorManager: ColorManager) {
        this._objects = [];
        this._nextId = 1;
        this._colorManager = colorManager;
        this._addDefaults();
    }

    // ========== 查询 ==========

    getById(id: number): MathObject | undefined {
        return this._objects.find(o => o.id === id);
    }

    getAll(): MathObject[] {
        return this._objects;
    }

    getByKind(kind: 'curve'): CurveExpr[];
    getByKind(kind: 'surface'): SurfaceExpr[];
    getByKind(kind: 'point'): PointEntity[];
    getByKind(kind: 'vector'): VectorEntity[];
    getByKind(kind: MathObject['kind']): MathObject[] {
        return this._objects.filter(o => o.kind === kind);
    }

    // ========== 添加 ==========

    addCurve(raw: string, color?: string): CurveExpr {
        const { node, coefficients } = parseCurve(raw);
        const expr: CurveExpr = {
            kind: 'curve',
            id: this._nextId++,
            node,
            coefficients,
            color: color || this._colorManager.next(),
            enabled: true,
        };
        this._objects.push(expr);
        return expr;
    }

    addSurface(raw: string, color?: string): SurfaceExpr {
        const { node, coefficients } = parseSurface(raw);
        const expr: SurfaceExpr = {
            kind: 'surface',
            id: this._nextId++,
            node,
            coefficients,
            color: color || this._colorManager.next(),
            enabled: true,
        };
        this._objects.push(expr);
        return expr;
    }

    addPoint(x: number, y: number, z: number, color?: string): PointEntity {
        const entity = createPoint(
            this._nextId++, x, y, z,
            color || this._colorManager.next(),
        );
        this._objects.push(entity);
        return entity;
    }

    addVector(
        dx: number, dy: number, dz: number,
        ox: number, oy: number, oz: number,
        color?: string,
    ): VectorEntity {
        const entity = createVector(
            this._nextId++, dx, dy, dz, ox, oy, oz,
            color || this._colorManager.next(),
        );
        this._objects.push(entity);
        return entity;
    }

    addVectorField(
        components: [string, string, string],
        gridSize: [number, number, number] = [8, 8, 8],
        range?: { x: [number, number]; y: [number, number]; z: [number, number] },
        color?: string,
    ): VectorFieldExpr {
        const { nodeP, nodeQ, nodeR, coefficients } = parseVectorField(components);

        const expr: VectorFieldExpr = {
            kind: 'vector_field',
            id: this._nextId++,
            components,
            nodeP,
            nodeQ,
            nodeR,
            coefficients,
            color: color || this._colorManager.next(),
            enabled: true,
            gridSize,
            glyphScale: 1.0,
            range: range ?? { x: [-4, 4], y: [-4, 4], z: [-4, 4] },
        };
        this._objects.push(expr);
        return expr;
    }
    // ========== 删除 / 可见性 ==========

    remove(id: number): boolean {
        const idx = this._objects.findIndex(o => o.id === id);
        if (idx !== -1) {
            const obj = this._objects[idx];
            if (obj.kind === 'curve' || obj.kind === 'surface') {
                this._clearDerivCacheFor(obj.node);
            }
            this._objects.splice(idx, 1);
            return true;
        }
        return false;
    }

    toggle(id: number): boolean {
        const obj = this._objects.find(o => o.id === id);
        if (obj) {
            obj.enabled = !obj.enabled;
            return obj.enabled;
        }
        return false;
    }

    // ========== 更新 ==========

    updateFn(id: number, newRaw: string): boolean {
        const obj = this._objects.find(o => o.id === id);
        if (!obj || (obj.kind !== 'curve' && obj.kind !== 'surface')) return false;

        try {
            if (obj.kind === 'curve') {
                const { node, coefficients } = parseCurve(newRaw);
                obj.node = node;
                obj.coefficients = coefficients;
            } else {
                const { node, coefficients } = parseSurface(newRaw);
                obj.node = node;
                obj.coefficients = coefficients;
            }
            return true;
        } catch (e) {
            throw new Error(`表达式编辑失败: ${(e as Error).message}`);
        }
    }

    setCoefficient(id: number, name: string, value: number): boolean {
        const obj = this._objects.find(o => o.id === id);
        if (!obj || !('coefficients' in obj)) return false;
        const withCoeff = obj as unknown as { coefficients: { name: string; value: number }[] };
        const coeff = withCoeff.coefficients.find(c => c.name === name);
        if (coeff) {
            coeff.value = value;
            return true;
        }
        return false;
    }

    updateColor(id: number, color: string): boolean {
        const obj = this._objects.find(o => o.id === id);
        if (!obj) return false;
        obj.color = color;
        return true;
    }

    updatePointPosition(id: number, x: number, y: number, z: number): boolean {
        const obj = this._objects.find(o => o.id === id);
        if (!obj || obj.kind !== 'point') return false;
        Object.assign(obj, movePoint(obj, x, y, z));
        return true;
    }

    updateVectorTransform(
        id: number,
        dx: number, dy: number, dz: number,
        ox: number, oy: number, oz: number,
    ): boolean {
        const obj = this._objects.find(o => o.id === id);
        if (!obj || obj.kind !== 'vector') return false;
        Object.assign(obj, transformVector(obj, dx, dy, dz, ox, oy, oz));
        return true;
    }

    // ========== 求导 ==========

    deriveCurve(id: number): CurveExpr {
        const source = this._findSource(id, 'curve');
        let inner = this._derivCache.get(source.node);
        let derivNode = inner?.get('x');
        if (!derivNode) {
            derivNode = math.simplify(differentiateCurve(source.node));
            if (!inner) {
                inner = new Map();
                this._derivCache.set(source.node, inner);
            }
            inner.set('x', derivNode);
        }

        const deriv: CurveExpr = {
            kind: 'curve',
            id: this._nextId++,
            node: derivNode,
            coefficients: extractCoefficients(derivNode, CURVE_VARS),
            color: this._colorManager.next(),
            enabled: true,
        };
        this._objects.push(deriv);
        return deriv;
    }

    deriveSurface(id: number, variable: 'x' | 'y'): SurfaceExpr {
        const source = this._findSource(id, 'surface');
        let inner = this._derivCache.get(source.node);
        let derivNode = inner?.get(variable);
        if (!derivNode) {
            derivNode = math.simplify(differentiateSurface(source.node, variable));
            if (!inner) {
                inner = new Map();
                this._derivCache.set(source.node, inner);
            }
            inner.set(variable, derivNode);
        }
        const deriv: SurfaceExpr = {
            kind: 'surface',
            id: this._nextId++,
            node: derivNode,
            coefficients: extractCoefficients(derivNode, SURFACE_VARS),
            color: this._colorManager.next(),
            enabled: true,
        };
        this._objects.push(deriv);
        return deriv;
    }

    // ========== 内部 ==========

    private _clearDerivCacheFor(node: math.MathNode): void {
        this._derivCache.delete(node);
    }

    private _addDefaults(): void {
        const defaults = APP_CONFIG.defaultExpressions;
        defaults['2d'].forEach(item => {
            this.addCurve(item.fn, item.color);
        });
        defaults['3d'].forEach(item => {
            this.addSurface(item.fn, item.color);
        });
    }

    private _findSource<T extends MathObject['kind']>(
        id: number,
        expectedKind: T,
    ): Extract<MathObject, { kind: T }> {
        const obj = this._objects.find(o => o.id === id);
        if (!obj) throw new Error('源对象不存在');
        if (obj.kind !== expectedKind) {
            throw new Error(`对象不是 ${expectedKind} 类型`);
        }
        return obj as Extract<MathObject, { kind: T }>;
    }
}