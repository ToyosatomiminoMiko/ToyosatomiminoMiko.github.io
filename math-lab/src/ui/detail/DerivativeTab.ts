import type { Tab } from './Tab';
import type { MathObject } from '../../math_objects/types';
import type { MathObjectManager } from '../../math_objects/MathObjectManager';
import type { EventBus } from '../../service/EventBus';
import type { MathLabEvents } from '../../types';
import type { SelectionManager } from '../SelectionManager';
import { reportError } from '../error';

export class DerivativeTab implements Tab {
    private _container: HTMLElement;
    private _objectManager: MathObjectManager;
    private _eventBus: EventBus<MathLabEvents>;
    private _selectionManager: SelectionManager;
    private _abortController: AbortController | null = null;

    constructor(
        container: HTMLElement,
        objectManager: MathObjectManager,
        eventBus: EventBus<MathLabEvents>,
        selectionManager: SelectionManager,
    ) {
        this._container = container;
        this._objectManager = objectManager;
        this._eventBus = eventBus;
        this._selectionManager = selectionManager;
    }

    isVisible(kind: string | null): boolean {
        return kind === 'curve' || kind === 'surface';
    }

    render(obj: MathObject): void {
        let html = '<div class="deriv-row">';

        if (obj.kind === 'curve') {
            html += `
                <span class="deriv-label">导</span>
                <button class="deriv-btn" id="derivBtnX">d/dx</button>`;
        } else if (obj.kind === 'surface') {
            html += `
                <span class="deriv-label">偏导</span>
                <button class="deriv-btn" id="derivBtnX">∂/∂x</button>
                <button class="deriv-btn" id="derivBtnY">∂/∂y</button>`;
        } else {
            this._container.innerHTML =
                '<div class="detail-hint">求导仅适用于曲线或曲面</div>';
            return;
        }

        html += '</div>';
        this._container.innerHTML = html;

        // 用 AbortController 管理事件监听生命周期
        this._abortController = new AbortController();
        const signal = this._abortController.signal;

        const btnX = this._container.querySelector<HTMLElement>('#derivBtnX');
        const btnY = this._container.querySelector<HTMLElement>('#derivBtnY');

        btnX?.addEventListener('click', () => {
            this._doDerivative(obj.id, obj.kind as 'curve' | 'surface', 'x');
        }, { signal });

        btnY?.addEventListener('click', () => {
            this._doDerivative(obj.id, 'surface', 'y');
        }, { signal });
    }

    destroy(): void {
        this._abortController?.abort();
        this._abortController = null;
    }

    // ============================================================
    //  求导逻辑
    // ============================================================

    private _doDerivative(id: number, kind: 'curve' | 'surface', variable: 'x' | 'y'): void {
        try {
            const deriv =
                kind === 'curve'
                    ? this._objectManager.deriveCurve(id)
                    : this._objectManager.deriveSurface(id, variable);

            this._eventBus.emit('mathobj:added', { object: deriv });
            this._selectionManager.select(deriv.id, deriv.kind);
        } catch (err) {
            reportError(err, '求导');
        }
    }
}
