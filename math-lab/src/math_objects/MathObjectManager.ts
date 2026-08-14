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
import { movePoint } from './Point';
import { transformVector } from './Vector';
import { parseVectorField } from './VectorField';
import { extractCoefficients } from './coefficientUtils';
import { ColorManager } from './ColorManager';
import { DerivativeService } from './DerivativeService';
import { MathObjectFactory } from './MathObjectFactory';
import { MathObjectRepository } from './MathObjectRepository';
import { APP_CONFIG } from '../config/appConfig';

export class MathObjectManager {
    private _repository: MathObjectRepository;
    private _nextId: number;
    private _colorManager: ColorManager;
    private _derivativeService: DerivativeService;
    private _objectFactory: MathObjectFactory;
    constructor(colorManager: ColorManager) {
        this._repository = new MathObjectRepository();
        this._nextId = 1;
        this._colorManager = colorManager;
        this._derivativeService = new DerivativeService();
        this._objectFactory = new MathObjectFactory(colorManager);
        this._addDefaults();
    }

    // ========== 查询 ==========

    getById(id: number): MathObject | undefined {
        return this._repository.getById(id);
    }

    getAll(): MathObject[] {
        return this._repository.getAll();
    }

    getByKind(kind: 'curve'): CurveExpr[];
    getByKind(kind: 'surface'): SurfaceExpr[];
    getByKind(kind: 'point'): PointEntity[];
    getByKind(kind: 'vector'): VectorEntity[];
    getByKind(kind: MathObject['kind']): MathObject[] {
        return this._repository.getByKind(kind);
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
        this._repository.add(expr);
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
        this._repository.add(expr);
        return expr;
    }

    addPoint(x: number, y: number, z: number, color?: string): PointEntity {
        const entity = this._objectFactory.createPoint(
            this._nextId++, x, y, z,
            color,
        );
        this._repository.add(entity);
        return entity;
    }

    addVector(
        dx: number, dy: number, dz: number,
        ox: number, oy: number, oz: number,
        color?: string,
    ): VectorEntity {
        const entity = this._objectFactory.createVector(
            this._nextId++, dx, dy, dz, ox, oy, oz,
            color,
        );
        this._repository.add(entity);
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
        this._repository.add(expr);
        return expr;
    }
    // ========== 删除 / 可见性 ==========

    remove(id: number): boolean {
        const obj = this._repository.remove(id);
        if (!obj) return false;
        if (obj.kind === 'curve' || obj.kind === 'surface') {
            this._derivativeService.clearFor(obj.node);
        }
        return true;
    }

    toggle(id: number): boolean {
        const obj = this._repository.getById(id);
        if (obj) {
            obj.enabled = !obj.enabled;
            return obj.enabled;
        }
        return false;
    }

    // ========== 更新 ==========

    updateFn(id: number, newRaw: string): boolean {
        const obj = this._repository.getById(id);
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
        const obj = this._repository.getById(id);
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
        const obj = this._repository.getById(id);
        if (!obj) return false;
        obj.color = color;
        return true;
    }

    updatePointPosition(id: number, x: number, y: number, z: number): boolean {
        const obj = this._repository.getById(id);
        if (!obj || obj.kind !== 'point') return false;
        Object.assign(obj, movePoint(obj, x, y, z));
        return true;
    }

    updateVectorTransform(
        id: number,
        dx: number, dy: number, dz: number,
        ox: number, oy: number, oz: number,
    ): boolean {
        const obj = this._repository.getById(id);
        if (!obj || obj.kind !== 'vector') return false;
        Object.assign(obj, transformVector(obj, dx, dy, dz, ox, oy, oz));
        return true;
    }

    // ========== 求导 ==========

    deriveCurve(id: number): CurveExpr {
        const source = this._findSource(id, 'curve');
        const derivNode = this._derivativeService.deriveCurveNode(source);

        const deriv: CurveExpr = {
            kind: 'curve',
            id: this._nextId++,
            node: derivNode,
            coefficients: extractCoefficients(derivNode, new Set(['x'])),
            color: this._colorManager.next(),
            enabled: true,
        };
        this._repository.add(deriv);
        return deriv;
    }

    deriveSurface(id: number, variable: 'x' | 'y'): SurfaceExpr {
        const source = this._findSource(id, 'surface');
        const derivNode = this._derivativeService.deriveSurfaceNode(source, variable);
        const deriv: SurfaceExpr = {
            kind: 'surface',
            id: this._nextId++,
            node: derivNode,
            coefficients: extractCoefficients(derivNode, new Set(['x', 'y'])),
            color: this._colorManager.next(),
            enabled: true,
        };
        this._repository.add(deriv);
        return deriv;
    }

    // ========== 内部 ==========

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
        const obj = this._repository.getById(id);
        if (!obj) throw new Error('源对象不存在');
        if (obj.kind !== expectedKind) {
            throw new Error(`对象不是 ${expectedKind} 类型`);
        }
        return obj as Extract<MathObject, { kind: T }>;
    }
}
