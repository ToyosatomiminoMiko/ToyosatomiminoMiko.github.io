export class ExprListRenderer {
    /**
     * @param {import('../service/EventBus.js').EventBus} eventBus
     * @param {import('../core/ExpressionManager.js').ExpressionManager} exprManager
     */
    constructor(eventBus, exprManager) {
        this.eventBus = eventBus;
        this.exprManager = exprManager;
        this.exprListEl = document.getElementById('exprList');
        this._expandedIds = new Set();    // 跟踪展开的表达式 id
        this._debounceTimers = {};
        // 监听事件触发重新渲染
        this.eventBus.on('expr:added', () => this.render());
        this.eventBus.on('expr:removed', () => this.render());
        this.eventBus.on('expr:toggled', () => this.render());
        this.eventBus.on('expr:updated', () => this.render());
        this.eventBus.on('mode:changed', () => this.render());

        // 初始渲染
        this.render();
    }

    _debouncedEmitCoefficient(id) {
        if (this._debounceTimers[id]) clearTimeout(this._debounceTimers[id]);
        this._debounceTimers[id] = setTimeout(() => {
            this.eventBus.emit('coefficient:changed', { id });
        }, 50);
    }

    _escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
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
            const label = is2D
                ? `y = ${expr.node.toString()}`
                : `z = ${expr.node.toString()}`;
            const toggleIcon = isVisible ? '1' : '0';
            const toggleClass = isVisible ? 'on' : '';
            const expanded = this._expandedIds.has(expr.id);
            const detailClass = expanded ? 'show' : '';

            // 系数滑块 HTML
            let coeffHtml = '';
            if (expr.coefficients && expr.coefficients.length > 0) {
                coeffHtml += '<div class="coeff-sliders">';
                for (const c of expr.coefficients) {
                    coeffHtml += `
                        <div class="coeff-row">
                            <label>${c.name}</label>
                            <input type="range" min="${c.min}" max="${c.max}"
                                step="${c.step}" value="${c.value}"
                                data-id="${expr.id}" data-coeff="${c.name}" />
                            <span class="coeff-value">${c.value.toFixed(1)}</span>
                        </div>`;
                }
                coeffHtml += '</div>';
            }

            html += `
                <div class="expr-item" data-id="${expr.id}">
                    <!-- 头行:始终可见 -->
                    <div class="expr-header">
                        <span class="color-dot" style="background:${expr.color};"></span>
                        <span class="expr-label" title="${label}">${label}</span>
                        <span class="integral-result">S=---</span>
                        <span class="expr-type">${is2D ? '2D' : '3D'}</span>
                        <button class="toggle-btn ${toggleClass}"
                            data-action="toggle" title="显示/隐藏">${toggleIcon}</button>
                        <button class="del-btn"
                            data-action="delete" title="删除">❌</button>
                    </div>
                    <!-- 折叠详情面板 -->
                    <div class="expr-detail ${detailClass}">
                        ${coeffHtml}
                        <div class="edit-row">
                            <input type="text" class="edit-input"
                                value="${this._escapeHtml(expr.node.toString())}"
                                spellcheck="false" />
                            <button class="update-btn" data-action="update">更新</button>
                        </div>
                        <div class="color-row">
                            <label>颜色</label>
                            <input type="color" class="color-input"
                                value="${expr.color}" data-action="color" />
                        </div>
                    </div>
                </div>`;
        }
        this.exprListEl.innerHTML = html;
        this._bindItemEvents();
    }



    _bindItemEvents() {
        this.exprListEl.querySelectorAll('.expr-item').forEach(item => {
            const id = parseInt(item.dataset.id);
            // 头行单击展开/折叠
            item.querySelector('.expr-header')?.addEventListener('click', (e) => {
                // 按钮除外
                if (e.target.closest('button')) return;
                if (this._expandedIds.has(id)) {
                    this._expandedIds.delete(id);
                } else {
                    this._expandedIds.add(id);
                }
                this.render(); // 重新渲染以更新面板状态
            });
            // click:单击;dblclick:双击
            // 可见性
            item.querySelector('[data-action="toggle"]')?.addEventListener('click', (e) => {
                e.stopPropagation();
                const enabled = this.exprManager.toggle(id);
                this.eventBus.emit('expr:toggled', { id, enabled });
            });
            // 删除
            item.querySelector('[data-action="delete"]')?.addEventListener('click', (e) => {
                e.stopPropagation();
                this.exprManager.remove(id);
                this.eventBus.emit('expr:removed', { id });
            });
            // 系数滑块事件
            item.querySelectorAll('.coeff-sliders input[type="range"]').forEach(slider => {
                slider.addEventListener('input', (e) => {
                    const id = parseInt(slider.dataset.id);
                    const coeffName = slider.dataset.coeff;
                    const newValue = parseFloat(slider.value);
                    // 更新数值显示
                    const valSpan = slider.parentElement.querySelector('.coeff-value');
                    if (valSpan) valSpan.textContent = newValue.toFixed(1);
                    // 更新数据层
                    this.exprManager.setCoefficient(id, coeffName, newValue);
                    // 通知重绘(防抖 50ms)
                    this._debouncedEmitCoefficient(id);
                });
            });
            // 更新表达式
            item.querySelector('[data-action="update"]')?.addEventListener('click', (e) => {
                e.stopPropagation();
                const input = item.querySelector('.edit-input');
                const newRaw = input?.value.trim();
                if (!newRaw) return;
                try {
                    this.exprManager.updateFn(id, newRaw);
                    this.eventBus.emit('expr:updated', { id, fnStr: newRaw });
                } catch (err) {
                    alert(err.message);
                }
            });

            // 回车更新
            item.querySelector('.edit-input')?.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    const updateBtn = item.querySelector('[data-action="update"]');
                    updateBtn?.click();
                }
                e.stopPropagation();
            });
            // 颜色更新
            item.querySelector('.color-input')?.addEventListener('input', (e) => {
                e.stopPropagation();
                const newColor = e.target.value;
                this.exprManager.updateColor(id, newColor);
                // 同步更新头行颜色圆点
                const dot = item.querySelector('.color-dot');
                if (dot) dot.style.background = newColor;
                // 通知画布重建(颜色变了要重建 Line 材质)
                e.stopPropagation();
                this.eventBus.emit('expr:updated', { id });
            });

            // 系数滑块
            item.querySelectorAll('.coeff-sliders input[type="range"]').forEach(slider => {
                slider.addEventListener('input', (e) => {
                    e.stopPropagation();
                    const coeffName = slider.dataset.coeff;
                    const newValue = parseFloat(slider.value);
                    const valSpan = slider.parentElement.querySelector('.coeff-value');
                    if (valSpan) valSpan.textContent = newValue.toFixed(1);
                    this.exprManager.setCoefficient(id, coeffName, newValue);
                    this._debouncedEmitCoefficient(id);
                });
            });
        });
    }

}