import { EventBus } from '../service/EventBus';
import type { MathLabEvents } from '../types';
import type { ExpressionManager } from '../core/ExpressionManager';

/**
 * 求导 UI 组件:事件委托方式监听 #exprList 内的求导按钮
 */
export class DerivativePanel {
    eventBus: EventBus<MathLabEvents>;
    exprManager: ExpressionManager;
    exprListEl: HTMLElement;

    constructor(eventBus: EventBus<MathLabEvents>, exprManager: ExpressionManager) {
        this.eventBus = eventBus;
        this.exprManager = exprManager;
        this.exprListEl = document.getElementById('exprList')!;

        // 事件委托:点击任意 [data-action="derive"] 按钮
        this.exprListEl.addEventListener('click', (e: Event) => {
            const target = e.target as HTMLElement;
            const btn = target.closest('[data-action="derive"]') as HTMLElement | null;
            if (!btn) return;
            e.stopPropagation();

            const id = parseInt(btn.dataset.id!);
            const variable = btn.dataset.var!;
            try {
                const derivExpr = this.exprManager.deriveExpr(id, variable as 'x' | 'y');
                this.eventBus.emit('expr:added', { expr: derivExpr });
            } catch (err) {
                alert(`求导失败: ${(err as Error).message}`);
            }
        });
    }
}