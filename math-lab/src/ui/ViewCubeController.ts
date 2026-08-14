import { EventBus } from '../service/EventBus';
import type { MathLabEvents, ViewHome } from '../types';

/**
 * ViewCube 控制器:统一 3D 场景下的预置观察方向切换.
 */
export class ViewCubeController {
    private readonly buttons: NodeListOf<HTMLElement>;

    constructor(private readonly eventBus: EventBus<MathLabEvents>) {
        this.buttons = document.querySelectorAll<HTMLElement>('[data-view]');

        this.buttons.forEach((button) => {
            button.addEventListener('click', () => {
                const view = button.dataset.view as ViewHome | undefined;
                if (!view) return;

                this.buttons.forEach((item) => item.classList.toggle('active', item === button));
                this.eventBus.emit('camera:view', { view });
            });
        });
    }
}
