import { parse } from 'mathjs';
import { describe, expect, it, vi } from 'vitest';
import { sampleVectorField } from './VectorField';

vi.mock('../../wasm/math_rs/math_rs', () => ({
    default: vi.fn(() => Promise.resolve()),
    sample_vector_field: vi.fn(() => {
        throw new Error('force fallback');
    }),
}));

describe('sampleVectorField fallback', () => {
    it('handles a single-point grid without producing NaN', () => {
        const vectors = sampleVectorField(
            { P: parse('1'), Q: parse('2'), R: parse('3') },
            [],
            { x: [-1, 1], y: [-1, 1], z: [-1, 1] },
            [1, 1, 1],
        );

        expect(vectors).toHaveLength(3);
        expect(vectors[0]).toBe(1);
        expect(vectors[1]).toBe(2);
        expect(vectors[2]).toBe(3);
    });
});
