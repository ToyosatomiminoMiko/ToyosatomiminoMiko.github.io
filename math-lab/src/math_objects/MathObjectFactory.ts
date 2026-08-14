import type { PointEntity, VectorEntity } from './types';
import { createPoint } from './Point';
import { createVector } from './Vector';
import { ColorManager } from './ColorManager';

/**
 * 负责点与空间向量的实体创建.
 * MathObjectManager 只负责把创建结果放入 repository.
 */
export class MathObjectFactory {
    constructor(private readonly colorManager: ColorManager) {}

    createPoint(
        id: number,
        x: number,
        y: number,
        z: number,
        color?: string,
    ): PointEntity {
        return createPoint(id, x, y, z, color ?? this.colorManager.next());
    }

    createVector(
        id: number,
        dx: number,
        dy: number,
        dz: number,
        ox: number,
        oy: number,
        oz: number,
        color?: string,
    ): VectorEntity {
        return createVector(
            id,
            dx,
            dy,
            dz,
            ox,
            oy,
            oz,
            color ?? this.colorManager.next(),
        );
    }
}
