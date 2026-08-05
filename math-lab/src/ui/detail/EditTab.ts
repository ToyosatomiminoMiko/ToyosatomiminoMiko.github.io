import type { Tab } from './Tab';
import type { MathObject } from '../../math_objects/types';
import type { MathObjectManager } from '../../math_objects/MathObjectManager';
import type { EventBus } from '../../service/EventBus';
import type { MathLabEvents } from '../../types';
import { SliderBinding } from './SliderBinding';
import { escapeHtml } from './utils';

export class EditTab implements Tab {
    private _container: HTMLElement;
    private _objectManager: MathObjectManager;
    private _eventBus: EventBus<MathLabEvents>;
    private _sliderCleanups: (() => void)[] = [];
    private _coeffDebounceTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(
        container: HTMLElement,
        objectManager: MathObjectManager,
        eventBus: EventBus<MathLabEvents>,
    ) {
        this._container = container;
        this._objectManager = objectManager;
        this._eventBus = eventBus;
    }

    isVisible(kind: string | null): boolean {
        return true; // 编辑标签页对所有类型可见
    }

    render(obj: MathObject): void {
        this._container.innerHTML = this._buildHtml(obj);
        this._bindEvents(obj);
    }

    destroy(): void {
        for (const cleanup of this._sliderCleanups) cleanup();
        this._sliderCleanups = [];
        if (this._coeffDebounceTimer) {
            clearTimeout(this._coeffDebounceTimer);
            this._coeffDebounceTimer = null;
        }
    }

    // ============================================================
    //  HTML 构建
    // ============================================================

    private _buildHtml(obj: MathObject): string {
        let html = '';

        // 表达式编辑框（仅 curve / surface）
        if (obj.kind === 'curve' || obj.kind === 'surface') {
            html += `
                <div class="edit-row">
                    <input type="text" class="edit-input"
                           value="${escapeHtml(obj.node.toString())}"
                           spellcheck="false" id="detailEditInput" />
                    <button class="update-btn" id="detailUpdateBtn">🔄</button>
                </div>
                <div class="color-row" style="margin-top:8px;">
                    <label>颜色</label>
                    <input type="color" class="color-input"
                           value="${obj.color}" id="detailColorInput" />
                </div>`;
        }

        // 点坐标编辑
        if (obj.kind === 'point') {
            html += `
                <div class="color-row" style="margin-bottom:8px;">
                    <label>颜色</label>
                    <input type="color" class="color-input"
                           value="${obj.color}" id="detailColorInput" />
                </div>
                <div class="coeff-sliders">
                    <div class="coeff-row">
                        <label>x</label>
                        <input type="range" min="-10" max="10" step="0.1"
                               value="${obj.x}" data-coeff="x" class="coeff-slider" />
                        <input type="number" class="coeff-value"
                               value="${obj.x.toFixed(2)}" step="0.1" min="-10" max="10"
                               data-coeff="x" />
                    </div>
                    <div class="coeff-row">
                        <label>y</label>
                        <input type="range" min="-10" max="10" step="0.1"
                               value="${obj.y}" data-coeff="y" class="coeff-slider" />
                        <input type="number" class="coeff-value"
                               value="${obj.y.toFixed(2)}" step="0.1" min="-10" max="10"
                               data-coeff="y" />
                    </div>
                    <div class="coeff-row">
                        <label>z</label>
                        <input type="range" min="-10" max="10" step="0.1"
                               value="${obj.z}" data-coeff="z" class="coeff-slider" />
                        <input type="number" class="coeff-value"
                               value="${obj.z.toFixed(2)}" step="0.1" min="-10" max="10"
                               data-coeff="z" />
                    </div>
                </div>`;
        }

        // 向量编辑
        if (obj.kind === 'vector') {
            html += `
                <div class="color-row" style="margin-bottom:8px;">
                    <label>颜色</label>
                    <input type="color" class="color-input"
                           value="${obj.color}" id="detailColorInput" />
                </div>
                <div class="coeff-sliders">
                    <div class="coeff-row">
                        <label>dx</label>
                        <input type="range" min="-5" max="5" step="0.1"
                               value="${obj.direction.x}" data-coeff="dx" class="coeff-slider" />
                        <input type="number" class="coeff-value"
                               value="${obj.direction.x.toFixed(2)}" step="0.1" min="-5" max="5"
                               data-coeff="dx" />
                    </div>
                    <div class="coeff-row">
                        <label>dy</label>
                        <input type="range" min="-5" max="5" step="0.1"
                               value="${obj.direction.y}" data-coeff="dy" class="coeff-slider" />
                        <input type="number" class="coeff-value"
                               value="${obj.direction.y.toFixed(2)}" step="0.1" min="-5" max="5"
                               data-coeff="dy" />
                    </div>
                    <div class="coeff-row">
                        <label>dz</label>
                        <input type="range" min="-5" max="5" step="0.1"
                               value="${obj.direction.z}" data-coeff="dz" class="coeff-slider" />
                        <input type="number" class="coeff-value"
                               value="${obj.direction.z.toFixed(2)}" step="0.1" min="-5" max="5"
                               data-coeff="dz" />
                    </div>
                    <div class="coeff-row">
                        <label>ox</label>
                        <input type="range" min="-10" max="10" step="0.1"
                               value="${obj.origin.x}" data-coeff="ox" class="coeff-slider" />
                        <input type="number" class="coeff-value"
                               value="${obj.origin.x.toFixed(2)}" step="0.1" min="-10" max="10"
                               data-coeff="ox" />
                    </div>
                    <div class="coeff-row">
                        <label>oy</label>
                        <input type="range" min="-10" max="10" step="0.1"
                               value="${obj.origin.y}" data-coeff="oy" class="coeff-slider" />
                        <input type="number" class="coeff-value"
                               value="${obj.origin.y.toFixed(2)}" step="0.1" min="-10" max="10"
                               data-coeff="oy" />
                    </div>
                    <div class="coeff-row">
                        <label>oz</label>
                        <input type="range" min="-10" max="10" step="0.1"
                               value="${obj.origin.z}" data-coeff="oz" class="coeff-slider" />
                        <input type="number" class="coeff-value"
                               value="${obj.origin.z.toFixed(2)}" step="0.1" min="-10" max="10"
                               data-coeff="oz" />
                    </div>
                </div>`;
        }

        // 系数滑块（仅 curve / surface）
        if ((obj.kind === 'curve' || obj.kind === 'surface') && obj.coefficients.length > 0) {
            html += '<div class="coeff-sliders">';
            for (const c of obj.coefficients) {
                html += `
                    <div class="coeff-row">
                        <label>${c.name}</label>
                        <input type="range" min="${c.min}" max="${c.max}"
                               step="${c.step}" value="${c.value}"
                               data-coeff="${c.name}"
                               class="coeff-slider" />
                        <input type="number" class="coeff-value"
                               value="${c.value.toFixed(2)}"
                               step="${c.step}" min="${c.min}" max="${c.max}"
                               data-coeff="${c.name}" />
                    </div>`;
            }
            html += '</div>';
        }

        return html;
    }

