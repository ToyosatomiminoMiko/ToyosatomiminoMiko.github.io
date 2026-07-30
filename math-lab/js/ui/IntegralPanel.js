import { riemann1dLeft, riemann2dLeft, lebesgue1d, lebesgue2d } from '../integration/IntegralCore.js';

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
        // 区间 获取元素
        this.xMin2d = document.getElementById('xMin2d');
        this.xMax2d = document.getElementById('xMax2d');
        this.xMin3d = document.getElementById('xMin3d');
        this.xMax3d = document.getElementById('xMax3d');
        this.yMin3d = document.getElementById('yMin3d');
        this.yMax3d = document.getElementById('yMax3d');
        // 切分数量
        this.segmentInput = document.getElementById('segmentCount');

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

    // 根据表达式对象构建可在采样循环中使用的求值函数
    _makeFn(expr) {
        const compiled = expr.node.compile();
        const scope = {};
        for (const c of expr.coefficients) scope[c.name] = c.value;
        if (expr.type === '2d') {
            return (x) => {
                scope.x = x;
                return compiled.evaluate(scope);
            };
        } else {
            return (x, y) => {
                scope.x = x;
                scope.y = y;
                return compiled.evaluate(scope);
            };
        }
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
        // 分割数量
        const segments = parseInt(this.segmentInput.value);
        if (mode === '2d') {
            const a = parseFloat(this.xMin2d.value);
            const b = parseFloat(this.xMax2d.value);
            if (a >= b) { alert('请输入有效的区间 (a < b)'); return; }

            enabled.forEach(expr => {
                try {
                    // 辛普森法
                    // const val = simpson1d(expr.fn, a, b, segments);
                    let val;
                    const fn = this._makeFn(expr);
                    const sample2d = segments * 20; // 采样精度
                    if (this.method === 'lebesgue') {
                        // 勒贝格法
                        val = lebesgue1d(fn, a, b, segments, sample2d);
                        this.visualizer.visualize2DLebesgue(expr, fn, a, b, segments, sample2d);
                    } else {
                        // 黎曼法
                        val = riemann1dLeft(fn, a, b, segments);
                        this.visualizer.visualize2DRiemann(expr, fn, a, b, segments);
                    }
                    totalSum += val;
                    results.push({ id: expr.id, value: val });
                } catch (e) {
                    console.warn('[积分] 2D 计算失败:', expr.node.toString(), e);
                }
            });
        } else {
            const xMin = parseFloat(this.xMin3d.value);
            const xMax = parseFloat(this.xMax3d.value);
            const yMin = parseFloat(this.yMin3d.value);
            const yMax = parseFloat(this.yMax3d.value);
            if (xMin >= xMax || yMin >= yMax) { alert('请输入有效的区间'); return; }
            const N = segments, M = segments;

            enabled.forEach(expr => {
                try {
                    let val;
                    const fn = this._makeFn(expr);
                    const res3d = segments; // 总分层
                    if (this.method === 'lebesgue') {
                        val = lebesgue2d(fn, [xMin, xMax], [yMin, yMax], segments, res3d);
                        this.visualizer.visualize3DLebesgue(expr, fn, [xMin, xMax], [yMin, yMax], res3d);
                    } else {
                        val = riemann2dLeft(fn, [xMin, xMax], [yMin, yMax], N, M);
                        this.visualizer.visualize3DRiemann(expr, fn, [xMin, xMax], [yMin, yMax], N, M);
                    }
                    totalSum += val;
                    results.push({ id: expr.id, value: val });
                } catch (e) {
                    console.warn('[积分] 3D 计算失败:', expr.node.toString(), e);
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