import { describe, expect, it } from 'vitest';
import type { PointEntity, VectorEntity } from './types';
import { MathObjectRepository } from './MathObjectRepository';

describe('MathObjectRepository', () => {
    it('支持按 id 添加\查询和删除', () => {
        const repo = new MathObjectRepository();
        const point: PointEntity = {
            kind: 'point',
            id: 1,
            x: 0,
            y: 0,
            z: 0,
            color: '#ffffff',
            enabled: true,
        };

        repo.add(point);

        expect(repo.getById(1)).toBe(point);
        expect(repo.remove(1)).toBe(point);
        expect(repo.getById(1)).toBeUndefined();
    });

    it('按类型过滤对象', () => {
        const repo = new MathObjectRepository();
        const point: PointEntity = {
            kind: 'point',
            id: 1,
            x: 0,
            y: 0,
            z: 0,
            color: '#ffffff',
            enabled: true,
        };
        const vector: VectorEntity = {
            kind: 'vector',
            id: 2,
            origin: { x: 0, y: 0, z: 0 },
            direction: { x: 1, y: 0, z: 0 },
            color: '#ffffff',
            enabled: true,
        };

        repo.add(point);
        repo.add(vector);

        expect(repo.getByKind('point')).toEqual([point]);
        expect(repo.getByKind('vector')).toEqual([vector]);
    });
});
