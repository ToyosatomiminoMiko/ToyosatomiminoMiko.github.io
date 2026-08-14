import { describe, expect, it } from 'vitest';
import { compileScene } from './DslCompiler';
import type { AstProgram } from '../ast/types';

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
            type: 'camera',
            options: [
                { name: 'projection', value: 'orthographic' },
                { name: 'rotation_lock', value: 'true' },
                { name: 'home', value: 'front' },
            ],
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
    it('compiles core DSL objects and camera state', () => {
        const scene = compileScene(ast);

        expect(scene.params).toHaveLength(1);
        expect(scene.objects).toHaveLength(3);
        expect(scene.objects[0].kind).toBe('curve');
        expect(scene.objects[1].kind).toBe('surface');
        expect(scene.objects[2].kind).toBe('vector_field');
        expect(scene.camera.projection).toBe('orthographic');
        expect(scene.camera.rotationLock).toBe(true);
        expect(scene.camera.home).toBe('front');
        expect(scene.integrals).toHaveLength(1);
        expect(scene.integrals[0].method).toBe('riemann');
        expect(scene.integrals[0].sourceKind).toBe('curve');
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
});
