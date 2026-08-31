import { EventBus } from '../../service/EventBus';
import type { MathLabEvents } from '../../types';
import { RENDER_CONFIG } from '../../config/renderConfig';

/**
 * 原点小球控制.
 *
 * 提供三种能力:
 * - 设定大小:默认当前状态(0.2),可输入具体数值;
 * - 按比例缩放:在设定大小基础上乘以缩放系数;
 * - 不可见:关闭可见开关后隐藏原点.
 *
 * 变化通过 EventBus 广播,由 RenderController 应用到场景.
 */
export class OriginPointController {
    private readonly visibleToggle: HTMLInputElement | null;
    private readonly sizeInput: HTMLInputElement | null;
    private readonly scaleInput: HTMLInputElement | null;
    private readonly _abortController = new AbortController();

    private size = RENDER_CONFIG.scene.originPoint.radius;
    private scale = RENDER_CONFIG.scene.originPoint.scale;

    constructor(private readonly eventBus: EventBus<MathLabEvents>) {
        this.visibleToggle =
            document.getElementById('originVisible') as HTMLInputElement | null;
        this.sizeInput =
            document.getElementById('originSize') as HTMLInputElement | null;
        this.scaleInput =
            document.getElementById('originScale') as HTMLInputElement | null;

        if (this.visibleToggle) {
            this.visibleToggle.checked = RENDER_CONFIG.scene.originPoint.visible;
        }
        if (this.sizeInput) {
            this.sizeInput.value = String(this.size);
        }
        if (this.scaleInput) {
            this.scaleInput.value = String(this.scale);
        }

        const signal = this._abortController.signal;
        this.visibleToggle?.addEventListener('change', () => this._emit(), { signal });
        this.sizeInput?.addEventListener('input', () => this._emit(), { signal });
        this.sizeInput?.addEventListener('change', () => this._emit(), { signal });
        this.scaleInput?.addEventListener('input', () => this._emit(), { signal });
        this.scaleInput?.addEventListener('change', () => this._emit(), { signal });

        // 启动时按配置同步一次,保证默认状态进入场景
        this._emit();
    }

    dispose(): void {
        this._abortController.abort();
    }

    private _emit(): void {
        this.size = this._readNonNegative(this.sizeInput, this.size);
        this.scale = this._readNonNegative(this.scaleInput, this.scale);

        if (this.sizeInput) this.sizeInput.value = String(this.size);
        if (this.scaleInput) this.scaleInput.value = String(this.scale);

        this.eventBus.emit('origin:changed', {
            size: this.size,
            scale: this.scale,
            visible: this.visibleToggle?.checked ?? true,
        });
    }

    /** 读取数值输入,非法(空/NaN/负数)时回退到上一次合法值. */
    private _readNonNegative(
        input: HTMLInputElement | null,
        fallback: number,
    ): number {
        if (!input) return fallback;
        const text = input.value.trim();
        if (text === '') return fallback;
        const raw = Number(text);
        if (!Number.isFinite(raw) || raw < 0) return fallback;
        return raw;
    }
}
