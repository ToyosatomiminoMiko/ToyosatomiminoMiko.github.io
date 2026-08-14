import * as math from 'mathjs';
import type { CurveExpr, SurfaceExpr } from './types';
import { differentiateCurve } from './Curve';
import { differentiateSurface } from './Surface';

/**
 * 求导逻辑与导数节点缓存.
 * 从 MathObjectManager 中剥离,使管理器只负责对象生命周期与查询.
 */
export class DerivativeService {
    private readonly _cache = new WeakMap<
        math.MathNode,
        Map<string, math.MathNode>
    >();

    deriveCurveNode(source: CurveExpr): math.MathNode {
        return this._getOrCreate(source.node, 'x', () =>
            math.simplify(differentiateCurve(source.node)),
        );
    }

    deriveSurfaceNode(source: SurfaceExpr, variable: 'x' | 'y'): math.MathNode {
        return this._getOrCreate(source.node, variable, () =>
            math.simplify(differentiateSurface(source.node, variable)),
        );
    }

    clearFor(node: math.MathNode): void {
        this._cache.delete(node);
    }

    private _getOrCreate(
        node: math.MathNode,
        variable: string,
        create: () => math.MathNode,
    ): math.MathNode {
        let inner = this._cache.get(node);
        let derivNode = inner?.get(variable);
        if (!derivNode) {
            derivNode = create();
            if (!inner) {
                inner = new Map();
                this._cache.set(node, inner);
            }
            inner.set(variable, derivNode);
        }
        return derivNode;
    }
}
