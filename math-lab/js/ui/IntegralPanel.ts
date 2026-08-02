import { EventBus } from '../service/EventBus';
import type { MathLabEvents, Expression } from '../types';
import type { ExpressionManager } from '../core/ExpressionManager';
import type { IntegralVisualizer } from '../integration/IntegralVisualizer';
import {
    riemann1dLeft,
    riemann2dLeft,
    lebesgue1d,
    lebesgue2d,
} from '../integration/IntegralCore';

/** 积分方法 */
type IntegralMethod = 'riemann' | 'lebesgue';

/** 计算结果条目 */
interface IntegralResult {
    id: number;
    value: number;
}

/**
 * 积分计算面板
 * 负责区间输入,方法选择,计算触发,结果展示
 */
export class IntegralPanel {
    eventBus: EventBus<MathLabEvents>;
    exprManager: ExpressionManager;
    visualizer: IntegralVisualizer;

    // DOM 元素
    calcBtn: HTMLButtonElement;
    showToggle: HTMLInputElement;
    totalDisplay: HTMLElement;
    xMin2d: HTMLInputElement;
    xMax2d: HTMLInputElement;
    xMin3d: HTMLInputElement;
    xMax3d: HTMLInputElement;
    yMin3d: HTMLInputElement;
    yMax3d: HTMLInputElement;
    segmentInput: HTMLInputElement;
    methodBtns: NodeListOf<HTMLElement>;

    // 状态
    currentMode: '2d' | '3d';
    method: IntegralMethod;

    constructor(
        eventBus: EventBus<MathLabEvents>,
        exprManager: ExpressionManager,
        visualizer: IntegralVisualizer,
    ) {
        this.eventBus = eventBus;
        this.exprManager = exprManager;
        this.visualizer = visualizer;

        // 获取 DOM 引用
        this.calcBtn = document.getElementById('calcIntegralBtn') as HTMLButtonElement;
        this.showToggle = document.getElementById('showIntegralToggle') as HTMLInputElement;
        this.totalDisplay = document.getElementById('integralTotal')!;
        this.xMin2d = document.getElementById('xMin2d') as HTMLInputElement;
        this.xMax2d = document.getElementById('xMax2d') as HTMLInputElement;
        this.xMin3d = document.getElementById('xMin3d') as HTMLInputElement;
        this.xMax3d = document.getElementById('xMax3d') as HTMLInputElement;
        this.yMin3d = document.getElementById('yMin3d') as HTMLInputElement;
        this.yMax3d = document.getElementById('yMax3d') as HTMLInputElement;
        this.segmentInput = document.getElementById('segmentCount') as HTMLInputElement;
        this.methodBtns = document.querySelectorAll('[data-integral-method]');

        this.currentMode = '2d';
        this.method = 'riemann';

        this._bindEvents();

        // 监听模式切换,更新区间输入框显示
        this.eventBus.on('mode:changed', ({ mode }) => {
            this.currentMode = mode;
            this._updateRangeVisibility();
        });

        this._updateRangeVisibility();
    }

    // ============================================================
    //  内部方法
    // ============================================================

    /** 根据表达式构建求值函数 */
    private _makeFn(expr: Expression): (x: number, y?: number) => number {
        const compiled = expr.node.compile();
        const scope: Record<string, number> = {};
        for (const c of expr.coefficients) scope[c.name] = c.value;

        if (expr.type === '2d') {
            return (x: number): number => {
                scope.x = x;
                return compiled.evaluate(scope);
            };
        } else {
            return (x: number, y?: number): number => {
                scope.x = x;
                if (y !== undefined) scope.y = y;
                return compiled.evaluate(scope);
            };
        }
    }

