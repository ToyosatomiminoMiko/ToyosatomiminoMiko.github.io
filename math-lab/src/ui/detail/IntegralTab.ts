import type { Tab } from './Tab';
import type { MathObject } from '../../math_objects/types';
import type { MathObjectManager } from '../../math_objects/MathObjectManager';
import type { EventBus } from '../../service/EventBus';
import type { MathLabEvents } from '../../types';
import type { IntegralVisualizer } from '../../visualization/IntegralVisualizer';
import { notifyError, reportError } from '../error';
import {
    trapz1d,
    trapz2d,
    simpson1d,
    simpson2d,
    riemann1dLeft,
    riemann2dLeft,
    lebesgue1d,
    lebesgue2d,
} from '../../math_objects/IntegralWasm';
import type { IntegralResult } from '../../math_objects/IntegralWasm';

type IntegralMethod = 'trapezoid' | 'simpson' | 'riemann' | 'lebesgue';

export class IntegralTab implements Tab {
    private _container: HTMLElement;
    private _objectManager: MathObjectManager;
    private _eventBus: EventBus<MathLabEvents>;
    private _integralVisualizer: IntegralVisualizer;
    private _method: IntegralMethod = 'riemann';
    private _abortController: AbortController | null = null;
    private _requestSeq = 0;

    constructor(
        container: HTMLElement,
        objectManager: MathObjectManager,
        eventBus: EventBus<MathLabEvents>,
        integralVisualizer: IntegralVisualizer,
    ) {
        this._container = container;
        this._objectManager = objectManager;
        this._eventBus = eventBus;
        this._integralVisualizer = integralVisualizer;
    }

    isVisible(kind: string | null): boolean {
        return kind === 'curve' || kind === 'surface';
    }

