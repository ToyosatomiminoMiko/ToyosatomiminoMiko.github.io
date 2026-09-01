import { describe, expect, it, vi } from 'vitest';
import { compileScene } from './DslCompiler';
import { jsMatrixOps } from '../../math/tensor/SceneTransform';
import type { AstProgram, ObjectStatement } from '../ast/types';
import type { Vec3 } from '../ir/types';

vi.mock('../../wasm/math_rs/math_rs', () => {
    function buildScope(names: string[], values: ArrayLike<number>): Record<string, number> {
        const scope: Record<string, number> = {};
        names.forEach((name, index) => {
            scope[name] = values[index];
        });
        scope.pi = Math.PI;
        scope.e = Math.E;
        return scope;
    }

    function evaluate(
        expr: string,
        names: string[],
        values: ArrayLike<number>,
        x: number,
        y: number,
        z: number,
    ): number {
        const scope = buildScope(names, values);
        scope.x = x;
        scope.y = y;
        scope.z = z;
        const fn = new Function(...Object.keys(scope), `return (${expr});`);
        return fn(...Object.values(scope));
    }

    return {
        evaluate_scalar: vi.fn((
            expr: string,
            names: string[],
            values: Float64Array,
            x: number,
            y: number,
            z: number,
        ) => evaluate(expr, names, values, x, y, z)),
        normalize_expression: vi.fn((expr: string) => expr),
        symbolic_derivative: vi.fn(() => '0'),
        symbolic_variables: vi.fn(() => []),
        parse_array_strings: vi.fn((expr: string) => {
            const items = expr
                .slice(1, -1)
                .split(',')
                .map((item) => `"${item.trim()}"`);
            return `[${items.join(',')}]`;
        }),
        matrix4_from_expr: vi.fn(() => [
            1, 0, 0, 0,
            0, 1, 0, 0,
            0, 0, 1, 0,
            0, 0, 0, 1,
        ]),
        sample_curve: vi.fn((
            expr: string,
            names: string[],
            values: Float64Array,
            xMin: number,
            xMax: number,
            steps: number,
        ) => {
            const points: number[] = [];
            for (let i = 0; i <= steps; i += 1) {
                const x = xMin + ((xMax - xMin) * i) / steps;
                const y = evaluate(expr, names, values, x, 0, 0);
                if (Number.isFinite(y)) {
                    points.push(x, y, 0);
                }
            }
            return new Float32Array(points);
        }),
        sample_surface_values: vi.fn((
            expr: string,
            names: string[],
            values: Float64Array,
            xa: number,
            xb: number,
            ya: number,
            yb: number,
            nx: number,
            ny: number,
        ) => {
            const grid: number[] = [];
            for (let j = 0; j <= ny; j += 1) {
                const y = ya + ((yb - ya) * j) / ny;
                for (let i = 0; i <= nx; i += 1) {
                    const x = xa + ((xb - xa) * i) / nx;
                    grid.push(evaluate(expr, names, values, x, y, 0));
                }
            }
            return new Float64Array(grid);
        }),
        evaluate_gradient_point: vi.fn(() => ({ f0: 0, fx: 0, fy: 0 })),
        evaluate_divergence_point: vi.fn(() => 0),
        evaluate_curl_point: vi.fn(() => ({ x: 0, y: 0, z: 0 })),
    };
});

function object(
    kind: ObjectStatement['kind'],
    name: string,
    expr: string,
    options: Array<{ name: string; value: string }> = [],
): ObjectStatement {
    return {
        type: 'object',
        kind,
        name,
        expr,
        options,
        span: { start: 0, end: 0 },
    };
}

function intersection(name: string, a: string, b: string, options: Array<{ name: string; value: string }> = []): AstProgram['statements'][number] {
    return {
        type: 'intersection',
        name,
        a,
        b,
        options,
        span: { start: 0, end: 0 },
    };
}

function curve(name: string, expr: string, range = '[-2, 2]'): ObjectStatement {
    return object('curve', name, expr, [
        { name: 'range', value: range },
        { name: 'segments', value: '64' },
    ]);
}

