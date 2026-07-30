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
                    data-id="${expr.id}" data-coeff="${c.name}"
                    class="coeff-slider" />
                <input type="number" class="coeff-value"
                    value="${c.value.toFixed(1)}"
                    step="${c.step}" min="${c.min}" max="${c.max}"
                    data-id="${expr.id}" data-coeff="${c.name}" />
            </div>`;
                }
                coeffHtml += '</div>';
            }

            // 求导按钮行
            let derivHtml = '';
            if (is2D) {
                derivHtml = `
                    <div class="deriv-row">
                        <span class="deriv-label">导</span>
                        <button class="deriv-btn" data-action="derive"
                            data-id="${expr.id}" data-var="x">d/dx</button>
                    </div>`;
            } else {
                derivHtml = `
                    <div class="deriv-row">
                        <span class="deriv-label">偏导</span>
                        <button class="deriv-btn" data-action="derive"
                            data-id="${expr.id}" data-var="x">∂/∂x</button>
                        <button class="deriv-btn" data-action="derive"
                            data-id="${expr.id}" data-var="y">∂/∂y</button>
                    </div>`;
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
                            data-action="toggle" title="fold/unfold">${toggleIcon}</button>
                        <button class="del-btn"
                            data-action="delete" title="delete">🗑️</button>
                    </div>
                    <!-- 折叠详情面板 -->
                    <div class="expr-detail ${detailClass}">
                        ${coeffHtml}${derivHtml}
                        <div class="edit-row">
                            <input type="text" class="edit-input"
                                value="${this._escapeHtml(expr.node.toString())}"
                                spellcheck="false" />
                            <button class="update-btn" data-action="update">🔄</button>
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
            item.querySelectorAll('.coeff-row').forEach(row => {
                const slider = row.querySelector('input[type="range"]');
                const numInput = row.querySelector('input[type="number"]');
                if (!slider || !numInput) return;

                // 滑块拖拽 -> 同步数字 + 更新数据
                slider.addEventListener('input', () => {
                    const val = parseFloat(slider.value);
                    numInput.value = val.toFixed(2);
                    const id = parseInt(slider.dataset.id);
                    const coeffName = slider.dataset.coeff;
                    this.exprManager.setCoefficient(id, coeffName, val);
                    this._debouncedEmitCoefficient(id);
                });

                // 数字手动输入 -> 同步滑块 + 更新数据
                numInput.addEventListener('input', () => {
                    let val = parseFloat(numInput.value);
                    if (isNaN(val)) return;
                    // 钳制范围
                    val = Math.max(parseFloat(slider.min), Math.min(parseFloat(slider.max), val));
                    slider.value = val;
                    const id = parseInt(numInput.dataset.id);
                    const coeffName = numInput.dataset.coeff;
                    this.exprManager.setCoefficient(id, coeffName, val);
                    this._debouncedEmitCoefficient(id); // 防抖
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
                this.eventBus.emit('expr:updated', { id });
            });


        });
    }

}