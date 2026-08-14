import { describe, expect, it } from 'vitest';
import * as math from 'mathjs';
import { DerivativeService } from './DerivativeService';

describe('DerivativeService', () => {
    it('计算并缓存一元函数导数', () => {
        const service = new DerivativeService();
        const node = math.parse('x ^ 2');

        const first = service.deriveCurveNode({
            kind: 'curve' as const,
            id: 1,
            node,
            coefficients: [],
            color: '#ffffff',
            enabled: true,
        });
        const second = service.deriveCurveNode({
            kind: 'curve' as const,
            id: 1,
            node,
            coefficients: [],
            color: '#ffffff',
            enabled: true,
        });

        expect(first.toString()).toBe('2 * x');
        expect(first).toBe(second);
    });

    it('计算二元函数对 x 和 y 的偏导数', () => {
        const service = new DerivativeService();
        const node = math.parse('x ^ 2 + x * y');
        const source = {
            kind: 'surface' as const,
            id: 2,
            node,
            coefficients: [],
            color: '#ffffff',
            enabled: true,
        };

        expect(service.deriveSurfaceNode(source, 'x').toString()).toContain('2 * x');
        expect(service.deriveSurfaceNode(source, 'y').toString()).toBe('x');
    });
});
