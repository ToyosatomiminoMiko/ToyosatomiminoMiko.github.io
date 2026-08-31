import { EventBus } from '../../service/EventBus';
import type { MathLabEvents } from '../../types';
import { RENDER_CONFIG } from '../../config/renderConfig';

type OriginMode = 'size' | 'scale';

/**
 * 原点小球控制.
 *
 * 大小与缩放是同一控制量的两种模式,而不是两个独立值:
 * - 设定大小:直接输入绝对半径,默认当前状态(0.2);
 * - 按比例缩放:以默认大小为基准输入比例,默认 1(即 100%);
 * - 可见开关:关闭后原点不可见.
 *
 * 切换模式时保持当前实际大小不变,只是换算显示方式.
 * 变化通过 EventBus 广播,由 RenderController 应用到场景.
 */
export class OriginPointController {
    private readonly visibleToggle: HTMLInputElement | null;
    private readonly valueInput: HTMLInputElement | null;
    private readonly valueLabel: HTMLLabelElement | null;
    private readonly modeButtons: NodeListOf<HTMLButtonElement>;
    private readonly _abortController = new AbortController();

    private readonly baseRadius = RENDER_CONFIG.scene.originPoint.radius;
    private mode: OriginMode = 'size';
    private sizeValue = this.baseRadius;
    private scaleValue = RENDER_CONFIG.scene.originPoint.scale;
    private visible = RENDER_CONFIG.scene.originPoint.visible;

    constructor(private readonly eventBus: EventBus<MathLabEvents>) {
        this.visibleToggle =
            document.getElementById('originVisible') as HTMLInputElement | null;
        this.valueInput =
            document.getElementById('originValue') as HTMLInputElement | null;
        this.valueLabel =
            document.getElementById('originValueLabel') as HTMLLabelElement | null;
        this.modeButtons =
            document.querySelectorAll<HTMLButtonElement>('[data-origin-mode]');

        if (this.visibleToggle) {
            this.visibleToggle.checked = this.visible;
        }

        const signal = this._abortController.signal;
        this.visibleToggle?.addEventListener('change', () => {
            this.visible = this.visibleToggle?.checked ?? true;
            this._emit();
        }, { signal });

        this.modeButtons.forEach((button) => {
            button.addEventListener('click', () => {
                const mode = button.dataset.originMode as OriginMode | undefined;
                if (!mode || mode === this.mode) return;
                this._switchMode(mode);
            }, { signal });
        });

        this.valueInput?.addEventListener('input', () => this._readInput(), { signal });
        this.valueInput?.addEventListener('change', () => this._readInput(), { signal });

        this._syncModeUI();
        // 启动时按配置同步一次,保证默认状态进入场景
        this._emit();
    }

    dispose(): void {
        this._abortController.abort();
    }

    private _switchMode(mode: OriginMode): void {
        if (this.mode === 'size') {
            // 保持当前实际大小,把绝对大小换算为相对默认大小的比例
            this.scaleValue = this.baseRadius > 0
                ? this.sizeValue / this.baseRadius
                : 0;
        } else {
            this.sizeValue = this.baseRadius * this.scaleValue;
        }
        this.mode = mode;
        this._syncModeUI();
        this._emit();
    }

    private _readInput(): void {
        if (!this.valueInput) return;
        const text = this.valueInput.value.trim();
        if (text === '') {
            // 清空时保留上一次合法值,不把空串当成 0
            this.valueInput.value = this._displayValue();
            return;
        }
        const raw = Number(text);
        if (!Number.isFinite(raw) || raw < 0) {
            this.valueInput.value = this._displayValue();
            return;
        }
        if (this.mode === 'size') {
            this.sizeValue = raw;
        } else {
            this.scaleValue = raw;
        }
        this._emit();
    }

    private _syncModeUI(): void {
        this.modeButtons.forEach((button) => {
            button.classList.toggle('active', button.dataset.originMode === this.mode);
        });
        if (this.valueLabel) {
            this.valueLabel.textContent = this.mode === 'size' ? '大小' : '缩放';
        }
        if (this.valueInput) {
            this.valueInput.step = this.mode === 'size' ? '0.05' : '0.1';
            this.valueInput.value = this._displayValue();
        }
    }

    private _displayValue(): string {
        const value = this.mode === 'size' ? this.sizeValue : this.scaleValue;
        return String(Number(value.toFixed(4)));
    }

    private _emit(): void {
        const radius = this.mode === 'size'
            ? this.sizeValue
            : this.baseRadius * this.scaleValue;
        this.eventBus.emit('origin:changed', {
            radius,
            visible: this.visible,
        });
    }
}
