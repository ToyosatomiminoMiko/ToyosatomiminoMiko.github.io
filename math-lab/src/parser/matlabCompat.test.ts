import { describe, expect, it } from 'vitest';
import {
    normalizeElementwise,
    normalizeMatlabCalls,
    normalizeMatlabMatrixLiterals,
    normalizeMatlabSyntax,
    removeSyms,
} from './matlabCompat';

describe('normalizeMatlabMatrixLiterals', () => {
    it('converts space-separated vectors', () => {
        expect(normalizeMatlabMatrixLiterals('[1 2 3]')).toBe('[1, 2, 3]');
    });

    it('converts semicolon-separated matrices into nested rows', () => {
        expect(normalizeMatlabMatrixLiterals('[1 0 0; 0 1 0; 0 0 1]')).toBe(
            '[[1, 0, 0], [0, 1, 0], [0, 0, 1]]',
        );
    });

    it('keeps already normalized literals', () => {
        expect(normalizeMatlabMatrixLiterals('[[1, 0], [0, 1]]')).toBe('[[1, 0], [0, 1]]');
    });
});

describe('normalizeElementwise', () => {
    it('strips element-wise dots', () => {
        expect(normalizeElementwise('sin(x) .* cos(y) .^ 2')).toBe('sin(x) * cos(y) ^ 2');
    });
});

describe('removeSyms', () => {
    it('removes syms declarations', () => {
        expect(removeSyms('syms x y z;\na = 2;')).toBe('\na = 2;');
    });
});

describe('normalizeMatlabCalls', () => {
    it('maps surf / plot / quiver3 to object statements', () => {
        const source = [
            'surf(x, y, f);',
            'plot(x, y);',
            'quiver3(x, y, z, u, v, w);',
        ].join('\n');

        expect(normalizeMatlabCalls(source)).toContain('surface _matlab_surf_1 = f;');
        expect(normalizeMatlabCalls(source)).toContain('curve _matlab_plot_1 = y;');
        expect(normalizeMatlabCalls(source)).toContain(
            'vector_field _matlab_quiver3_1 = [u, v, w];',
        );
    });

    it('maps divergence / curl to analysis statements', () => {
        const source = [
            'd = divergence(F, [x, y, z]);',
            'c = curl(F, [x, y, z]);',
        ].join('\n');

        expect(normalizeMatlabCalls(source)).toContain('divergence d = div(F);');
        expect(normalizeMatlabCalls(source)).toContain('curl c = curl(F);');
    });

    it('does not leak anonymous counters across calls', () => {
        const first = normalizeMatlabCalls('surf(x, y, f); surf(x, y, g);');
        const second = normalizeMatlabCalls('surf(x, y, h);');

        expect(first).toContain('surface _matlab_surf_1 = f;');
        expect(first).toContain('surface _matlab_surf_2 = g;');
        expect(second).toContain('surface _matlab_surf_1 = h;');
    });
});

describe('normalizeMatlabSyntax', () => {
    it('normalizes a representative MATLAB snippet', () => {
        const source = [
            'syms x y z;',
            'M = [1 0 0; 0 1 0; 0 0 1];',
            'f = sin(x) .* cos(y);',
            'surf(x, y, f);',
            'c = curl([y, -x, 0], [x, y, z]);',
        ].join('\n');

        expect(normalizeMatlabSyntax(source)).toContain('[[1, 0, 0], [0, 1, 0], [0, 0, 1]]');
        expect(normalizeMatlabSyntax(source)).toContain('sin(x) * cos(y)');
        expect(normalizeMatlabSyntax(source)).toContain('surface _matlab_surf_1 = f;');
        expect(normalizeMatlabSyntax(source)).toContain('curl c = curl([y, -x, 0]);');
    });
});
