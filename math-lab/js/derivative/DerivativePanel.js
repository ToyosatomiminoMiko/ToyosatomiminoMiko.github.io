/**
 * 求导 UI 组件: 事件委托方式监听 #exprList 内的求导按钮
 */
export class DerivativePanel {
    constructor(eventBus, exprManager) {
        this.eventBus = eventBus;
        this.exprManager = exprManager;
        this.exprListEl = document.getElementById('exprList');

        // 事件委托:点击任意 [data-action="derive"] 按钮
        this.exprListEl.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-action="derive"]');
            if (!btn) return;
            e.stopPropagation();

            const id = parseInt(btn.dataset.id);
            const variable = btn.dataset.var;
            try {
                const derivExpr = this.exprManager.deriveExpr(id, variable);
                this.eventBus.emit('expr:added', { expr: derivExpr });
            } catch (err) {
                alert(`求导失败: ${err.message}`);
            }
        });
    }
}