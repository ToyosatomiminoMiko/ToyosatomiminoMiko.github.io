/**
 * 泛型事件总线 — 跨层通信的桥梁
 * Core 层和 UI 层通过 EventBus 通信,互不直接引用
 *
 * 使用方式:
 *   const bus = new EventBus<MathLabEvents>();
 *   bus.on('expr:added', ({ expr }) => { ... });   // expr 自动推断为 Expression
 *   bus.emit('expr:added', { expr });              // 第二个参数类型受约束
 */
export class EventBus<Events extends Record<string, any>> {
    private _listeners: Map<keyof Events, Array<(data: any) => void>>;

    constructor() {
        this._listeners = new Map();
    }

    /**
     * 订阅事件
     * @returns 取消订阅函数
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
    emit<K extends keyof Events>(event: K, data: Events[K]): void {
        const cbs = this._listeners.get(event);
        if (cbs) {
            cbs.forEach(cb => {
                try {
                    cb(data);
                } catch (e) {
                    console.error(`[EventBus] ${String(event)} 回调出错:`, e);
                }
            });
        }
    }

    /** 清空所有监听 用于销毁/重置 */
    clear(): void {
        this._listeners.clear();
    }
}