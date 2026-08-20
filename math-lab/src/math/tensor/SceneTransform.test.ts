import { describe, expect, it } from 'vitest';
import {
    apply,
    compose,
    createMatrixOps,
    identity4,
    multiply4x4,
    rotate4,
    scale4,
    translate4,
} from './SceneTransform';

describe('SceneTransform', () => {
    it('keeps translation in the fourth column of a row-major matrix', () => {
        expect(translate4([2, 3, 4])).toEqual([
            [1, 0, 0, 2],
            [0, 1, 0, 3],
            [0, 0, 1, 4],
            [0, 0, 0, 1],
        ]);
    });

    it('applies a translation to a point as a homogeneous vector', () => {
        const transform = { kind: 'transform' as const, matrix: translate4([1, -2, 3]) };
        const point = { kind: 'vector' as const, values: [4, 5, 6] };

        expect(apply(transform, point).values).toEqual([5, 3, 9]);
    });

    it('composes transforms with the documented a * b order', () => {
        const translate = { kind: 'transform' as const, matrix: translate4([1, 0, 0]) };
        const scale = { kind: 'transform' as const, matrix: scale4([2, 2, 2]) };
        const combined = compose(scale, translate);

        expect(apply(combined, { kind: 'vector' as const, values: [1, 1, 1] }).values)
            .toEqual([4, 2, 2]);
    });

    it('multiplies 4x4 matrices in row-major order', () => {
        expect(multiply4x4(identity4(), translate4([1, 2, 3]))).toEqual(translate4([1, 2, 3]));
    });

    it('returns a 4x4 rotation matrix', () => {
        const matrix = rotate4([0, 0, Math.PI / 2]);
        expect(matrix).toHaveLength(4);
        expect(matrix.every((row) => row.length === 4)).toBe(true);
        expect(matrix[3]).toEqual([0, 0, 0, 1]);
    });

    it('creates explicit matrix ops without module-level mutable state', () => {
        const backend = {
            identity: () => identity4(),
            translate: () => translate4([9, 8, 7]),
            scale: () => scale4([2, 2, 2]),
            rotate: () => rotate4([0, 0, 0]),
            multiply: (a: number[][], b: number[][]) => multiply4x4(a, b),
            apply: (_matrix: number[][], point: number[]) => [point[0] + 1, point[1], point[2]],
        };

        const ops = createMatrixOps(backend);

        expect(ops.translate([0, 0, 0])).toEqual(translate4([9, 8, 7]));
        expect(ops.apply(identity4(), [1, 2, 3])).toEqual([2, 2, 3]);
    });
});
