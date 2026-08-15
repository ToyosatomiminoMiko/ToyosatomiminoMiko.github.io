import type { MathNode, EvalFunction } from 'mathjs';

/**
 * 统一的表达式编译缓存.
 * 原先 CurveRenderer / GradientCore / IntegralWorker 各自维护缓存,
 * 这里收口为同一个策略:
 * - MathNode 使用 WeakMap,避免阻止 GC
 * - 字符串表达式使用带上限的 Map,避免长期运行无限增长
 */
export class CompilationCache {
    private readonly _nodeCache = new WeakMap<MathNode, EvalFunction>();
    private readonly _exprCache = new Map<string, EvalFunction>();
    private readonly _maxExprEntries = 64;

    getByNode(node: MathNode): EvalFunction {
        let compiled = this._nodeCache.get(node);
        if (!compiled) {
            compiled = node.compile();
            this._nodeCache.set(node, compiled);
        }
        return compiled;
    }

    getByExpr(
        expr: string,
        coeffsKey: string,
        compiler: () => EvalFunction,
    ): EvalFunction {
        const key = `${expr}\n${coeffsKey}`;
        let compiled = this._exprCache.get(key);
        if (!compiled) {
            compiled = compiler();
            this._exprCache.delete(key);
            this._exprCache.set(key, compiled);
            if (this._exprCache.size > this._maxExprEntries) {
                const oldestKey = this._exprCache.keys().next().value;
                if (oldestKey !== undefined) this._exprCache.delete(oldestKey);
            }
        }
        return compiled;
    }
}

export const compilationCache = new CompilationCache();
