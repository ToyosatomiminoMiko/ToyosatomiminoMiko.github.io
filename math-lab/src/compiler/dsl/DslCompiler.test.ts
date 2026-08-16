import { describe, expect, it, vi } from 'vitest';
import * as math from 'mathjs';
import { compileScene } from './DslCompiler';
import {
    evaluate_curl_point,
    evaluate_divergence_point,
    evaluate_gradient_point,
    evaluate_scalar,
} from '../../wasm/ml_wasm';
import type { AstProgram } from '../ast/types';

vi.mock('../../wasm/ml_wasm', () => ({
    evaluate_gradient_point: vi.fn(() => ({ f0: 0, fx: 0, fy: 0 })),
    evaluate_divergence_point: vi.fn(() => 0),
    evaluate_curl_point: vi.fn(() => ({ x: 0, y: 0, z: 0 })),
    evaluate_scalar: vi.fn((
        expr: string,
        names: string[],
        values: Float64Array,
        _x: number,
        _y: number,
        _z: number,
    ) => {
        const scope: Record<string, number> = {};
        names.forEach((name, index) => {
            scope[name] = values[index];
        });
        return math.evaluate(expr, scope);
    }),
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
        vi.mocked(evaluate_gradient_point).mockReturnValueOnce({
            f0: 3,
            fx: 2,
            fy: 7,
            free: () => {},
        });
        const scene = compileScene(ast);

        expect(scene.params).toHaveLength(2);
        expect(scene.objects).toHaveLength(3);
        expect(scene.objects[0].kind).toBe('curve');
        expect(scene.objects[1].kind).toBe('surface');
        expect(scene.objects[2].kind).toBe('vector_field');
        expect(scene.analyses).toHaveLength(1);
        expect(scene.analyses[0].point[0]).toBe(2);
        expect(scene.analyses[0].point[1]).toBeCloseTo(3);
        expect(scene.analyses[0].point[2]).toBe(0);
        expect(scene.analyses[0].vector[0]).toBeCloseTo(-2 / Math.sqrt(5));
        expect(scene.analyses[0].vector[1]).toBeCloseTo(1 / Math.sqrt(5));
        expect(scene.analyses[0].vector[2]).toBe(0);
        expect(scene.analyses[0].show).toContain('tangent_plane');
        expect(evaluate_gradient_point).toHaveBeenCalledWith(
            'sin(x * a)',
            'a * cos(x * a)',
            '0',
            ['a'],
            expect.any(Float64Array),
            2,
            0,
        );
        expect(scene.integrals).toHaveLength(1);
        expect(scene.integrals[0].method).toBe('riemann');
        expect(scene.integrals[0].sourceKind).toBe('curve');
    });

    it('evaluates analysis at expressions with current parameter overrides', () => {
        const surfaceAst: AstProgram = {
            statements: [
                ast.statements[0],
                ast.statements[1],
                ast.statements[3],
                {
                    type: 'analysis',
                    op: 'gradient',
                    name: 'gs',
                    call: 'grad',
                    source: 's',
                    at: ['a', 'b + 1'],
                    options: [],
                    span: { start: 0, end: 0 },
                },
            ],
        };

        const scene = compileScene(surfaceAst, { b: 3 });

        expect(scene.analyses[0].point[0]).toBe(2);
        expect(scene.analyses[0].point[1]).toBe(4);
        expect(scene.analyses[0].point[2]).toBe(0);
    });

    it('computes surface gradients from both partial derivatives', () => {
        vi.mocked(evaluate_gradient_point).mockReturnValueOnce({
            f0: 5,
            fx: 3,
            fy: 4,
            free: () => {},
        });
        const surfaceAst: AstProgram = {
            statements: [
                ast.statements[3],
                {
                    type: 'analysis',
                    op: 'gradient',
                    name: 'gs',
                    call: 'grad',
                    source: 's',
                    at: ['2', '4'],
                    options: [],
                    span: { start: 0, end: 0 },
                },
            ],
        };

        const scene = compileScene(surfaceAst);

        expect(evaluate_gradient_point).toHaveBeenCalledWith(
            'sin(x) * cos(y)',
            'cos(y) * cos(x)',
            '-(sin(x) * sin(y))',
            [],
            expect.any(Float64Array),
            2,
            4,
        );
        expect(scene.analyses[0].point).toEqual([2, 4, 5]);
        expect(scene.analyses[0].vector[0]).toBeCloseTo(-3 / Math.sqrt(26));
        expect(scene.analyses[0].vector[1]).toBeCloseTo(-4 / Math.sqrt(26));
        expect(scene.analyses[0].vector[2]).toBeCloseTo(1 / Math.sqrt(26));
    });

    it('reuses parsed nodes for repeated compiles of the same AST', () => {
        const first = compileScene(ast);
        const second = compileScene(ast, { b: 3 });

        expect((second.objects[0] as { expr: string }).expr)
            .toBe((first.objects[0] as { expr: string }).expr);
    });

    it('rejects invalid at coordinates instead of defaulting them to zero', () => {
        const badAtAst: AstProgram = {
            statements: [
                ast.statements[2],
                {
                    type: 'analysis',
                    op: 'gradient',
                    name: 'g',
                    call: 'grad',
                    source: 'c',
                    at: ['1', 'nonsense'],
                    options: [],
                    span: { start: 0, end: 0 },
                },
            ],
        };

        expect(() => compileScene(badAtAst)).toThrow('at 第 2 个坐标无法求值: nonsense');
    });

    it('rejects non-finite parameter declarations instead of using defaults', () => {
        const badParamAst: AstProgram = {
            statements: [
                {
                    type: 'param',
                    name: 'a',
                    value: 'not-a-number',
                    ui: null,
                    span: { start: 0, end: 0 },
                },
                ast.statements[2],
            ],
        };

        expect(() => compileScene(badParamAst)).toThrow('参数 a 的 value 不是有效数字: not-a-number');
    });

    it('rejects fractional or non-positive object segments instead of passing them through', () => {
        const badSegmentsAst: AstProgram = {
            statements: [
                {
                    type: 'object',
                    kind: 'curve',
                    name: 'c',
                    expr: 'sin(x)',
                    options: [
                        { name: 'range', value: '[-8, 8]' },
                        { name: 'segments', value: '3.7' },
                    ],
                    span: { start: 0, end: 0 },
                },
            ],
        };

        expect(() => compileScene(badSegmentsAst)).toThrow('曲线 c 的 segments 必须是正整数,当前为 3.7');
    });

    it('rejects reversed object ranges instead of generating NaN samples', () => {
        const badRangeAst: AstProgram = {
            statements: [
                {
                    type: 'object',
                    kind: 'curve',
                    name: 'c',
                    expr: 'sin(x)',
                    options: [{ name: 'range', value: '[8, -8]' }],
                    span: { start: 0, end: 0 },
                },
            ],
        };

        expect(() => compileScene(badRangeAst)).toThrow('曲线 c 的 range 需要 min < max');
    });

    it('rejects invalid vector field grid values', () => {
        const badGridAst: AstProgram = {
            statements: [
                {
                    type: 'object',
                    kind: 'vector_field',
                    name: 'F',
                    expr: '[y, -x, 0]',
                    options: [{ name: 'grid', value: '[0, 8, 8]' }],
                    span: { start: 0, end: 0 },
                },
            ],
        };

        expect(() => compileScene(badGridAst)).toThrow('向量场 F 的 grid 中的每个值都必须是正整数: [0, 8, 8]');
    });

    it('rejects analysis points with fewer coordinates than the operator needs', () => {
        const badAtAst: AstProgram = {
            statements: [
                ast.statements[4],
                {
                    type: 'analysis',
                    op: 'divergence',
                    name: 'd',
                    call: 'div',
                    source: 'F',
                    at: ['1', '2'],
                    options: [],
                    span: { start: 0, end: 0 },
                },
            ],
        };

        expect(() => compileScene(badAtAst)).toThrow('at 至少需要 3 个坐标');
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

    it('routes divergence and curl through the WASM field evaluators', () => {
        const fieldAst: AstProgram = {
            statements: [
                ast.statements[4],
                {
                    type: 'analysis',
                    op: 'divergence',
                    name: 'd',
                    call: 'div',
                    source: 'F',
                    at: ['1', '2', '3'],
                    options: [],
                    span: { start: 0, end: 0 },
                },
                {
                    type: 'analysis',
                    op: 'curl',
                    name: 'c',
                    call: 'curl',
                    source: 'F',
                    at: ['1', '2', '3'],
                    options: [],
                    span: { start: 0, end: 0 },
                },
            ],
        };

        const scene = compileScene(fieldAst);

        expect(scene.analyses).toHaveLength(2);
        expect(scene.analyses[0].op).toBe('divergence');
        expect(scene.analyses[0].scalar).toBe(0);
        expect(scene.analyses[1].op).toBe('curl');
        expect(scene.analyses[1].vector).toEqual([0, 0, 0]);
        expect(evaluate_divergence_point).toHaveBeenCalledWith(
            '0',
            '0',
            '0',
            [],
            expect.any(Float64Array),
            1,
            2,
            3,
        );
        expect(evaluate_curl_point).toHaveBeenCalledWith(
            '0',
            '0',
            '0',
            '0',
            '-1',
            '1',
            [],
            expect.any(Float64Array),
            1,
            2,
            3,
        );
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

    it('applies a transform chain to an object with the expected matrix', () => {
        const transformAst: AstProgram = {
            statements: [
                {
                    type: 'tensor',
                    kind: 'transform',
                    name: 'T',
                    expr: 'translate([2, 1, 0]) * scale([2, 2, 2])',
                    span: { start: 0, end: 0 },
                },
                {
                    type: 'object',
                    kind: 'curve',
                    name: 'c',
                    expr: 'x',
                    options: [
                        { name: 'transform', value: 'T' },
                        { name: 'range', value: '[-1, 1]' },
                    ],
                    span: { start: 0, end: 0 },
                },
            ],
        };

        const scene = compileScene(transformAst);

        expect(scene.objectTransforms[1]).toEqual([
            [2, 0, 0, 2],
            [0, 2, 0, 1],
            [0, 0, 2, 0],
            [0, 0, 0, 1],
        ]);
    });

    it('evaluates matrix literals through the WASM scalar backend', () => {
        const matrixAst: AstProgram = {
            statements: [
                {
                    type: 'tensor',
                    kind: 'matrix',
                    name: 'M',
                    expr: '[[1, 0, 0, 2], [0, 1, 0, 3], [0, 0, 1, 4], [0, 0, 0, 1]]',
                    span: { start: 0, end: 0 },
                },
                {
                    type: 'tensor',
                    kind: 'transform',
                    name: 'T',
                    expr: 'as_transform(M)',
                    span: { start: 0, end: 0 },
                },
                {
                    type: 'object',
                    kind: 'curve',
                    name: 'c',
                    expr: 'x',
                    options: [
                        { name: 'transform', value: 'T' },
                        { name: 'range', value: '[-1, 1]' },
                    ],
                    span: { start: 0, end: 0 },
                },
            ],
        };

        const scene = compileScene(matrixAst);

        expect(scene.objectTransforms[1]).toEqual([
            [1, 0, 0, 2],
            [0, 1, 0, 3],
            [0, 0, 1, 4],
            [0, 0, 0, 1],
        ]);
        expect(evaluate_scalar).toHaveBeenCalled();
    });

    it('compiles point and vector objects, including shorthand vector direction', () => {
        const pointVectorAst: AstProgram = {
            statements: [
                {
                    type: 'param',
                    name: 'a',
                    value: '2',
                    ui: null,
                    span: { start: 0, end: 0 },
                },
                {
                    type: 'object',
                    kind: 'point',
                    name: 'P',
                    expr: '[a, 1, 0]',
                    options: [],
                    span: { start: 0, end: 0 },
                },
                {
                    type: 'object',
                    kind: 'vector',
                    name: 'V',
                    expr: '[[1, 2, 3], [a, 0, 1]]',
                    options: [],
                    span: { start: 0, end: 0 },
                },
                {
                    type: 'object',
                    kind: 'vector',
                    name: 'W',
                    expr: '[0, a, 0]',
                    options: [],
                    span: { start: 0, end: 0 },
                },
            ],
        };

        const scene = compileScene(pointVectorAst, { a: 4 });

        expect(scene.objects).toHaveLength(3);
        expect(scene.objects[0]).toMatchObject({ kind: 'point', x: 4, y: 1, z: 0 });
        expect(scene.objects[1]).toMatchObject({
            kind: 'vector',
            origin: { x: 1, y: 2, z: 3 },
            direction: { x: 4, y: 0, z: 1 },
        });
        expect(scene.objects[2]).toMatchObject({
            kind: 'vector',
            origin: { x: 0, y: 0, z: 0 },
            direction: { x: 0, y: 4, z: 0 },
        });
    });
});
