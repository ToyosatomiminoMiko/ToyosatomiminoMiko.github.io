import type { MathObject } from './types';

/**
 * MathObject 的集合存储层。
 * MathObjectManager 只负责领域操作，不再直接维护数组与 Map。
 */
export class MathObjectRepository {
    private readonly _objects: MathObject[] = [];
    private readonly _objectsById = new Map<number, MathObject>();

    add(obj: MathObject): void {
        this._objects.push(obj);
        this._objectsById.set(obj.id, obj);
    }

    getById(id: number): MathObject | undefined {
        return this._objectsById.get(id);
    }

    getAll(): MathObject[] {
        return this._objects;
    }

    getByKind(kind: MathObject['kind']): MathObject[] {
        return this._objects.filter(obj => obj.kind === kind);
    }

    remove(id: number): MathObject | undefined {
        const obj = this._objectsById.get(id);
        if (!obj) return undefined;

        const idx = this._objects.indexOf(obj);
        if (idx !== -1) this._objects.splice(idx, 1);
        this._objectsById.delete(id);
        return obj;
    }
}
