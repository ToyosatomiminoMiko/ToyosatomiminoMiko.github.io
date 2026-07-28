import { riemann1dLeft, riemann2dLeft, lebesgue1d, lebesgue2d } from '../integration/IntegralCore.js';
import { APP_CONFIG } from '../config/appConfig.js';

export class IntegralPanel {
    /**
     * @param {import('../service/EventBus.js').EventBus} eventBus
     * @param {import('../core/ExpressionManager.js').ExpressionManager} exprManager
     * @param {import('../integration/IntegralVisualizer.js').IntegralVisualizer} visualizer
     */
    constructor(eventBus, exprManager, visualizer) {
        this.eventBus = eventBus;
        this.exprManager = exprManager;
        this.visualizer = visualizer;

        this.calcBtn = document.getElementById('calcIntegralBtn');
        this.showToggle = document.getElementById('showIntegralToggle');
        this.totalDisplay = document.getElementById('integralTotal');

        this.xMin2d = document.getElementById('xMin2d');
        this.xMax2d = document.getElementById('xMax2d');
        this.xMin3d = document.getElementById('xMin3d');
        this.xMax3d = document.getElementById('xMax3d');
        this.yMin3d = document.getElementById('yMin3d');
        this.yMax3d = document.getElementById('yMax3d');

        this.methodBtns = document.querySelectorAll('[data-integral-method]');
        // 积分方法: 'riemann' | 'lebesgue'
        this.currentMode = '2d';
        this.method = 'riemann';

        this._bindEvents();

        // 监听模式切换，更新区间输入框显示
        this.eventBus.on('mode:changed', ({ mode }) => {
            this.currentMode = mode;
            this._updateRangeVisibility();
        });

        this._updateRangeVisibility();
    }

    _bindEvents() {
        this.calcBtn.addEventListener('click', () => this.calculate());
        this.showToggle.addEventListener('change', () => {
            this.visualizer.group.visible = this.showToggle.checked;
        });
        // 积分方法切换
        this.methodBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const method = btn.dataset.integralMethod;
                if (method && method !== this.method) {
                    this.method = method;
                    this.methodBtns.forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                }
            });
        });
    }

    _updateRangeVisibility() {
        document.getElementById('rangeGroup2d').style.display =
            this.currentMode === '2d' ? 'flex' : 'none';
        document.getElementById('rangeGroup3d').style.display =
            this.currentMode === '3d' ? 'flex' : 'none';
    }

    calculate() {
        const mode = this.currentMode;
        const enabled = this.exprManager.getByType(mode);

        if (enabled.length === 0) {
            this.totalDisplay.textContent = '∑ S = 0.0000 (无表达式)';
            this.visualizer.clearAll();
            this._updateItemResults([]);
            return;
        }

        this.visualizer.clearAll();
        let totalSum = 0;
        const results = [];

        if (mode === '2d') {
            const a = parseFloat(this.xMin2d.value);
            const b = parseFloat(this.xMax2d.value);
            if (a >= b) { alert('请输入有效的区间 (a < b)'); return; }
            const steps = APP_CONFIG.integral.default2DSteps; // 步长

            enabled.forEach(expr => {
                try {
                    // 辛普森法
                    // const val = simpson1d(expr.fn, a, b, steps);
                    let val;
                    if (this.method === 'lebesgue') {
                        // 勒贝格法
                        val = lebesgue1d(expr.fn, a, b);
                        this.visualizer.visualize2DLebesgue(expr, a, b);
                    } else {
                        // 黎曼法
                        val = riemann1dLeft(expr.fn, a, b, steps);
                        this.visualizer.visualize2DRiemann(expr, a, b, steps);
                    }
                    totalSum += val;
                    results.push({ id: expr.id, value: val });
                } catch (e) {
                    console.warn('[积分] 2D 计算失败:', expr.fnStr, e);
                }
            });
        } else {
            const xMin = parseFloat(this.xMin3d.value);
            const xMax = parseFloat(this.xMax3d.value);
            const yMin = parseFloat(this.yMin3d.value);
            const yMax = parseFloat(this.yMax3d.value);
            if (xMin >= xMax || yMin >= yMax) { alert('请输入有效的区间'); return; }
            const N = APP_CONFIG.integral.default3DSegments;
            const M = N;

            enabled.forEach(expr => {
                try {
                    let val;
                    if (this.method === 'lebesgue') {
                        val = lebesgue2d(expr.fn, [xMin, xMax], [yMin, yMax]);
                        this.visualizer.visualize3DLebesgue(expr, [xMin, xMax], [yMin, yMax]);
                    } else {
                        val = riemann2dLeft(expr.fn, [xMin, xMax], [yMin, yMax], N, M);
                        this.visualizer.visualize3DRiemann(expr, [xMin, xMax], [yMin, yMax], N, M);
                    }
                    totalSum += val;
                    results.push({ id: expr.id, value: val });
                } catch (e) {
                    console.warn('[积分] 3D 计算失败:', expr.fnStr, e);
                }
            });
        }
        // 保留4位输出
        this.totalDisplay.textContent = `∑ S = ${totalSum.toFixed(4)}`;
        this._updateItemResults(results);

        this.eventBus.emit('integral:calculated', { results, total: totalSum });
    }

    _updateItemResults(results) {
        const items = document.querySelectorAll('.expr-item');
        items.forEach(item => {
            const id = parseInt(item.dataset.id);
            const span = item.querySelector('.integral-result');
            if (span) {
                const found = results.find(r => r.id === id);
                span.textContent = found ? `S=${found.value.toFixed(4)}` : 'S=---';
            }
        });
    }
}