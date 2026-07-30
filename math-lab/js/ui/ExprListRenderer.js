export class ExprListRenderer {
    /**
     * @param {import('../service/EventBus.js').EventBus} eventBus
     * @param {import('../core/ExpressionManager.js').ExpressionManager} exprManager
     */
    constructor(eventBus, exprManager) {
        this.eventBus = eventBus;
        this.exprManager = exprManager;
        this.exprListEl = document.getElementById('exprList');

        // 监听事件触发重新渲染
        this.eventBus.on('expr:added', () => this.render());
        this.eventBus.on('expr:removed', () => this.render());
        this.eventBus.on('expr:toggled', () => this.render());
        this.eventBus.on('expr:updated', () => this.render());
        this.eventBus.on('mode:changed', () => this.render());

        // 初始渲染
        this.render();
    }

    render() {
        const exprs = this.exprManager.getAll();
        if (exprs.length === 0) {
            this.exprListEl.innerHTML =
                '<div class="empty-hint">暂无表达式,添加一个吧 ✨</div>';
            return;
        }

        let html = '';
        for (const expr of exprs) {
            const isVisible = expr.enabled;
            const is2D = expr.type === '2d';
            const label = is2D ? `y = ${expr.node.toString()}` : `z = ${expr.node.toString()}`;
            const toggleIcon = isVisible ? '1' : '0';
            const toggleClass = isVisible ? 'on' : '';

            html += `
        <div class="expr-item" data-id="${expr.id}">
          <span class="color-dot" style="background:${expr.color};"></span>
          <span class="expr-label" title="${label}">${label}</span>
          <span class="integral-result" data-id="${expr.id}">S=---</span>
          <span class="expr-type">${is2D ? '2D' : '3D'}</span>
          <button class="toggle-btn ${toggleClass}"
            data-action="toggle" title="show/hide">${toggleIcon}</button>
          <button class="edit-btn" data-action="edit" title="edit">✏️</button>
          <button class="del-btn" data-action="delete" title="delete">❌</button>
        </div>`;
        }
        this.exprListEl.innerHTML = html;
        this._bindItemEvents();
    }

    _bindItemEvents() {
        this.exprListEl.querySelectorAll('.expr-item').forEach(item => {
            const id = parseInt(item.dataset.id);
            // click:单击;dblclick:双击
            // 可见性
            item.querySelector('[data-action="toggle"]')?.addEventListener('click', (e) => {
                e.stopPropagation();
                const enabled = this.exprManager.toggle(id);
                this.eventBus.emit('expr:toggled', { id, enabled });
            });
            // 编辑
            item.querySelector('[data-action="edit"]')?.addEventListener('click', (e) => {
                e.stopPropagation();
                const expr = this.exprManager.getAll().find(e => e.id === id);
                if (expr) {
                    const newFn = prompt(`编辑表达式 (${expr.type}):`, expr.fnStr);
                    if (newFn !== null && newFn.trim() !== '') {
                        this.exprManager.updateFn(id, newFn.trim());
                        this.eventBus.emit('expr:updated', { id, fnStr: newFn.trim() });
                    }
                }
            });
            // 删除
            item.querySelector('[data-action="delete"]')?.addEventListener('click', (e) => {
                e.stopPropagation();
                this.exprManager.remove(id);
                this.eventBus.emit('expr:removed', { id });
            });
        });
    }
}