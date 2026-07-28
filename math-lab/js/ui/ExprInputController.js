/*
表达式输入框
*/

export class ExprInputController {
    /**
     * @param {import('../service/EventBus.js').EventBus} eventBus
     * @param {import('../core/ExpressionManager.js').ExpressionManager} exprManager
     * @param {import('../config/appConfig.js').ColorManager} colorManager
     */
    constructor(eventBus, exprManager, colorManager) {
        this.eventBus = eventBus;
        this.exprManager = exprManager;
        this.colorManager = colorManager;

        this.exprInput = document.getElementById('exprInput');
        this.exprTypeSelect = document.getElementById('exprTypeSelect');
        this.colorPicker = document.getElementById('exprColorPicker');
        this.addBtn = document.getElementById('addExprBtn');
        this.dimensionHint = document.getElementById('dimensionHint');

        this._bindEvents();
        this._updateDimensionHint();
    }

    _bindEvents() {
        this.addBtn.addEventListener('click', () => this._handleAdd());
        this.exprInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this._handleAdd();
        });
        this.exprTypeSelect.addEventListener('change', () => this._updateDimensionHint());
    }

    _updateDimensionHint() {
        const type = this.exprTypeSelect.value;
        this.dimensionHint.textContent = type === '2d'
            ? '(一元函数 y=f(x))'
            : '(二元函数 z=f(x,y))';
    }

    _handleAdd() {
        const fnStr = this.exprInput.value.trim();
        if (!fnStr) { this.exprInput.focus(); return; }

        const type = this.exprTypeSelect.value;
        const color = this.colorPicker.value;
        const expr = this.exprManager.add(type, fnStr, color);

        this.exprInput.value = '';
        this.exprInput.focus();
        this.eventBus.emit('expr:added', { expr });
    }
}