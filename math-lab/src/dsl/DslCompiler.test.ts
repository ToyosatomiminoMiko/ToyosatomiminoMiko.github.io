import { describe, expect, it, vi } from 'vitest';
import { compileScene } from './DslCompiler';
import { evaluate_gradient_point } from '../wasm/ml_wasm';
import type { AstProgram } from '../ast/types';

vi.mock('../wasm/ml_wasm', () => ({
    evaluate_gradient_point: vi.fn(() => ({ f0: 0, fx: 0, fy: 0 })),
    evaluate_divergence_point: vi.fn(() => 0),
    evaluate_curl_point: vi.fn(() => ({ x: 0, y: 0, z: 0 })),
}));

const ast: AstProgram = {
    statements: [
        {
            type: 'param',
            name: 'a',
            value: '2',
            ui: { min: '-5', max: '5', step: '0.1' },
            span: { start: 0, end: 0 },
        },
        {
            type: 'param',
            name: 'b',
            value: '1',
            ui: { min: '-3', max: '3', step: '0.1' },
            span: { start: 0, end: 0 },
        },
        {
            type: 'object',
            kind: 'curve',
            name: 'c',
            expr: 'sin(x*a)',
            options: [
                { name: 'range', value: '[-8, 8]' },
                { name: 'segments', value: '128' },
            ],
            span: { start: 0, end: 0 },
        },
        {
            type: 'object',
            kind: 'surface',
            name: 's',
            expr: 'sin(x)*cos(y)',
            options: [{ name: 'range', value: '[-6, 6, -6, 6]' }],
            span: { start: 0, end: 0 },
        },
        {
            type: 'object',
            kind: 'vector_field',
            name: 'F',
            expr: '[y, -x, 0]',
            options: [{ name: 'grid', value: '[8, 8, 8]' }],
            span: { start: 0, end: 0 },
        },
        {
            type: 'analysis',
            op: 'gradient',
            name: 'g',
            call: 'grad',
            source: 'c',
            at: ['a', 'b + 1'],
            options: [{ name: 'show', value: '[point, normal, tangent_plane]' }],
            span: { start: 0, end: 0 },
        },
        {
            type: 'integral',
            name: 'I',
            source: 'c',
            options: [
                { name: 'method', value: 'riemann' },
                { name: 'range', value: '[-4, 4]' },
                { name: 'segments', value: '32' },
            ],
            span: { start: 0, end: 0 },
        },
    ],
};

describe('compileScene', () => {
    it('compiles core DSL objects and integral state', () => {
        const scene = compileScene(ast);

        expect(scene.params).toHaveLength(2);
        expect(scene.objects).toHaveLength(3);
        expect(scene.objects[0].kind).toBe('curve');
        expect(scene.objects[1].kind).toBe('surface');
        expect(scene.objects[2].kind).toBe('vector_field');
        expect(scene.analyses).toHaveLength(1);
        expect(scene.analyses[0].point[0]).toBe(2);
        expect(scene.analyses[0].point[1]).toBe(2);
        expect(scene.analyses[0].show).toContain('tangent_plane');
        expect(evaluate_gradient_point).toHaveBeenCalledWith(
            'sin(x * a)',
            'a * cos(x * a)',
            '0',
            ['a'],
            expect.any(Float64Array),
            2,
            2,
        );
        expect(scene.integrals).toHaveLength(1);
        expect(scene.integrals[0].method).toBe('riemann');
        expect(scene.integrals[0].sourceKind).toBe('curve');
    });

    it('evaluates analysis at expressions with current parameter overrides', () => {
        const scene = compileScene(ast, { b: 3 });

        expect(scene.analyses[0].point[0]).toBe(2);
        expect(scene.analyses[0].point[1]).toBe(4);
    });

    it('reuses parsed nodes for repeated compiles of the same AST', () => {
        const first = compileScene(ast);
        const second = compileScene(ast, { b: 3 });

        expect((second.objects[0] as { node: unknown }).node)
            .toBe((first.objects[0] as { node: unknown }).node);
    });

    it('rejects odd Simpson segments instead of silently adjusting them', () => {
        const badAst: AstProgram = {
            statements: [
                ast.statements[2],
                {
                    type: 'integral',
                    name: 'I',
                    source: 'c',
                    options: [
                        { name: 'method', value: 'simpson' },
                        { name: 'range', value: '[-4, 4]' },
                        { name: 'segments', value: '31' },
                    ],
                    span: { start: 0, end: 0 },
                },
            ],
        };

        expect(() => compileScene(badAst)).toThrow('辛普森法要求分段数必须为偶数');
    });

    it('rejects unimplemented differential operators instead of ignoring them', () => {
        const badAst: AstProgram = {
            statements: [
                ast.statements[2],
                {
                    type: 'analysis',
                    op: 'jacobian',
                    name: 'J',
                    call: 'jacobian',
                    source: 'c',
                    at: ['1', '0', '0'],
                    options: [],
                    span: { start: 0, end: 0 },
                },
            ],
        };

        expect(() => compileScene(badAst)).toThrow('暂未实现');
    });

    it('compiles a transform chain with pi and function calls', () => {
        const transformAst: AstProgram = {
            statements: [
                {
                    type: 'tensor',
                    kind: 'transform',
                    name: 'T2',
                    expr: 'translate([2, 1, 0]) * rotate([0, 0, pi / 4]) * scale([1.5, 1, 1])',
                    span: { start: 0, end: 0 },
                },
            ],
        };

        expect(() => compileScene(transformAst)).not.toThrow();
    });
});
