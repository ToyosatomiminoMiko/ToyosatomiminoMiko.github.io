import type { Tab } from './Tab';
import type { MathObject } from '../../math_objects/types';
import type { MathObjectManager } from '../../math_objects/MathObjectManager';
import type { EventBus } from '../../service/EventBus';
import type { MathLabEvents } from '../../types';
import type { IntegralVisualizer } from '../../visualization/IntegralVisualizer';
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

type IntegralMethod = 'trapezoid' | 'simpson' | 'riemann' | 'lebesgue';

export class IntegralTab implements Tab {
    private _container: HTMLElement;
    private _objectManager: MathObjectManager;
    private _eventBus: EventBus<MathLabEvents>;
    private _integralVisualizer: IntegralVisualizer;
    private _method: IntegralMethod = 'riemann';
    private _abortController: AbortController | null = null;

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
                console.error('[积分WASM] 计算失败:', err);
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

        this._integralVisualizer.clearAll();
        const resultDiv = this._container.querySelector<HTMLElement>('#singleIntegralResult');

        try {
            let val: number;
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
                if (a >= b) { alert('请输入有效区间 a < b'); return; }

                if (method === 'trapezoid') {
                    val = await trapz1d(obj.node.toString(), coeffsObj, a, b, segments);
                } else if (method === 'simpson') {
                    val = await simpson1d(obj.node.toString(), coeffsObj, a, b, segments);
                } else if (method === 'riemann') {
                    val = await riemann1dLeft(obj.node.toString(), coeffsObj, a, b, segments);
                } else {
                    const sampleN = segments * 20;
                    const valueLayers = Math.min(32, sampleN);
                    val = await lebesgue1d(obj.node.toString(), coeffsObj, a, b, valueLayers, sampleN);
                }

                const fn1d = fn as (x: number) => number;
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
                if (xMin >= xMax || yMin >= yMax) { alert('请输入有效区间'); return; }

                const fn2d = fn as (x: number, y: number) => number;

                if (method === 'trapezoid') {
                    val = await trapz2d(obj.node.toString(), coeffsObj, [xMin, xMax], [yMin, yMax], segments, segments);
                    this._integralVisualizer.visualize3DRiemann(obj, fn2d, [xMin, xMax], [yMin, yMax], segments, segments);
                } else if (method === 'simpson') {
                    val = await simpson2d(obj.node.toString(), coeffsObj, [xMin, xMax], [yMin, yMax], segments, segments);
                    this._integralVisualizer.visualize3DRiemann(obj, fn2d, [xMin, xMax], [yMin, yMax], segments, segments);
                } else if (method === 'riemann') {
                    val = await riemann2dLeft(obj.node.toString(), coeffsObj, [xMin, xMax], [yMin, yMax], segments, segments);
                    this._integralVisualizer.visualize3DRiemann(obj, fn2d, [xMin, xMax], [yMin, yMax], segments, segments);
                } else {
                    const sampleGrid = segments * 4;       // 采样网格
                    const valueLayers = Math.min(32, segments); // 值域分层
                    val = await lebesgue2d(obj.node.toString(), coeffsObj, [xMin, xMax], [yMin, yMax], valueLayers, sampleGrid);
                    this._integralVisualizer.visualize3DLebesgue(obj, fn2d, [xMin, xMax], [yMin, yMax], sampleGrid);
                }
            }

            if (resultDiv) {
                resultDiv.textContent = `积分结果: S = ${val.toFixed(6)}`;
            }

            this._eventBus.emit('integral:calculated', {
                results: [{ id: obj.id, value: val }],
                total: val,
            });
        } catch (e) {
            console.warn('[积分] 计算失败:', obj.kind === 'curve' || obj.kind === 'surface' ? obj.node.toString() : '', e);
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
}