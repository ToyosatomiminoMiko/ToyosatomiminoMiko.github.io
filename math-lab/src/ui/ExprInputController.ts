import { EventBus } from '../service/EventBus';
import type { MathLabEvents } from '../types';
import type { MathObjectManager } from '../math_objects';
import type { ColorManager } from '../math_objects';
import { notifyError } from './error';

/**
 * 表达式输入框控制器
 * 新增:📍 添加点按钮逻辑
 */
export class ExprInputController {
    eventBus: EventBus<MathLabEvents>;
    objectManager: MathObjectManager;
    colorManager: ColorManager;

    exprInput: HTMLInputElement;
    exprTypeSelect: HTMLSelectElement;
    colorPicker: HTMLInputElement;
    addBtn: HTMLButtonElement;
    addPointBtn: HTMLButtonElement;
    dimensionHint: HTMLElement;

    constructor(
        eventBus: EventBus<MathLabEvents>,
        objectManager: MathObjectManager,
        colorManager: ColorManager,
    ) {
        this.eventBus = eventBus;
        this.objectManager = objectManager;
        this.colorManager = colorManager;

        this.exprInput = document.getElementById('exprInput') as HTMLInputElement;
        this.exprTypeSelect = document.getElementById('exprTypeSelect') as HTMLSelectElement;
        this.colorPicker = document.getElementById('exprColorPicker') as HTMLInputElement;
        this.addBtn = document.getElementById('addExprBtn') as HTMLButtonElement;
        this.addPointBtn = document.getElementById('addPointBtn') as HTMLButtonElement;
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
        this.addPointBtn.addEventListener('click', () => this._handleAddPoint());
    }

    private _updateDimensionHint(): void {
        const type = this.exprTypeSelect.value;
        if (type === 'vector_field') {
            this.dimensionHint.textContent = '向量场 F(x,y,z) = [P, Q, R]，分量用逗号分隔';
            return;
        }
        this.dimensionHint.textContent =
            type === '2d'
                ? '一元函数 y = f(x)'
                : '二元函数 z = f(x, y)';
    }

    private _handleAdd(): void {
        const fnStr = this.exprInput.value.trim();
        if (!fnStr) {
            this.exprInput.focus();
            return;
        }

        const type = this.exprTypeSelect.value as '2d' | '3d' | 'vector_field';
        const color = this.colorPicker.value;

        let object;

        if (type === 'vector_field') {
            const parts = fnStr.split(',').map(s => s.trim());
            if (parts.length !== 3) {
                notifyError('向量场需要三个分量,用逗号分隔:P, Q, R\n例如: y, -x, 0');
                return;
            }
            object = this.objectManager.addVectorField(
                parts as [string, string, string],
                undefined, undefined, color,
            );
        } else {
            object = type === '2d'
                ? this.objectManager.addCurve(fnStr, color)
                : this.objectManager.addSurface(fnStr, color);
        }

        this.exprInput.value = '';
        this.exprInput.focus();
        this.eventBus.emit('mathobj:added', { object });
    }

    private _handleAddPoint(): void {
        const object = this.objectManager.addPoint(0, 0, 0);
        this.eventBus.emit('mathobj:added', { object });
    }
}