    /** 绑定 DOM 事件 */
    private _bindEvents(): void {
        this.calcBtn.addEventListener('click', () => this.calculate());
        this.showToggle.addEventListener('change', () => {
            this.visualizer.group.visible = this.showToggle.checked;
        });

        this.methodBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const m = (btn as HTMLElement).dataset.integralMethod as IntegralMethod | undefined;
                if (m && m !== this.method) {
                    this.method = m;
                    this.methodBtns.forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                }
            });
        });
    }

    /** 根据当前模式显示 / 隐藏 2D / 3D 区间输入组 */
    private _updateRangeVisibility(): void {
        const g2d = document.getElementById('rangeGroup2d');
        const g3d = document.getElementById('rangeGroup3d');
        if (g2d) g2d.style.display = this.currentMode === '2d' ? 'flex' : 'none';
        if (g3d) g3d.style.display = this.currentMode === '3d' ? 'flex' : 'none';
    }

    /** 执行积分计算 */
    calculate(): void {
        const mode = this.currentMode;
        const enabled = this.exprManager.getByType(mode);

        if (enabled.length === 0) {
            this.totalDisplay.textContent = '∑ S = 0.0000（无表达式）';
            this.visualizer.clearAll();
            this._updateItemResults([]);
            return;
        }

        this.visualizer.clearAll();
        let totalSum = 0;
        const results: IntegralResult[] = [];
        const segments = parseInt(this.segmentInput.value);

        if (mode === '2d') {
            const a = parseFloat(this.xMin2d.value);
            const b = parseFloat(this.xMax2d.value);
            if (a >= b) {
                alert('请输入有效的区间（a < b）');
                return;
            }

            for (const expr of enabled) {
                try {
                    let val: number;
                    const fn = this._makeFn(expr) as (x: number) => number;
                    const sample2d = segments * 20;

                    if (this.method === 'lebesgue') {
                        val = lebesgue1d(fn, a, b, segments, sample2d);
                        this.visualizer.visualize2DLebesgue(expr, fn, a, b, segments, sample2d);
                    } else {
                        val = riemann1dLeft(fn, a, b, segments);
                        this.visualizer.visualize2DRiemann(expr, fn, a, b, segments);
                    }
                    totalSum += val;
                    results.push({ id: expr.id, value: val });
                } catch (e) {
                    console.warn('[积分] 2D 计算失败:', expr.node.toString(), e);
                }
            }
        } else {
            const xMin = parseFloat(this.xMin3d.value);
            const xMax = parseFloat(this.xMax3d.value);
            const yMin = parseFloat(this.yMin3d.value);
            const yMax = parseFloat(this.yMax3d.value);
            if (xMin >= xMax || yMin >= yMax) {
                alert('请输入有效的区间');
                return;
            }
            const N = segments;
            const M = segments;

            for (const expr of enabled) {
                try {
                    let val: number;
                    const fn = this._makeFn(expr) as (x: number, y: number) => number;
                    const res3d = segments;

                    if (this.method === 'lebesgue') {
                        val = lebesgue2d(fn, [xMin, xMax], [yMin, yMax], segments, res3d);
                        this.visualizer.visualize3DLebesgue(
                            expr, fn, [xMin, xMax], [yMin, yMax], res3d,
                        );
                    } else {
                        val = riemann2dLeft(fn, [xMin, xMax], [yMin, yMax], N, M);
                        this.visualizer.visualize3DRiemann(
                            expr, fn, [xMin, xMax], [yMin, yMax], N, M,
                        );
                    }
                    totalSum += val;
                    results.push({ id: expr.id, value: val });
                } catch (e) {
                    console.warn('[积分] 3D 计算失败:', expr.node.toString(), e);
                }
            }
        }

        this.totalDisplay.textContent = `∑ S = ${totalSum.toFixed(4)}`;
        this._updateItemResults(results);
        this.eventBus.emit('integral:calculated', { results, total: totalSum });
    }

    /** 更新列表中每个表达式的积分结果显示 */
    private _updateItemResults(results: IntegralResult[]): void {
        const items = document.querySelectorAll('.expr-item') as NodeListOf<HTMLElement>;
        items.forEach(item => {
            const id = parseInt(item.dataset.id!);
            const span = item.querySelector('.integral-result') as HTMLElement | null;
            if (span) {
                const found = results.find(r => r.id === id);
                span.textContent = found ? `S=${found.value.toFixed(4)}` : 'S=---';
            }
        });
    }
}