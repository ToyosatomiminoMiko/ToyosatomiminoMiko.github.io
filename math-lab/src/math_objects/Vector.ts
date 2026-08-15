import type { VectorObject } from '../ir/types';

/**
 * 创建一个空间向量实体(纯数据)
 */
export function createVector(
    id: number,
    dx: number, dy: number, dz: number,
    ox: number, oy: number, oz: number,
    color: string,
): VectorObject {
    return {
        kind: 'vector',
        id,
        origin: { x: ox, y: oy, z: oz },
        direction: { x: dx, y: dy, z: dz },
        color,
        enabled: true,
    };
}

/**
 * 更新向量方向和起点(返回新对象)
 */
export function transformVector(
    vec: VectorObject,
    dx: number, dy: number, dz: number,
    ox: number, oy: number, oz: number,
): VectorObject {
    return {
        ...vec,
        origin: { x: ox, y: oy, z: oz },
        direction: { x: dx, y: dy, z: dz },
    };
}
