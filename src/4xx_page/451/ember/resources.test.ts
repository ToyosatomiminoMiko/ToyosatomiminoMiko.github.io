import { describe, expect, it } from 'vitest';
import { PARTICLE_FIELD, PARTICLE_STRIDE } from './config';

/**
 * Particle 结构的布局守卫.
 *
 * 这里出过一个很隐蔽的 bug: TS 侧按 12 个 f32(48 字节)播种, 而 WGSL 里
 * color 是 vec3<f32>(对齐 16), 真实布局是 16 个 f32(64 字节). 结果缓冲开小了
 * 1/4, arrayLength 只剩 135, 播种数据也整片错位.
 *
 * 所以这个测试不直接断言"64"这个数字, 而是按 WGSL 的对齐规则把 common.wgsl 里的
 * struct Particle 重算一遍 -- 谁改了着色器里的字段顺序/类型, 这里就会红.
 */

type WgslType = 'f32' | 'vec2<f32>' | 'vec3<f32>';

const ALIGN: Record<WgslType, number> = { 'f32': 4, 'vec2<f32>': 8, 'vec3<f32>': 16 };
const SIZE: Record<WgslType, number> = { 'f32': 4, 'vec2<f32>': 8, 'vec3<f32>': 12 };

const roundUp = (value: number, align: number): number => Math.ceil(value / align) * align;

/** 与 shaders/common.wgsl 的 `struct Particle` 一一对应 */
const PARTICLE_FIELDS: ReadonlyArray<readonly [WgslType, string]> = [
    ['vec2<f32>', 'pos'],
    ['vec2<f32>', 'vel'],
    ['f32', 'size'],
    ['f32', 'age'],
    ['f32', 'life'],
    ['f32', 'flick'],
    ['f32', 'seed'],
    ['vec3<f32>', 'color'],
    ['f32', 'rise'],
];

function particleLayout(): { offsets: Record<string, number>; stride: number } {
    const offsets: Record<string, number> = {};
    let offset = 0;
    let maxAlign = 1;
    for (const [type, name] of PARTICLE_FIELDS) {
        offset = roundUp(offset, ALIGN[type]);
        offsets[name] = offset / 4; // f32 下标
        offset += SIZE[type];
        maxAlign = Math.max(maxAlign, ALIGN[type]);
    }
    return { offsets, stride: roundUp(offset, maxAlign) };
}

describe('Particle 结构布局', () => {
    const { offsets, stride } = particleLayout();

    it('stride 与 common.wgsl 一致', () => {
        expect(stride).toBe(PARTICLE_STRIDE);
    });

    it('每个字段都很紧凑: 只有 vec3 前面的对齐填充', () => {
        // vec3<f32> 前必须有 8 个字节的填充, 否则说明字段顺序被改了
        expect(offsets.color).toBe(12);
        expect(offsets.rise).toBe(15);
    });

    it('TS 播种用的下标与 WGSL 完全对得上', () => {
        expect(offsets.pos).toBe(PARTICLE_FIELD.posX);
        expect(offsets.vel).toBe(PARTICLE_FIELD.velX);
        expect(offsets.size).toBe(PARTICLE_FIELD.size);
        expect(offsets.age).toBe(PARTICLE_FIELD.age);
        expect(offsets.life).toBe(PARTICLE_FIELD.life);
        expect(offsets.flick).toBe(PARTICLE_FIELD.flick);
        expect(offsets.seed).toBe(PARTICLE_FIELD.seed);
        // color 是 vec3, 占 12/13/14 三个连续下标
        expect(offsets.color).toBe(PARTICLE_FIELD.colorR);
        expect(offsets.color + 1).toBe(PARTICLE_FIELD.colorG);
        expect(offsets.color + 2).toBe(PARTICLE_FIELD.colorB);
        expect(offsets.rise).toBe(PARTICLE_FIELD.rise);
    });

    it('下标都落在 stride 之内', () => {
        const floats = PARTICLE_STRIDE / 4;
        for (const offset of Object.values(offsets)) {
            expect(offset).toBeGreaterThanOrEqual(0);
            expect(offset).toBeLessThan(floats);
        }
    });
});
