import type { Tab } from './Tab';
import type { MathObject } from '../../math_objects/types';
import type { MathObjectManager } from '../../math_objects/MathObjectManager';
import type { EventBus } from '../../service/EventBus';
import type { MathLabEvents } from '../../types';
import { SliderBinding } from './SliderBinding';
import { parseVectorField } from '../../math_objects/VectorField';
import { escapeHtml } from './utils';

export class VectorFieldTab implements Tab {
    private _container: HTMLElement;
    private _objectManager: MathObjectManager;
    private _eventBus: EventBus<MathLabEvents>;
    private _sliderCleanups: (() => void)[] = [];

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
        return kind === 'vector_field';
    }

    render(obj: MathObject): void {
        for (const cleanup of this._sliderCleanups) cleanup();
        this._sliderCleanups.length = 0;

        if (obj.kind !== 'vector_field') {
            this._container.innerHTML =
                '<div class="detail-hint">请选择一个向量场</div>';
            return;
        }

        const [gx, gy, gz] = obj.gridSize;
        const s = obj.glyphScale;
        const { x, y, z } = obj.range;

        this._container.innerHTML = `
            <div class="edit-row">
                <label style="font-size:11px;color:#7a8bb5;">P(x,y,z)</label>
                <input type="text" class="edit-input"
                       value="${escapeHtml(obj.components[0])}"
                       spellcheck="false" data-comp="0" />
            </div>
            <div class="edit-row">
                <label style="font-size:11px;color:#7a8bb5;">Q(x,y,z)</label>
                <input type="text" class="edit-input"
                       value="${escapeHtml(obj.components[1])}"
                       spellcheck="false" data-comp="1" />
            </div>
            <div class="edit-row">
                <label style="font-size:11px;color:#7a8bb5;">R(x,y,z)</label>
                <input type="text" class="edit-input"
                       value="${escapeHtml(obj.components[2])}"
                       spellcheck="false" data-comp="2" />
            </div>
            <button id="vfUpdateBtn" class="update-btn">🔄 更新分量</button>

            <div class="coeff-sliders" style="margin-top:12px;">
                <div class="coeff-row">
                    <label>X范围</label>
                    <input type="range" min="-10" max="0"  step="0.5" value="${x[0]}" data-coeff="xMin" class="coeff-slider" />
                    <input type="range" min="0"  max="10" step="0.5" value="${x[1]}" data-coeff="xMax" class="coeff-slider" />
                    <span style="font-size:11px;color:#7a8bb5;min-width:60px;">${x[0]}..${x[1]}</span>
                </div>
                <div class="coeff-row">
                    <label>Y范围</label>
                    <input type="range" min="-10" max="0"  step="0.5" value="${y[0]}" data-coeff="yMin" class="coeff-slider" />
                    <input type="range" min="0"  max="10" step="0.5" value="${y[1]}" data-coeff="yMax" class="coeff-slider" />
                    <span style="font-size:11px;color:#7a8bb5;min-width:60px;">${y[0]}..${y[1]}</span>
                </div>
                <div class="coeff-row">
                    <label>Z范围</label>
                    <input type="range" min="-10" max="0"  step="0.5" value="${z[0]}" data-coeff="zMin" class="coeff-slider" />
                    <input type="range" min="0"  max="10" step="0.5" value="${z[1]}" data-coeff="zMax" class="coeff-slider" />
                    <span style="font-size:11px;color:#7a8bb5;min-width:60px;">${z[0]}..${z[1]}</span>
                </div>
                <div class="coeff-row">
                    <label>网格</label>
                    <input type="range" min="3" max="12" step="1" value="${gx}" data-coeff="gridX" class="coeff-slider" />
                    <input type="range" min="3" max="12" step="1" value="${gy}" data-coeff="gridY"  class="coeff-slider" />
                    <input type="range" min="3" max="12" step="1" value="${gz}" data-coeff="gridZ"  class="coeff-slider" />
                    <span style="font-size:11px;color:#7a8bb5;min-width:60px;">${gx}×${gy}×${gz}</span>
                </div>
                <div class="coeff-row">
                    <label>箭头缩放</label>
                    <input type="range" min="0.1" max="3" step="0.1" value="${s}" data-coeff="glyphScale" class="coeff-slider" />
                    <span style="font-size:11px;color:#7a8bb5;min-width:40px;">${s.toFixed(1)}</span>
                </div>
            </div>`;

        // 系数滑块(如果有)
        if (obj.coefficients.length > 0) {
            const slidersDiv = this._container.querySelector('.coeff-sliders')!;
            for (const c of obj.coefficients) {
                const row = document.createElement('div');
                row.className = 'coeff-row';
                row.innerHTML = `
                    <label>${c.name}</label>
                    <input type="range" min="${c.min}" max="${c.max}" step="${c.step}"
                           value="${c.value}" data-coeff="${c.name}" class="coeff-slider" />
                    <input type="number" class="coeff-value" value="${c.value.toFixed(2)}"
                           step="${c.step}" min="${c.min}" max="${c.max}" data-coeff="${c.name}" />`;
                slidersDiv.appendChild(row);
            }
        }

        this._bindEvents(obj);
    }

    destroy(): void {
        for (const cleanup of this._sliderCleanups) cleanup();
        this._sliderCleanups = [];
    }

    // ============================================================
    //  事件绑定
    // ============================================================

    private _bindEvents(obj: MathObject): void {
        if (obj.kind !== 'vector_field') return;

        // 更新分量按钮
        // 更新分量按钮
        this._container.querySelector('#vfUpdateBtn')?.addEventListener('click', () => {
            const inputs = this._container.querySelectorAll<HTMLInputElement>('[data-comp]');
            const newComps: [string, string, string] = ['', '', ''];
            inputs.forEach(inp => {
                const idx = parseInt(inp.dataset.comp!);
                newComps[idx] = inp.value.trim() || obj.components[idx];
            });

            // 重新解析分量表达式
            const { nodeP, nodeQ, nodeR, coefficients } = parseVectorField(newComps);
            obj.components = newComps;
            (obj as any).nodeP = nodeP;
            (obj as any).nodeQ = nodeQ;
            (obj as any).nodeR = nodeR;
            obj.coefficients.length = 0;
            obj.coefficients.push(...coefficients);

            // 重新渲染滑块区域(系数可能变了)
            this.destroy();
            this.render(obj);
        });

        // 滑块
        this._sliderCleanups.push(
            SliderBinding.bindAll(this._container, (name, value) => {
                this._applySliderChange(obj, name, value);
            }, { debounceMs: 100 }),
        );
    }

    private _applySliderChange(obj: MathObject, name: string, value: number): void {
        if (obj.kind !== 'vector_field') return;
        const id = obj.id;

        switch (name) {
            case 'xMin': obj.range.x[0] = value; break;
            case 'xMax': obj.range.x[1] = value; break;
            case 'yMin': obj.range.y[0] = value; break;
            case 'yMax': obj.range.y[1] = value; break;
            case 'zMin': obj.range.z[0] = value; break;
            case 'zMax': obj.range.z[1] = value; break;
            case 'gridX': obj.gridSize[0] = Math.round(value); break;
            case 'gridY': obj.gridSize[1] = Math.round(value); break;
            case 'gridZ': obj.gridSize[2] = Math.round(value); break;
            case 'glyphScale': obj.glyphScale = value; break;
            default:
                // 系数滑块
                this._objectManager.setCoefficient(id, name, value);
                this._eventBus.emit('coefficient:changed', { id });
                return;
        }
        this._eventBus.emit('mathobj:updated', { id });
    }
}