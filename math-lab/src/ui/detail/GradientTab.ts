import type { Tab } from './Tab';
import type { MathObject } from '../../math_objects/types';
import type { MathObjectManager } from '../../math_objects/MathObjectManager';
import type { EventBus } from '../../service/EventBus';
import type { MathLabEvents } from '../../types';
import type { SelectionManager } from '../SelectionManager';
import type { GradientVisualizer } from '../../visualization/GradientVisualizer';
import { computeGradient } from '../../math_objects/GradientCore';
import { SliderBinding } from './SliderBinding';
import { escapeHtml } from './utils';

export class GradientTab implements Tab {
    private _container: HTMLElement;
    private _objectManager: MathObjectManager;
    private _eventBus: EventBus<MathLabEvents>;
    private _selectionManager: SelectionManager;
    private _gradientVisualizer: GradientVisualizer;
    private _sliderCleanups: (() => void)[] = [];
    private _abortController: AbortController | null = null;
    private _previewTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(
        container: HTMLElement,
        objectManager: MathObjectManager,
        eventBus: EventBus<MathLabEvents>,
        selectionManager: SelectionManager,
        gradientVisualizer: GradientVisualizer,
    ) {
        this._container = container;
        this._objectManager = objectManager;
        this._eventBus = eventBus;
        this._selectionManager = selectionManager;
        this._gradientVisualizer = gradientVisualizer;
    }

    isVisible(kind: string | null): boolean {
        return kind === 'surface';
    }

    render(obj: MathObject): void {
        if (obj.kind !== 'surface') {
            this._container.innerHTML =
                '<div class="detail-hint">梯度计算仅适用于 3D 曲面</div>';
            return;
        }

        // 读取默认坐标
        const x0 = obj.coefficients.find(c => c.name === 'x0')?.value ?? 0;
        const y0 = obj.coefficients.find(c => c.name === 'y0')?.value ?? 0;

        this._container.innerHTML = `
            <div class="gradient-status">
                曲面: <b>z = ${escapeHtml(obj.node.toString())}</b>
            </div>

            <div class="gradient-sliders">
                <div class="coeff-row">
                    <label>x₀</label>
                    <input type="range" id="gradX0Slider" min="-4" max="4" step="0.02"
                           value="${x0}" class="coeff-slider" data-coeff="x0" />
                    <input type="number" id="gradX0Num" class="coeff-value"
                           value="${x0.toFixed(2)}" step="0.02" min="-4" max="4"
                           data-coeff="x0" />
                </div>
                <div class="coeff-row">
                    <label>y₀</label>
                    <input type="range" id="gradY0Slider" min="-4" max="4" step="0.02"
                           value="${y0}" class="coeff-slider" data-coeff="y0" />
                    <input type="number" id="gradY0Num" class="coeff-value"
                           value="${y0.toFixed(2)}" step="0.02" min="-4" max="4"
                           data-coeff="y0" />
                </div>
            </div>

            <div id="gradResultInfo"
                 style="font-size:12px;color:#7a8bb5;margin:8px 0;min-height:48px;">
                拖动滑块以预览梯度
            </div>

            <div class="gradient-actions">
                <button id="gradPinBtn" class="deriv-btn">🎯 固定到场景</button>
                <button id="gradClearBtn" class="deriv-btn"
                        style="background:rgba(255,255,255,0.05);">🔄 清除预览</button>
            </div>`;

        this._abortController = new AbortController();
        const signal = this._abortController.signal;

        // ---- 滑块绑定 ----
        this._sliderCleanups.push(
            SliderBinding.bindAll(this._container, () => {
                if (this._previewTimer) clearTimeout(this._previewTimer);
                this._previewTimer = setTimeout(() => {
                    const xVal = this._readSlider('x0');
                    const yVal = this._readSlider('y0');
                    this._updatePreview(obj, xVal, yVal);
                }, 50);
            }, { debounceMs: 0 }), // 防抖由 setTimeout 自己处理
        );

        // ---- 按钮 ----
        this._container.querySelector('#gradPinBtn')
            ?.addEventListener('click', () => {
                const xVal = this._readSlider('x0');
                const yVal = this._readSlider('y0');
                this._persistToScene(obj, xVal, yVal);
            }, { signal });

        this._container.querySelector('#gradClearBtn')
            ?.addEventListener('click', () => {
                this._gradientVisualizer.clear();
            }, { signal });

        // 初始预览
        this._updatePreview(obj, x0, y0);
    }

