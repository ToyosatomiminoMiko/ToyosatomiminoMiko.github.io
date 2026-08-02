import { EventBus } from '../service/EventBus';
import type { MathLabEvents, Expression } from '../types';
import type { ExpressionManager } from '../core/ExpressionManager';

/**
 * 表达式列表渲染器
 * 负责生成 / 刷新左侧面板中的表达式列表 HTML
 */
export class ExprListRenderer {
    eventBus: EventBus<MathLabEvents>;
    exprManager: ExpressionManager;
    exprListEl: HTMLElement;
    private _expandedIds: Set<number>;
    private _debounceTimers: Record<number, ReturnType<typeof setTimeout>>;

    constructor(eventBus: EventBus<MathLabEvents>, exprManager: ExpressionManager) {
        this.eventBus = eventBus;
        this.exprManager = exprManager;
        this.exprListEl = document.getElementById('exprList')!;
        this._expandedIds = new Set();
        this._debounceTimers = {};

        // 监听事件触发重新渲染
        this.eventBus.on('expr:added', () => this.render());
        this.eventBus.on('expr:removed', () => this.render());
        this.eventBus.on('expr:toggled', () => this.render());
        this.eventBus.on('expr:updated', () => this.render());
        this.eventBus.on('mode:changed', () => this.render());

        this.render();
    }

    private _debouncedEmitCoefficient(id: number): void {
        if (this._debounceTimers[id]) clearTimeout(this._debounceTimers[id]);
        this._debounceTimers[id] = setTimeout(() => {
            this.eventBus.emit('coefficient:changed', { id });
        }, 50);
    }

    private _escapeHtml(str: string): string {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    render(): void {
        const exprs = this.exprManager.getAll();
        if (exprs.length === 0) {
            this.exprListEl.innerHTML =
                '<div class="empty-hint">暂无表达式，添加一个吧 ✨</div>';
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
                    <div class="expr-header">
                        <span class="color-dot" style="background:${expr.color};"></span>
                        <span class="expr-label" title="${label}">${label}</span>
                        <span class="integral-result">S=---</span>
                        <span class="expr-type">${is2D ? '2D' : '3D'}</span>
                        <button class="toggle-btn ${toggleClass}"
                            data-action="toggle" title="折叠/展开">${toggleIcon}</button>
                        <button class="del-btn"
                            data-action="delete" title="删除">🗑️</button>
                    </div>
                    <div class="expr-detail ${detailClass}">
                        <div class="edit-row">
                            <input type="text" class="edit-input"
                                value="${this._escapeHtml(expr.node.toString())}"
                                spellcheck="false" />
                            <button class="update-btn" data-action="update">🔄</button>
                        </div>
                        <div class="deriv-color-row">
                            ${derivHtml}
                            <div class="color-row">
                                <label>颜色</label>
                                <input type="color" class="color-input"
                                    value="${expr.color}" />
                            </div>
                        </div>
                        ${coeffHtml}
                    </div>
                </div>`;
        }
        this.exprListEl.innerHTML = html;
        this._bindItemEvents();
    }

    private _bindItemEvents(): void {
        this.exprListEl.querySelectorAll('.expr-item').forEach(item => {
            const id = parseInt((item as HTMLElement).dataset.id!);
            const htmlItem = item as HTMLElement;

            // 头行单击展开/折叠
            const header = htmlItem.querySelector('.expr-header') as HTMLElement | null;
            header?.addEventListener('click', (e: Event) => {
                if ((e.target as HTMLElement).closest('button')) return;
                if (this._expandedIds.has(id)) {
                    this._expandedIds.delete(id);
                } else {
                    this._expandedIds.add(id);
                }
                this.render();
            });

            // 可见性切换
            const toggleBtn = htmlItem.querySelector('[data-action="toggle"]') as HTMLElement | null;
            toggleBtn?.addEventListener('click', (e: Event) => {
                e.stopPropagation();
                const enabled = this.exprManager.toggle(id);
                this.eventBus.emit('expr:toggled', { id, enabled });
            });

            // 删除
            const delBtn = htmlItem.querySelector('[data-action="delete"]') as HTMLElement | null;
            delBtn?.addEventListener('click', (e: Event) => {
                e.stopPropagation();
                this.exprManager.remove(id);
                this.eventBus.emit('expr:removed', { id });
            });

            // 系数滑块
            htmlItem.querySelectorAll('.coeff-row').forEach(row => {
                const slider = row.querySelector('input[type="range"]') as HTMLInputElement | null;
                const numInput = row.querySelector('input[type="number"]') as HTMLInputElement | null;
                if (!slider || !numInput) return;

                slider.addEventListener('input', () => {
                    const val = parseFloat(slider.value);
                    numInput.value = val.toFixed(2);
                    const coeffName = slider.dataset.coeff!;
                    this.exprManager.setCoefficient(id, coeffName, val);
                    this._debouncedEmitCoefficient(id);
                });

                numInput.addEventListener('input', () => {
                    let val = parseFloat(numInput.value);
                    if (isNaN(val)) return;
                    val = Math.max(
                        parseFloat(slider.min),
                        Math.min(parseFloat(slider.max), val),
                    );
                    slider.value = String(val);
                    const coeffName = numInput.dataset.coeff!;
                    this.exprManager.setCoefficient(id, coeffName, val);
                    this._debouncedEmitCoefficient(id);
                });
            });

            // 更新表达式
            const updateBtn = htmlItem.querySelector('[data-action="update"]') as HTMLElement | null;
            updateBtn?.addEventListener('click', (e: Event) => {
                e.stopPropagation();
                const input = htmlItem.querySelector('.edit-input') as HTMLInputElement | null;
                const newRaw = input?.value.trim();
                if (!newRaw) return;
                try {
                    this.exprManager.updateFn(id, newRaw);
                    this.eventBus.emit('expr:updated', { id, fnStr: newRaw });
                } catch (err) {
                    alert((err as Error).message);
                }
            });

            // 回车更新
            const editInput = htmlItem.querySelector('.edit-input') as HTMLInputElement | null;
            editInput?.addEventListener('keydown', (e: KeyboardEvent) => {
                if (e.key === 'Enter') {
                    updateBtn?.click();
                }
                e.stopPropagation();
            });

            // 颜色更新
            const colorInput = htmlItem.querySelector('.color-input') as HTMLInputElement | null;
            colorInput?.addEventListener('input', (e: Event) => {
                e.stopPropagation();
                const newColor = (e.target as HTMLInputElement).value;
                this.exprManager.updateColor(id, newColor);
                const dot = htmlItem.querySelector('.color-dot') as HTMLElement | null;
                if (dot) dot.style.background = newColor;
                this.eventBus.emit('expr:updated', { id, fnStr: '' });
            });
        });
    }
}