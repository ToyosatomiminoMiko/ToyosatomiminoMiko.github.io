import { EventBus } from '../service/EventBus';
import type { MathLabEvents } from '../types';

/**
 * SelectionManager — 单选状态管理
 *
 * 职责:
 *   1. 维护当前选中实体 { id, kind }
 *   2. 发射 'selection:changed' 事件通知其他 UI 组件
 */
export class SelectionManager {
    private _eventBus: EventBus<MathLabEvents>;

    /** 当前选中状态(无选中时为 null) */
    private _selected: { id: number; kind: string } | null = null;

    constructor(eventBus: EventBus<MathLabEvents>) {
        this._eventBus = eventBus;
    }

    /**
     * 选中某个实体
     */
    select(id: number, kind: string): void {
        if (
            this._selected &&
            this._selected.id === id &&
            this._selected.kind === kind
        ) {
            return;
        }

        this._selected = { id, kind };
        this._eventBus.emit('selection:changed', { id, kind });
    }

    /**
     * 取消选中
     */
    deselect(): void {
        if (this._selected === null) return;

        this._selected = null;
        this._eventBus.emit('selection:changed', { id: null, kind: null });
    }

    /**
     * 获取当前选中实体信息
     */
    getSelected(): { id: number; kind: string } | null {
        return this._selected ? { ...this._selected } : null;
    }
}