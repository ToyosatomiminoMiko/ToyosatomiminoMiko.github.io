import { EventBus } from '../service/EventBus';
import type { MathLabEvents, MathObject } from '../types';
import type { MathObjectManager } from '../math_objects';
import type { SelectionManager } from './SelectionManager';

/**
 * 表达式列表渲染器
 * 生成 / 刷新紧凑单行列表 + 处理行点击选中 / 可见性 / 删除
 */
export class ExprListRenderer {
    eventBus: EventBus<MathLabEvents>;
    objectManager: MathObjectManager;
    selectionManager: SelectionManager;
    exprListEl: HTMLElement;

    constructor(
        eventBus: EventBus<MathLabEvents>,
        objectManager: MathObjectManager,
        selectionManager: SelectionManager,
    ) {
        this.eventBus = eventBus;
        this.objectManager = objectManager;
        this.selectionManager = selectionManager;
        this.exprListEl = document.getElementById('exprList')!;

        // 数据变更 -> 重新渲染
        this.eventBus.on('mathobj:added', () => this.render());
        this.eventBus.on('mathobj:removed', () => this.render());
        this.eventBus.on('mathobj:toggled', ({ id }) => this._updateRow(id));
        this.eventBus.on('mathobj:updated', ({ id }) => this._updateRow(id));

        // 选中变化 -> 更新行高亮
        this.eventBus.on('selection:changed', () => this._updateRowHighlight());

        this.render();
    }

    // ============================================================
    //  渲染
    // ============================================================

    render(): void {
        const objects = this.objectManager.getAll();
        if (objects.length === 0) {
            this.exprListEl.innerHTML =
                '<div class="empty-hint">暂无表达式,添加一个吧 ✨</div>';
            return;
        }

        let html = '';
        for (const obj of objects) {
            const label = this._formatLabel(obj);
            const isVisible = obj.enabled;
            const toggleIcon = isVisible ? '1' : '0';
            const toggleTitle = isVisible ? 'hide' : 'show';
            const typeBadge = this._typeBadge(obj.kind);
            const escapedLabel = this._escapeHtml(label);

            html += `
                <div class="expr-item"
                     data-id="${obj.id}"
                     data-kind="${obj.kind}">
                    <span class="color-dot"
                          style="background:${obj.color};"></span>
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
     * 增量更新单行:仅更新标签文本,颜色点,可见性按钮
     * 避免全量 innerHTML 重建
     */
    private _updateRow(id: number): void {
        const row = this.exprListEl.querySelector(`.expr-item[data-id="${id}"]`) as HTMLElement | null;
        if (!row) {
            // 行不存在(可能刚添加),回退到全量渲染
            this.render();
            return;
        }

        const obj = this.objectManager.getById(id);
        if (!obj) {
            // 对象已删除
            this.render();
            return;
        }

        // 更新标签文本
        const labelEl = row.querySelector('.expr-label') as HTMLElement | null;
        if (labelEl) {
            const newLabel = this._formatLabel(obj);
            labelEl.textContent = newLabel;  // textContent 自动处理转义
            labelEl.title = newLabel;
        }

        // 更新颜色点
        const dotEl = row.querySelector('.color-dot') as HTMLElement | null;
        if (dotEl) {
            dotEl.style.background = obj.color;
        }

        // 更新可见性按钮
        const toggleBtn = row.querySelector('[data-action="toggle"]') as HTMLElement | null;
        if (toggleBtn) {
            const isVisible = obj.enabled;
            toggleBtn.textContent = isVisible ? '1' : '0';
            toggleBtn.title = isVisible ? 'hide' : 'show';
        }
    }

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

    private _bindItemEvents(): void {
        this.exprListEl.querySelectorAll('.expr-item').forEach(item => {
            const el = item as HTMLElement;
            const id = parseInt(el.dataset.id!);
            const kind = el.dataset.kind!;

            // 行点击 -> 选中
            el.addEventListener('click', (e: Event) => {
                if ((e.target as HTMLElement).closest('button')) return;
                this.selectionManager.select(id, kind);
            });

            // 可见性切换
            const toggleBtn = el.querySelector('[data-action="toggle"]') as HTMLElement | null;
            toggleBtn?.addEventListener('click', (e: Event) => {
                e.stopPropagation();
                const enabled = this.objectManager.toggle(id);
                this.eventBus.emit('mathobj:toggled', { id, enabled });
            });

            // 删除
            const delBtn = el.querySelector('[data-action="delete"]') as HTMLElement | null;
            delBtn?.addEventListener('click', (e: Event) => {
                e.stopPropagation();
                const selected = this.selectionManager.getSelected();
                if (selected && selected.id === id) {
                    this.selectionManager.deselect();
                }
                this.objectManager.remove(id);
                this.eventBus.emit('mathobj:removed', { id });
            });
        });
    }

    // ============================================================
    //  标签格式化
    // ============================================================

    private _formatLabel(obj: MathObject): string {
        switch (obj.kind) {
            case 'curve':
                return `y = ${obj.node.toString()}`;
            case 'surface':
                return `z = ${obj.node.toString()}`;
            case 'point':
                return `Point(${obj.x.toFixed(1)}, ${obj.y.toFixed(1)}, ${obj.z.toFixed(1)})`;
            case 'vector':
                return `Vector(${obj.direction.x.toFixed(1)},${obj.direction.y.toFixed(1)},${obj.direction.z.toFixed(1)})@(${obj.origin.x.toFixed(1)},${obj.origin.y.toFixed(1)},${obj.origin.z.toFixed(1)})`;
            case 'vector_field':
                return `F = [${obj.components.join(', ')}]`;
        }
    }

    private _typeBadge(kind: string): string {
        switch (kind) {
            case 'curve': return '2D';
            case 'surface': return '3D';
            case 'point': return 'P';
            case 'vector': return 'Vec';
            case 'vector_field': return 'VF';
            default: return kind;
        }
    }

    private _escapeHtml(str: string): string {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
}