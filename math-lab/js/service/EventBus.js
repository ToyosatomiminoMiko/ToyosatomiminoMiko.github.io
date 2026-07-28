/**
 * 事件总线 — 跨层通信的桥梁
 * Core 层和 UI 层通过 EventBus 通信,互不直接引用
 *
 * 预定义事件清单:
 *   'expr:added'      => { expr }
 *   'expr:removed'    => { id }
 *   'expr:toggled'    => { id, enabled }
 *   'expr:updated'    => { id, fnStr }
 *   'mode:changed'    => { mode: '2d'|'3d' }
 *   'camera:changed'  => { camMode: 'perspective'|'orthographic' }
 *   'integral:calculated' => { results, total }
 */
export class EventBus {
    constructor() {
        this._listeners = new Map();
    }

    on(event, callback) {
        if (!this._listeners.has(event)) {
            this._listeners.set(event, []);
        }
        this._listeners.get(event).push(callback);
        // 返回取消订阅函数,方便清理
        return () => this.off(event, callback);
    }

    off(event, callback) {
        const cbs = this._listeners.get(event);
        if (cbs) {
            const idx = cbs.indexOf(callback);
            if (idx !== -1) cbs.splice(idx, 1);
        }
    }

    emit(event, data) {
        const cbs = this._listeners.get(event);
        if (cbs) {
            cbs.forEach(cb => {
                try { cb(data); } catch (e) { console.error(`[EventBus] ${event} 回调出错:`, e); }
            });
        }
    }

    /** 清空所有监听(用于销毁/重置) */
    clear() {
        this._listeners.clear();
    }
}