function surface(name: string, expr: string, range = '[-2, 2, -2, 2]'): ObjectStatement {
    return object('surface', name, expr, [
        { name: 'range', value: range },
        { name: 'segments', value: '32' },
    ]);
}

function program(...statements: AstProgram['statements']): AstProgram {
    return { statements };
}

function closeTo(value: number, expected: number, tolerance = 0.03): boolean {
    return Math.abs(value - expected) <= tolerance;
}

describe('compileIntersections', () => {
    it('finds points where two planar curves cross', () => {
        const scene = compileScene(program(
            curve('a', 'x'),
            curve('b', '-x + 2'),
            intersection('I', 'a', 'b'),
        ));

        expect(scene.intersections).toHaveLength(1);
        const result = scene.intersections[0];
        expect(result.points).toHaveLength(1);
        expect(result.points[0].x).toBeCloseTo(1, 4);
        expect(result.points[0].y).toBeCloseTo(1, 4);
        expect(result.points[0].z).toBe(0);
        expect(result.curves).toHaveLength(0);
    });

    it('finds points where a curve pierces a surface', () => {
        const scene = compileScene(program(
            curve('c', 'x'),
            surface('s', 'y'),
            intersection('I', 'c', 's'),
        ));

        expect(scene.intersections[0].points).toHaveLength(1);
        expect(scene.intersections[0].points[0].x).toBeCloseTo(0, 4);
        expect(scene.intersections[0].points[0].y).toBeCloseTo(0, 4);
    });

    it('finds points where a curve crosses a sphere boundary', () => {
        const scene = compileScene(program(
            curve('c', 'x'),
            object('sphere', 'S', '[0, 0, 0]', [
                { name: 'radius', value: '1' },
            ]),
            intersection('I', 'c', 'S'),
        ));

        const points = scene.intersections[0].points;
        expect(points).toHaveLength(2);
        const xs = points.map((point) => point.x).sort((a, b) => a - b);
        expect(xs[0]).toBeCloseTo(-1 / Math.sqrt(2), 3);
        expect(xs[1]).toBeCloseTo(1 / Math.sqrt(2), 3);
    });

    it('traces the intersection curve of two surfaces', () => {
        const scene = compileScene(program(
            surface('s1', '0'),
            surface('s2', 'x'),
            intersection('I', 's1', 's2'),
        ));

        const result = scene.intersections[0];
        expect(result.points).toHaveLength(0);
        expect(result.curves.length).toBeGreaterThanOrEqual(1);

        const points = result.curves.flat();
        expect(points.length).toBeGreaterThanOrEqual(16);
        for (const point of points) {
            expect(point.x).toBeCloseTo(0, 2);
            expect(point.z).toBeCloseTo(0, 2);
        }
        const ys = points.map((point) => point.y);
        expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(3);
    });

    it('clips surface intersection curves to the second surface range', () => {
        const scene = compileScene(program(
            surface('s1', '0'),
            surface('s2', 'x', '[-1, 1, -1, 1]'),
            intersection('I', 's1', 's2'),
        ));

        const points = scene.intersections[0].curves.flat();
        expect(points.length).toBeGreaterThanOrEqual(8);
        for (const point of points) {
            expect(Math.abs(point.y)).toBeLessThanOrEqual(1.02);
            expect(Math.abs(point.x)).toBeLessThanOrEqual(1.02);
        }
    });

    it('traces the circle where a plane surface cuts a sphere', () => {
        const scene = compileScene(program(
            object('sphere', 'S', '[0, 0, 0]', [
                { name: 'radius', value: '1' },
            ]),
            surface('s', '0', '[-1.5, 1.5, -1.5, 1.5]'),
            intersection('I', 's', 'S'),
        ));

        const result = scene.intersections[0];
        expect(result.curves.length).toBeGreaterThanOrEqual(1);
        const points = result.curves.flat();
        expect(points.length).toBeGreaterThanOrEqual(24);
        for (const point of points) {
            expect(Math.hypot(point.x, point.y)).toBeCloseTo(1, 1);
            expect(point.z).toBeCloseTo(0, 2);
        }
    });

    it('traces curves where two volume boundaries cross', () => {
        const scene = compileScene(program(
            object('sphere', 'S', '[0, 0, 0]', [
                { name: 'radius', value: '1.5' },
            ]),
            object('box', 'B', '[0, 0, 0]', [
                { name: 'size', value: '[2, 2, 2]' },
            ]),
            intersection('I', 'S', 'B'),
        ));

        const result = scene.intersections[0];
        expect(result.curves.length).toBeGreaterThanOrEqual(4);
        const points = result.curves.flat();
        expect(points.length).toBeGreaterThanOrEqual(20);
        for (const point of points) {
            expect(Math.hypot(point.x, point.y, point.z)).toBeCloseTo(1.5, 1);
            expect(Math.max(
                Math.abs(point.x),
                Math.abs(point.y),
                Math.abs(point.z),
            )).toBeCloseTo(1, 1);
        }
    });

    it('accounts for static transforms on the curve side', () => {
        const scene = compileScene(program(
            {
                type: 'tensor',
                kind: 'transform',
                name: 'T',
                expr: 'translate([0, 1, 0])',
                span: { start: 0, end: 0 },
            },
            {
                ...curve('c', 'x'),
                options: [
                    { name: 'range', value: '[-2, 2]' },
                    { name: 'segments', value: '64' },
                    { name: 'transform', value: 'T' },
                ],
            },
            surface('s', 'y'),
            intersection('I', 'c', 's'),
        ));

        const point = scene.intersections[0].points[0];
        expect(point.x).toBeCloseTo(-1, 3);
        expect(point.y).toBeCloseTo(0, 3);
        expect(point.z).toBeCloseTo(0, 3);
    });

    it('skips computation for hidden intersections but keeps the list item', () => {
        const scene = compileScene(
            program(
                curve('a', 'x'),
                curve('b', '-x + 2'),
                intersection('I', 'a', 'b'),
            ),
            {},
            jsMatrixOps,
            { hiddenIntersectionNames: new Set(['I']) },
        );

        expect(scene.intersections).toHaveLength(1);
        expect(scene.intersections[0].enabled).toBe(false);
        expect(scene.intersections[0].points).toHaveLength(0);
    });

    it('rejects unknown options instead of ignoring them', () => {
        expect(() => compileScene(program(
            curve('a', 'x'),
            curve('b', '-x + 2'),
            intersection('I', 'a', 'b', [{ name: 'foo', value: '1' }]),
        ))).toThrow('求交 I 包含未知选项: foo');
    });

    it('rejects references to missing objects', () => {
        expect(() => compileScene(program(
            curve('a', 'x'),
            intersection('I', 'a', 'missing'),
        ))).toThrow('求交 I 引用了不存在的对象 missing');
    });

    it('rejects self-intersection', () => {
        expect(() => compileScene(program(
            curve('a', 'x'),
            intersection('I', 'a', 'a'),
        ))).toThrow('两个对象不能相同');
    });

    it('rejects animated sources', () => {
        expect(() => compileScene(program(
            {
                type: 'animation',
                name: 'drift',
                expr: 'translate([1, 0, 0])',
                options: [{ name: 'duration', value: '1' }],
                span: { start: 0, end: 0 },
            },
            {
                ...curve('c', 'x'),
                options: [
                    { name: 'range', value: '[-2, 2]' },
                    { name: 'animation', value: '[drift]' },
                ],
            },
            surface('s', 'y'),
            intersection('I', 'c', 's'),
        ))).toThrow('带动画,暂不支持');
    });

    it('rejects unsupported object kinds', () => {
        expect(() => compileScene(program(
            curve('c', 'x'),
            object('vector_field', 'F', '[x, y, z]'),
            intersection('I', 'c', 'F'),
        ))).toThrow('求交 I 不支持 vector_field 类型的对象 F');
    });
});