    render(obj: MathObject): void {
        if (obj.kind !== 'curve' && obj.kind !== 'surface') {
            this._container.innerHTML =
                '<div class="detail-hint">积分仅适用于曲线或曲面</div>';
            return;
        }

        this._container.innerHTML = this._buildHtml(obj);
        this._abortController = new AbortController();

        // 切换方法 -> 重新渲染 刷新分段数提示
        this._container.querySelectorAll('.method-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const m = (btn as HTMLElement).dataset.method as IntegralMethod | undefined;
                if (m) this._method = m;
                this.render(obj);
            }, { signal: this._abortController!.signal });
        });

        // 显示/隐藏 toggle
        const showToggle = this._container.querySelector<HTMLInputElement>('#showIntegralToggle');
        showToggle?.addEventListener('change', () => {
            this._integralVisualizer.group.visible = showToggle?.checked ?? true;
        }, { signal: this._abortController!.signal });

        // 计算按钮
        this._container.querySelector('#calcIntegralBtn')?.addEventListener('click', () => {
            // Simpson 时自动调整分段数为偶数
            const segInput = this._container.querySelector<HTMLInputElement>('#segInt');
            if (segInput && this._method === 'simpson') {
                let n = parseInt(segInput.value, 10) || 32;
                if (n % 2 !== 0) {
                    n = Math.max(4, n % 2 === 0 ? n : n + 1);
                    segInput.value = String(n);
                }
            }
            this._doIntegral(obj).catch(err => {
                reportError(err, '积分计算');
            });
        }, { signal: this._abortController!.signal });
    }

    destroy(): void {
        this._abortController?.abort();
        this._abortController = null;
        this._integralVisualizer.clearAll();
    }

    // ============================================================
    //  HTML 构建
    // ============================================================

    private _buildHtml(obj: MathObject): string {
        const isCurve = obj.kind === 'curve';

        const methods: { key: IntegralMethod; label: string }[] = [
            { key: 'trapezoid', label: '梯形' },
            { key: 'simpson', label: '辛普森' },
            { key: 'riemann', label: '黎曼' },
            { key: 'lebesgue', label: '勒贝格' },
        ];

        const methodButtons = methods
            .map(
                m =>
                    `<button class="method-btn ${this._method === m.key ? 'active' : ''}"
                            data-method="${m.key}">${m.label}</button>`,
            )
            .join('');

        let html = `
            <div class="integral-header">
                <span>📊 数值积分</span>
                <span>${methodButtons}</span>
            </div>
            <div class="integral-inputs">`;

        if (isCurve) {
            html += `
                <div class="range-group">
                    <label>x ∈ [</label>
                    <input type="number" id="xMinInt" value="-4" step="0.1" />
                    <span> , </span>
                    <input type="number" id="xMaxInt" value="4" step="0.1" />
                    <span>]</span>
                </div>`;
        } else {
            html += `
                <div class="range-group">
                    <label>x ∈ [</label>
                    <input type="number" id="xMinInt" value="-3" step="0.1" />
                    <span> , </span>
                    <input type="number" id="xMaxInt" value="3" step="0.1" />
                    <span>] &nbsp; y ∈ [</span>
                    <input type="number" id="yMinInt" value="-3" step="0.1" />
                    <span> , </span>
                    <input type="number" id="yMaxInt" value="3" step="0.1" />
                    <span>]</span>
                </div>`;
        }

        const evenHint =
            this._method === 'simpson'
                ? '<span style="color:#ffd93d;font-size:11px;margin-left:8px;">需偶数</span>'
                : '';

        html += `
                <div class="range-group">
                    <label>切分: </label>
                    <input type="number" id="segInt" value="32" min="4" max="256" step="1" />
                    ${evenHint}
                </div>
            </div>
            <div class="integral-actions">
                <button id="calcIntegralBtn">🧮 计算</button>
                <label class="integral-switch">
                    <input type="checkbox" id="showIntegralToggle" checked />
                    显示区域
                </label>
            </div>
            <div class="integral-result" id="singleIntegralResult"
                 style="margin-top:8px;color:#ffd93d;"></div>`;

        return html;
    }

    // ============================================================
    //  积分计算
    // ============================================================

    private async _doIntegral(obj: MathObject): Promise<void> {
        if (obj.kind !== 'curve' && obj.kind !== 'surface') return;

        const requestId = ++this._requestSeq;
        this._integralVisualizer.clearAll();
        const resultDiv = this._container.querySelector<HTMLElement>('#singleIntegralResult');

        try {
            let integralResult: IntegralResult;
            const segments = parseInt(
                this._container.querySelector<HTMLInputElement>('#segInt')?.value || '32',
            );

            const method = this._method;

            // 系数快照
            const coeffsObj: Record<string, number> = {};
            for (const c of obj.coefficients) coeffsObj[c.name] = c.value;

            // 主线程 fn 仅用于可视化
            const fn = this._makeFn(obj);

            if (obj.kind === 'curve') {
                const a = parseFloat(
                    this._container.querySelector<HTMLInputElement>('#xMinInt')?.value || '-4',
                );
                const b = parseFloat(
                    this._container.querySelector<HTMLInputElement>('#xMaxInt')?.value || '4',
                );
                if (a >= b) { notifyError('请输入有效区间 a < b'); return; }

                if (method === 'trapezoid') {
                    integralResult = await trapz1d(obj.node.toString(), coeffsObj, a, b, segments);
                } else if (method === 'simpson') {
                    integralResult = await simpson1d(obj.node.toString(), coeffsObj, a, b, segments);
                } else if (method === 'riemann') {
                    integralResult = await riemann1dLeft(obj.node.toString(), coeffsObj, a, b, segments);
                } else {
                    const sampleN = segments * 20;
                    const valueLayers = Math.min(32, sampleN);
                    integralResult = await lebesgue1d(obj.node.toString(), coeffsObj, a, b, valueLayers, sampleN);
                }

                if (requestId !== this._requestSeq) return;

                const val = integralResult.value;
                const fn1d = this._makeVisual1D(
                    integralResult,
                    a,
                    b,
                    fn as (x: number) => number,
                );
                if (method === 'lebesgue') {
                    const sampleN = segments * 20;
                    const valueLayers = Math.min(32, sampleN);
                    this._integralVisualizer.visualize2DLebesgue(obj, fn1d, a, b, valueLayers, sampleN);
                } else {
                    this._integralVisualizer.visualize2DRiemann(obj, fn1d, a, b, segments);
                }
            } else {
                // ---- 二维 ----
                const xMin = parseFloat(
                    this._container.querySelector<HTMLInputElement>('#xMinInt')?.value || '-3',
                );
                const xMax = parseFloat(
                    this._container.querySelector<HTMLInputElement>('#xMaxInt')?.value || '3',
                );
                const yMin = parseFloat(
                    this._container.querySelector<HTMLInputElement>('#yMinInt')?.value || '-3',
                );
                const yMax = parseFloat(
                    this._container.querySelector<HTMLInputElement>('#yMaxInt')?.value || '3',
                );
                if (xMin >= xMax || yMin >= yMax) { notifyError('请输入有效区间'); return; }

                const fallback2d = fn as (x: number, y: number) => number;
                let visualFn2d = fallback2d;

                if (method === 'trapezoid') {
                    integralResult = await trapz2d(obj.node.toString(), coeffsObj, [xMin, xMax], [yMin, yMax], segments, segments);
                    if (requestId !== this._requestSeq) return;
                    visualFn2d = this._makeVisual2D(integralResult, xMin, xMax, yMin, yMax, fallback2d);
                    this._integralVisualizer.visualize3DRiemann(obj, visualFn2d, [xMin, xMax], [yMin, yMax], segments, segments);
                } else if (method === 'simpson') {
                    integralResult = await simpson2d(obj.node.toString(), coeffsObj, [xMin, xMax], [yMin, yMax], segments, segments);
                    if (requestId !== this._requestSeq) return;
                    visualFn2d = this._makeVisual2D(integralResult, xMin, xMax, yMin, yMax, fallback2d);
                    this._integralVisualizer.visualize3DRiemann(obj, visualFn2d, [xMin, xMax], [yMin, yMax], segments, segments);
                } else if (method === 'riemann') {
                    integralResult = await riemann2dLeft(obj.node.toString(), coeffsObj, [xMin, xMax], [yMin, yMax], segments, segments);
                    if (requestId !== this._requestSeq) return;
                    visualFn2d = this._makeVisual2D(integralResult, xMin, xMax, yMin, yMax, fallback2d);
                    this._integralVisualizer.visualize3DRiemann(obj, visualFn2d, [xMin, xMax], [yMin, yMax], segments, segments);
                } else {
                    const sampleGrid = segments * 4;       // 采样网格
                    const valueLayers = Math.min(32, segments); // 值域分层
                    integralResult = await lebesgue2d(obj.node.toString(), coeffsObj, [xMin, xMax], [yMin, yMax], valueLayers, sampleGrid);
                    if (requestId !== this._requestSeq) return;
                    visualFn2d = this._makeVisual2D(integralResult, xMin, xMax, yMin, yMax, fallback2d);
                    this._integralVisualizer.visualize3DLebesgue(
                        obj,
                        visualFn2d,
                        [xMin, xMax],
                        [yMin, yMax],
                        valueLayers,
                        sampleGrid,
                    );
                }
            }

            if (requestId !== this._requestSeq) return;
            const val = integralResult.value;
            if (resultDiv) {
                resultDiv.textContent = `积分结果: S = ${val.toFixed(6)}`;
            }

            this._eventBus.emit('integral:calculated', {
                results: [{ id: obj.id, value: val }],
                total: val,
            });
        } catch (e) {
            reportError(e, '积分计算');
            if (resultDiv) resultDiv.textContent = '积分计算失败';
        }
    }

    // ============================================================
    //  构建求值函数
    // ============================================================

    private _makeFn(obj: MathObject): (x: number, y?: number) => number {
        if (obj.kind !== 'curve' && obj.kind !== 'surface') {
            throw new Error('只能对曲线或曲面构建求值函数');
        }

        const compiled = obj.node.compile();
        const scope: Record<string, number> = {};
        for (const c of obj.coefficients) scope[c.name] = c.value;

        if (obj.kind === 'curve') {
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

    /** 优先使用 Worker 返回的 1D 采样做可视化,失败时回退到 mathjs 求值. */
    private _makeVisual1D(
        result: IntegralResult,
        a: number,
        b: number,
        fallback: (x: number) => number,
    ): (x: number) => number {
        const { samples, sampleShape } = result;
        if (!samples || sampleShape !== '1d-grid') return fallback;

        const n = result.n ?? 0;
        const h = n > 0 ? (b - a) / n : 0;
        return (x: number): number => {
            if (n === 0 || h === 0) return samples[0];
            const i = Math.max(0, Math.min(n, Math.round((x - a) / h)));
            return samples[i];
        };
    }

    /** 优先使用 Worker 返回的 2D 采样做可视化,失败时回退到 mathjs 求值. */
    private _makeVisual2D(
        result: IntegralResult,
        xMin: number,
        xMax: number,
        yMin: number,
        yMax: number,
        fallback: (x: number, y: number) => number,
    ): (x: number, y: number) => number {
        const { samples, sampleShape } = result;
        if (!samples || (sampleShape !== '2d-grid' && sampleShape !== '2d-corner')) {
            return fallback;
        }

        const n = result.n ?? 0;
        const m = result.m ?? 0;
        const hx = n > 0 ? (xMax - xMin) / n : 0;
        const hy = m > 0 ? (yMax - yMin) / m : 0;

        if (sampleShape === '2d-grid') {
            const stride = n + 1;
            return (x: number, y: number): number => {
                const i = Math.max(0, Math.min(n, Math.round((x - xMin) / hx)));
                const j = Math.max(0, Math.min(m, Math.round((y - yMin) / hy)));
                return samples[j * stride + i];
            };
        }

        return (x: number, y: number): number => {
            const i = Math.max(0, Math.min(n - 1, Math.round((x - xMin) / hx)));
            const j = Math.max(0, Math.min(m - 1, Math.round((y - yMin) / hy)));
            return samples[j * n + i];
        };
    }
}
