import { EventBus } from '../service/EventBus';
import type { MathLabEvents } from '../types';

/**
 * SelectionManager — 单选状态管理（精简版）
 *
 * 职责：
 *   1. 维护当前选中实体 { id, type }
 *   2. 发射 'selection:changed' 事件通知其他 UI 组件
 *
 * 注意：已移除画布拾取和高亮功能，仅保留状态管理。
 */
export class SelectionManager {
    private _eventBus: EventBus<MathLabEvents>;

    /** 当前选中状态（无选中时为 null） */
    private _selected: { id: number; type: string } | null = null;

    constructor(eventBus: EventBus<MathLabEvents>) {
        this._eventBus = eventBus;
    }

    /**
     * 选中某个实体
     */
    select(id: number, type: string): void {
        if (
            this._selected &&
            this._selected.id === id &&
            this._selected.type === type
        ) {
            return;
        }

        this._selected = { id, type };
        this._eventBus.emit('selection:changed', { id, type });
    }

    /**
     * 取消选中
     */
    deselect(): void {
        if (this._selected === null) return;

        this._selected = null;
        this._eventBus.emit('selection:changed', { id: null, type: null });
    }

    /**
     * 获取当前选中实体信息
     */
    getSelected(): { id: number; type: string } | null {
        return this._selected ? { ...this._selected } : null;
    }
}