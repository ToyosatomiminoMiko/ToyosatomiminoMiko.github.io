import { describe, expect, it } from 'vitest';
import {
    cartesianToSpherical,
    sphericalToCartesian,
} from './sphericalCoordinates';

const PI = Math.PI;

describe('sphericalToCartesian', () => {
    it('physics 约定:θ 从 +Z 量起,φ 是 xy 平面方位角', () => {
        // 极角 π/2 落在赤道,方位角 0 / π/2 分别指向 +X / +Y.
        const plusX = sphericalToCartesian(2, PI / 2, 0, 'physics');
        expect(plusX[0]).toBeCloseTo(2, 12);
        expect(plusX[1]).toBeCloseTo(0, 12);
        expect(plusX[2]).toBeCloseTo(0, 12);
        const plusY = sphericalToCartesian(2, PI / 2, PI / 2, 'physics');
        expect(plusY[0]).toBeCloseTo(0, 12);
        expect(plusY[1]).toBeCloseTo(2, 12);
        expect(plusY[2]).toBeCloseTo(0, 12);
        // 极角 0 是 +Z 极点,与方位角无关.
        const north = sphericalToCartesian(2, 0, 0, 'physics');
        expect(north[0]).toBeCloseTo(0, 12);
        expect(north[1]).toBeCloseTo(0, 12);
        expect(north[2]).toBeCloseTo(2, 12);
    });

    it('math 约定:θ/φ 与 physics 互换', () => {
        const plusX = sphericalToCartesian(2, 0, PI / 2, 'math');
        expect(plusX[0]).toBeCloseTo(2, 12);
        expect(plusX[1]).toBeCloseTo(0, 12);
        expect(plusX[2]).toBeCloseTo(0, 12);
        // 同一个三元组在两种约定下是不同方向(方位角放到 φ).
        const swapped = sphericalToCartesian(2, PI / 2, 0, 'math');
        expect(swapped[0]).toBeCloseTo(0, 12);
        expect(swapped[1]).toBeCloseTo(0, 12);
        expect(swapped[2]).toBeCloseTo(2, 12);
    });
});

describe('cartesianToSpherical', () => {
    it('physics 约定:给出极角与 atan2 方位角', () => {
        const plusX = cartesianToSpherical(2, 0, 0, 'physics');
        expect(plusX[0]).toBeCloseTo(2, 12);
        expect(plusX[1]).toBeCloseTo(PI / 2, 12);
        expect(plusX[2]).toBeCloseTo(0, 12);

        const minusY = cartesianToSpherical(0, -3, 0, 'physics');
        expect(minusY[0]).toBeCloseTo(3, 12);
        expect(minusY[1]).toBeCloseTo(PI / 2, 12);
        expect(minusY[2]).toBeCloseTo(-PI / 2, 12);

        const north = cartesianToSpherical(0, 0, 2, 'physics');
        expect(north[1]).toBeCloseTo(0, 12);
    });

    it('math 约定:θ 是 atan2 方位角,φ 是极角', () => {
        const point = cartesianToSpherical(0, 1, 0, 'math');
        expect(point[0]).toBeCloseTo(1, 12);
        expect(point[1]).toBeCloseTo(PI / 2, 12);
        expect(point[2]).toBeCloseTo(PI / 2, 12);
    });

    it('原点处角度未定义,返回全 0 而不是 NaN', () => {
        expect(cartesianToSpherical(0, 0, 0, 'physics')).toEqual([0, 0, 0]);
        expect(cartesianToSpherical(0, 0, 0, 'math')).toEqual([0, 0, 0]);
    });

    it('两种约定下都能往返(球 -> 笛卡尔 -> 球)', () => {
        // 角度都取在各自约定值域内:极角 ∈ [0, π],方位角 ∈ (-π, π].
        const inputs = {
            physics: { r: 1.7, theta: 0.9, phi: -2.1 },
            math: { r: 1.7, theta: -2.1, phi: 0.9 },
        } as const;
        for (const convention of ['physics', 'math'] as const) {
            const { r, theta, phi } = inputs[convention];
            const cartesian = sphericalToCartesian(r, theta, phi, convention);
            const back = cartesianToSpherical(...cartesian, convention);
            expect(back[0]).toBeCloseTo(r, 10);
            expect(back[1]).toBeCloseTo(theta, 10);
            expect(back[2]).toBeCloseTo(phi, 10);
        }
    });
});
