import type { PointObject } from '../ir/types';

/**
 * 创建一个空间点实体(纯数据,不依赖渲染)
 */
export function createPoint(
    id: number,
    x: number,
    y: number,
    z: number,
    color: string,
): PointObject {
    return {
        kind: 'point',
        id,
        x,
        y,
        z,
        color,
        enabled: true,
    };
}

/**
 * 更新点坐标(返回新对象,不修改原对象)
 */
export function movePoint(
    point: PointObject,
    x: number,
    y: number,
    z: number,
): PointObject {
    return { ...point, x, y, z };
}
