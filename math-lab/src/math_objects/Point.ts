import type { PointEntity } from './types';

/**
 * 创建一个空间点实体(纯数据,不依赖渲染)
 */
export function createPoint(
    id: number,
    x: number,
    y: number,
    z: number,
    color: string,
): PointEntity {
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
    point: PointEntity,
    x: number,
    y: number,
    z: number,
): PointEntity {
    return { ...point, x, y, z };
}