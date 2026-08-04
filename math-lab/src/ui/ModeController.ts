import { EventBus } from '../service/EventBus';
import type { MathLabEvents, ViewMode } from '../types';

/**
 * 2D/3D 模式切换控制器
 */
export class ModeController {
    eventBus: EventBus<MathLabEvents>;
    modeBtns: NodeListOf<HTMLElement>;
    currentMode: ViewMode;

    constructor(eventBus: EventBus<MathLabEvents>) {
        this.eventBus = eventBus;
        this.modeBtns = document.querySelectorAll('[data-mode]');
        this.currentMode = '2d';

        this.modeBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const mode = (btn as HTMLElement).dataset.mode as ViewMode | undefined;
                if (mode && mode !== this.currentMode) {
                    this.currentMode = mode;
                    this.modeBtns.forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    this.eventBus.emit('mode:changed', { mode });
                }
            });
        });

        // 初始激活
        const defaultBtn = document.querySelector('[data-mode="2d"]');
        defaultBtn?.classList.add('active');
    }

    getMode(): ViewMode {
        return this.currentMode;
    }
}