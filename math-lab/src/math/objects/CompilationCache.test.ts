import { describe, expect, it } from 'vitest';
import * as math from 'mathjs';
import { CompilationCache } from './CompilationCache';

describe('CompilationCache', () => {
    it('按 MathNode 复用同一个编译函数', () => {
        const cache = new CompilationCache();
        const node = math.parse('x + 1');

        expect(cache.getByNode(node)).toBe(cache.getByNode(node));
    });

    it('字符串缓存按表达式和系数键区分', () => {
        const cache = new CompilationCache();
        const build = () => math.parse('x + a').compile();

        const first = cache.getByExpr('x + a', 'a=1', build);
        const second = cache.getByExpr('x + a', 'a=1', build);
        const different = cache.getByExpr('x + a', 'a=2', build);

        expect(first).toBe(second);
        expect(first).not.toBe(different);
    });
});
