/**
 * 泛型事件总线 — 跨层通信的桥梁
 * Core 层和 UI 层通过 EventBus 通信,互不直接引用
 *
 * 使用方式:
 *   const bus = new EventBus<MathLabEvents>();
 *   bus.on('expr:added', ({ expr }) => { ... });
 *   bus.emit('expr:added', { expr });              // 第二个参数类型受约束
 */
export class EventBus<Events extends Record<string, any>> {
    /**
     * @cache
     * 缓存目的:维护事件名到监听器数组的注册表.
     * 键/失效策略:事件名 -> 回调数组;off 时移除单条,clear 时清空.
     * 生命周期:跟随 EventBus 实例.
     */
    private _listeners: Map<keyof Events, Array<(data: any) => void>>;

    constructor() {
        this._listeners = new Map();
    }

    /**
     * 订阅事件
     * @returns 取消订阅函数
     */
    /**
     * @cache-access
     * 向监听器注册表写入一个订阅.
     */
    on<K extends keyof Events>(
        event: K,
        callback: (data: Events[K]) => void,
    ): () => void {
        if (!this._listeners.has(event)) {
            this._listeners.set(event, []);
        }
        this._listeners.get(event)!.push(callback);
        return () => this.off(event, callback);
    }

    /**
     * 取消订阅
     */
    /**
     * @cache access
     * 从监听器注册表移除一个订阅.
     */
    off<K extends keyof Events>(
        event: K,
        callback: (data: Events[K]) => void,
    ): void {
        const cbs = this._listeners.get(event);
        if (cbs) {
            const idx = cbs.indexOf(callback);
            if (idx !== -1) cbs.splice(idx, 1);
        }
    }

    /**
     * 触发事件
     */
    /**
     * @cache access
     * 命中监听器注册表并触发回调.
     */
    emit<K extends keyof Events>(event: K, data: Events[K]): void {
        const cbs = this._listeners.get(event);
        if (cbs) {
            cbs.forEach(cb => {
                try {
                    cb(data);
                } catch {
                    // 事件回调错误不再写日志,避免恢复输出链路.
                }
            });
        }
    }

    /** 清空所有监听 用于销毁/重置 */
    /**
     * @cache access
     * 清空监听器注册表.
     */
    clear(): void {
        this._listeners.clear();
    }
}