    // ============================================================
    //  事件绑定
    // ============================================================

    private _bindEvents(obj: MathObject): void {
        // ---- 表达式更新 ----
        const updateBtn = this._container.querySelector<HTMLElement>('#detailUpdateBtn');
        const editInput = this._container.querySelector<HTMLInputElement>('#detailEditInput');
        updateBtn?.addEventListener('click', () => {
            const newRaw = editInput?.value.trim();
            if (!newRaw) return;
            try {
                this._objectManager.updateFn(obj.id, newRaw);
                this._eventBus.emit('mathobj:updated', { id: obj.id });
            } catch (err) {
                alert((err as Error).message);
            }
        });
        editInput?.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter') updateBtn?.click();
        });

        // ---- 颜色 ----
        const colorInput = this._container.querySelector<HTMLInputElement>('#detailColorInput');
        colorInput?.addEventListener('input', () => {
            this._objectManager.updateColor(obj.id, colorInput.value);
            this._eventBus.emit('mathobj:updated', { id: obj.id });
        });

        // ---- 滑块 ----
        if (obj.kind === 'curve' || obj.kind === 'surface') {
            this._sliderCleanups.push(
                SliderBinding.bindAll(this._container, (name, value) => {
                    this._objectManager.setCoefficient(obj.id, name, value);
                    this._debouncedEmitCoefficient(obj.id);
                }),
            );
        } else if (obj.kind === 'point') {
            this._sliderCleanups.push(
                SliderBinding.bindAll(this._container, () => {
                    this._commitPointPosition(obj.id);
                }, { debounceMs: 30 }),
            );
        } else if (obj.kind === 'vector') {
            this._sliderCleanups.push(
                SliderBinding.bindAll(this._container, () => {
                    this._commitVectorTransform(obj.id);
                }, { debounceMs: 30 }),
            );
        }
    }

    // ============================================================
    //  点 / 向量提交（读取当前 DOM 值）
    // ============================================================

    private _commitPointPosition(id: number): void {
        const getVal = (name: string): number => {
            const el = this._container.querySelector(
                `[data-coeff="${name}"].coeff-value`,
            ) as HTMLInputElement | null;
            return parseFloat(el?.value ?? '0');
        };
        this._objectManager.updatePointPosition(id, getVal('x'), getVal('y'), getVal('z'));
        this._debouncedEmitCoefficient(id);
    }

    private _commitVectorTransform(id: number): void {
        const getVal = (name: string): number => {
            const el = this._container.querySelector(
                `[data-coeff="${name}"].coeff-value`,
            ) as HTMLInputElement | null;
            return parseFloat(el?.value ?? '0');
        };
        this._objectManager.updateVectorTransform(
            id,
            getVal('dx'), getVal('dy'), getVal('dz'),
            getVal('ox'), getVal('oy'), getVal('oz'),
        );
        this._debouncedEmitCoefficient(id);
    }

    // ============================================================
    //  工具
    // ============================================================

    private _debouncedEmitCoefficient(id: number): void {
        if (this._coeffDebounceTimer) clearTimeout(this._coeffDebounceTimer);
        this._coeffDebounceTimer = setTimeout(() => {
            this._eventBus.emit('coefficient:changed', { id });
        }, 50);
    }
}