    destroy(): void {
        this._abortController?.abort();
        this._abortController = null;
        for (const cleanup of this._sliderCleanups) cleanup();
        this._sliderCleanups = [];
        if (this._previewTimer) {
            clearTimeout(this._previewTimer);
            this._previewTimer = null;
        }
        this._gradientVisualizer.clear();
    }

    // ============================================================
    //  读取滑块值
    // ============================================================

    private _readSlider(name: string): number {
        const el = this._container.querySelector(
            `[data-coeff="${name}"].coeff-value`,
        ) as HTMLInputElement | null;
        return parseFloat(el?.value ?? '0');
    }

    // ============================================================
    //  实时预览
    // ============================================================

    private _updatePreview(obj: MathObject, x0: number, y0: number): void {
        if (obj.kind !== 'surface') return;

        try {
            const scope: Record<string, number> = {};
            for (const c of obj.coefficients) {
                scope[c.name] = c.value;
            }

            const result = computeGradient(obj.node, x0, y0, scope);

            const infoDiv = this._container.querySelector('#gradResultInfo');
            if (infoDiv) {
                infoDiv.innerHTML = `
                    P = (${x0.toFixed(2)}, ${y0.toFixed(2)}, <b>${result.f0.toFixed(4)}</b>)<br/>
                    ∇f = ( ∂f/∂x = <b>${result.fx.toFixed(4)}</b>,
                           ∂f/∂y = <b>${result.fy.toFixed(4)}</b> )<br/>
                    ‖∇f‖ = <b>${Math.sqrt(result.fx * result.fx + result.fy * result.fy).toFixed(4)}</b>
                `;
            }

            this._gradientVisualizer.update(
                x0, y0, result.f0,
                result.fx, result.fy,
                result.normalDirection,
                obj.color,
            );
        } catch (err) {
            const infoDiv = this._container.querySelector('#gradResultInfo');
            if (infoDiv) {
                infoDiv.innerHTML = `<span style="color:#ff6b8a;">⚠️ ${(err as Error).message}</span>`;
            }
        }
    }

    // ============================================================
    //  🎯 固定到场景
    // ============================================================

    private _persistToScene(obj: MathObject, x0: number, y0: number): void {
        if (obj.kind !== 'surface') return;

        try {
            const scope: Record<string, number> = {};
            for (const c of obj.coefficients) {
                scope[c.name] = c.value;
            }

            const result = computeGradient(obj.node, x0, y0, scope);

            // 1. 切平面
            const tangentStr = result.tangentPlaneNode.toString();
            const tangentExpr = this._objectManager.addSurface(tangentStr);
            this._objectManager.updateColor(tangentExpr.id, this._adjustColor(obj.color, 0.7));
            this._eventBus.emit('mathobj:added', { object: tangentExpr });

            // 2. 法线箭头
            const [nx, ny, nz] = result.normalDirection;
            const arrowLength = 2;
            const arrowExpr = this._objectManager.addVector(
                nx * arrowLength,
                ny * arrowLength,
                nz * arrowLength,
                x0, y0, result.f0,
                '#ff6b8a',
            );
            this._eventBus.emit('mathobj:added', { object: arrowExpr });

            // 3. 自动选中法线箭头
            this._selectionManager.select(arrowExpr.id, 'vector');
        } catch (err) {
            alert(`梯度固定失败: ${(err as Error).message}`);
        }
    }

    // ============================================================
    //  工具
    // ============================================================

    /** 调整颜色亮度(t 越小越白) */
    private _adjustColor(hex: string, t: number): string {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        const mix = (c: number) => Math.round(c * t + 255 * (1 - t));
        return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
    }
}