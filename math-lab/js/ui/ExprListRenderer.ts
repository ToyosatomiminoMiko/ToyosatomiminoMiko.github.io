import { EventBus } from '../service/EventBus';
import type { MathLabEvents, Expression } from '../types';
import type { ExpressionManager } from '../core/ExpressionManager';
import type { SelectionManager } from '../core/SelectionManager';

/**
 * 表达式列表渲染器（精简版）
 *
 * 职责:生成 / 刷新紧凑单行列表 + 处理行点击选中 / 可见性 / 删除
 * 编辑,系数滑块,求导等功能全部迁移到 DetailPanel 中
 */
export class ExprListRenderer {
    eventBus: EventBus<MathLabEvents>;
    exprManager: ExpressionManager;
    selectionManager: SelectionManager;
    exprListEl: HTMLElement;

    constructor(
        eventBus: EventBus<MathLabEvents>,
        exprManager: ExpressionManager,
        selectionManager: SelectionManager,
    ) {
        this.eventBus = eventBus;
        this.exprManager = exprManager;
        this.selectionManager = selectionManager;
        this.exprListEl = document.getElementById('exprList')!;

        // 数据变更 -> 重新渲染
        this.eventBus.on('expr:added', () => this.render());
        this.eventBus.on('expr:removed', () => this.render());
        this.eventBus.on('expr:toggled', () => this.render());
        this.eventBus.on('expr:updated', () => this.render());

        // 选中变化 -> 更新行高亮
        this.eventBus.on('selection:changed', () => this._updateRowHighlight());

        this.render();
    }

    // ============================================================
    //  渲染
    // ============================================================

    render(): void {
        const exprs = this.exprManager.getAll();
        if (exprs.length === 0) {
            this.exprListEl.innerHTML =
                '<div class="empty-hint">暂无表达式,添加一个吧 ✨</div>';
            return;
        }

        let html = '';
        for (const expr of exprs) {
            const label = this._formatLabel(expr);
            const isVisible = expr.enabled;
            const toggleIcon = isVisible ? '1' : '0';
            const toggleTitle = isVisible ? 'hide' : 'show';
            const typeBadge = this._typeBadge(expr.type);
            const escapedLabel = this._escapeHtml(label);

            html += `
                <div class="expr-item"
                     data-id="${expr.id}"
                     data-type="${expr.type}">
                    <span class="color-dot"
                          style="background:${expr.color};"></span>
                    <span class="expr-label"
                          title="${escapedLabel}">${escapedLabel}</span>
                    <span class="expr-type">${typeBadge}</span>
                    <button class="toggle-btn"
                            data-action="toggle"
                            title="${toggleTitle}">${toggleIcon}</button>
                    <button class="del-btn"
                            data-action="delete"
                            title="delete">🗑</button>
                </div>`;
        }
        this.exprListEl.innerHTML = html;
        this._bindItemEvents();
        this._updateRowHighlight();
    }

    // ============================================================
    //  内部
    // ============================================================

    /**
     * 根据选中状态给对应行添加 .selected class
     */
    private _updateRowHighlight(): void {
        const selected = this.selectionManager.getSelected();
        const items = this.exprListEl.querySelectorAll('.expr-item');
        items.forEach(item => {
            const id = parseInt((item as HTMLElement).dataset.id!);
            if (selected && id === selected.id) {
                item.classList.add('selected');
            } else {
                item.classList.remove('selected');
            }
        });
    }

    /**
     * 事件委托:行点击选中,toggle,删除
     */
    private _bindItemEvents(): void {
        this.exprListEl.querySelectorAll('.expr-item').forEach(item => {
            const el = item as HTMLElement;
            const id = parseInt(el.dataset.id!);
            const type = el.dataset.type!;

            // 行点击 -> 选中
            el.addEventListener('click', (e: Event) => {
                // 如果点在按钮上,不走选中逻辑
                if ((e.target as HTMLElement).closest('button')) return;
                this.selectionManager.select(id, type);
            });

            // 可见性切换
            const toggleBtn = el.querySelector('[data-action="toggle"]') as HTMLElement | null;
            toggleBtn?.addEventListener('click', (e: Event) => {
                e.stopPropagation();
                const enabled = this.exprManager.toggle(id);
                this.eventBus.emit('expr:toggled', { id, enabled });
            });

            // 删除
            const delBtn = el.querySelector('[data-action="delete"]') as HTMLElement | null;
            delBtn?.addEventListener('click', (e: Event) => {
                e.stopPropagation();
                // 如果删除的是当前选中实体,先取消选中
                const selected = this.selectionManager.getSelected();
                if (selected && selected.id === id) {
                    this.selectionManager.deselect();
                }
                this.exprManager.remove(id);
                this.eventBus.emit('expr:removed', { id });
            });
        });
    }

    /**
     * 根据类型生成紧凑显示标签
     */
    private _formatLabel(expr: Expression): string {
        switch (expr.type) {
            case '2d':
                return `y = ${expr.node.toString()}`;
            case '3d':
                return `z = ${expr.node.toString()}`;
            case 'point': {
                const x = expr.coefficients.find(c => c.name === 'x')?.value ?? 0;
                const y = expr.coefficients.find(c => c.name === 'y')?.value ?? 0;
                const z = expr.coefficients.find(c => c.name === 'z')?.value ?? 0;
                return `📍 P(${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)})`;
            }
            case 'vector': {
                const dx = expr.coefficients.find(c => c.name === 'dx')?.value ?? 0;
                const dy = expr.coefficients.find(c => c.name === 'dy')?.value ?? 0;
                const dz = expr.coefficients.find(c => c.name === 'dz')?.value ?? 0;
                const ox = expr.coefficients.find(c => c.name === 'ox')?.value ?? 0;
                const oy = expr.coefficients.find(c => c.name === 'oy')?.value ?? 0;
                const oz = expr.coefficients.find(c => c.name === 'oz')?.value ?? 0;
                return `➡️ v⃗(${dx.toFixed(1)},${dy.toFixed(1)},${dz.toFixed(1)})@(${ox.toFixed(1)},${oy.toFixed(1)},${oz.toFixed(1)})`;
            }
            default:
                return expr.node.toString();
        }
    }

    /**
     * 类型徽章文字
     */
    private _typeBadge(type: string): string {
        switch (type) {
            case '2d': return '2D';
            case '3d': return '3D';
            case 'point': return '📍';
            case 'vector': return '➡️';
            default: return type;
        }
    }

    private _escapeHtml(str: string): string {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
}