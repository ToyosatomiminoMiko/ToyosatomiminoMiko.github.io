import { EventBus } from '../service/EventBus';
import type { MathLabEvents } from '../types';
import type { ExpressionManager } from '../core/ExpressionManager';
import type { ColorManager } from '../config/appConfig';

/**
 * 表达式输入框控制器
 */
export class ExprInputController {
    eventBus: EventBus<MathLabEvents>;
    exprManager: ExpressionManager;
    colorManager: ColorManager;

    exprInput: HTMLInputElement;
    exprTypeSelect: HTMLSelectElement;
    colorPicker: HTMLInputElement;
    addBtn: HTMLButtonElement;
    dimensionHint: HTMLElement;

    constructor(
        eventBus: EventBus<MathLabEvents>,
        exprManager: ExpressionManager,
        colorManager: ColorManager,
    ) {
        this.eventBus = eventBus;
        this.exprManager = exprManager;
        this.colorManager = colorManager;

        this.exprInput = document.getElementById('exprInput') as HTMLInputElement;
        this.exprTypeSelect = document.getElementById('exprTypeSelect') as HTMLSelectElement;
        this.colorPicker = document.getElementById('exprColorPicker') as HTMLInputElement;
        this.addBtn = document.getElementById('addExprBtn') as HTMLButtonElement;
        this.dimensionHint = document.getElementById('dimensionHint')!;

        this._bindEvents();
        this._updateDimensionHint();
    }

    private _bindEvents(): void {
        this.addBtn.addEventListener('click', () => this._handleAdd());
        this.exprInput.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter') this._handleAdd();
        });
        this.exprTypeSelect.addEventListener('change', () => this._updateDimensionHint());
    }

    private _updateDimensionHint(): void {
        const type = this.exprTypeSelect.value;
        this.dimensionHint.textContent =
            type === '2d'
                ? '（一元函数 y = f(x)）'
                : '（二元函数 z = f(x, y)）';
    }

    private _handleAdd(): void {
        const fnStr = this.exprInput.value.trim();
        if (!fnStr) {
            this.exprInput.focus();
            return;
        }

        const type = this.exprTypeSelect.value as '2d' | '3d';
        const color = this.colorPicker.value;
        const expr = this.exprManager.add(type, fnStr, color);

        this.exprInput.value = '';
        this.exprInput.focus();
        this.eventBus.emit('expr:added', { expr });
    }
}