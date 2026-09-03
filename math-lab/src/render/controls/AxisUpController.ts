import { EventBus } from '../../service/EventBus';
import type { MathLabEvents } from '../../types';
import { RENDER_CONFIG, type UpAxis } from '../../config/renderConfig';

/**
 * 坐标轴"向上"方向控制.
 *
 * 三选一:X / Y / Z 的正方向朝上.
 * 默认取 renderConfig.scene.upAxis(Z,数学/工程习惯),
 * 图形工具习惯的用户可切到 Y.变化通过 EventBus 广播,
 * 由 RenderController 应用到相机.
 */
export class AxisUpController {
    private readonly buttons: NodeListOf<HTMLButtonElement>;
    private readonly _abortController = new AbortController();
    private axis: UpAxis = RENDER_CONFIG.scene.upAxis;

    constructor(private readonly eventBus: EventBus<MathLabEvents>) {
        this.buttons =
            document.querySelectorAll<HTMLButtonElement>('[data-axis-up]');

        const signal = this._abortController.signal;
        this.buttons.forEach((button) => {
            const axis = button.dataset.axisUp as UpAxis | undefined;
            button.addEventListener('click', () => {
                if (!axis || axis === this.axis) return;
                this.axis = axis;
                this._syncUI();
                this._emit();
            }, { signal });
        });

        this._syncUI();
        // 启动时按配置同步一次,保证默认状态进入场景
        this._emit();
    }

    dispose(): void {
        this._abortController.abort();
    }

    private _syncUI(): void {
        this.buttons.forEach((button) => {
            button.classList.toggle('active', button.dataset.axisUp === this.axis);
        });
    }

    private _emit(): void {
        this.eventBus.emit('axis:upChanged', { axis: this.axis });
    }
}
