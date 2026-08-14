import { EventBus } from '../service/EventBus';
import type { MathLabEvents } from '../types';

/**
 * 旋转锁定开关:锁定旋转时仍允许平移和缩放.
 */
export class RotationLockController {
    private readonly toggle: HTMLInputElement | null;

    constructor(private readonly eventBus: EventBus<MathLabEvents>) {
        this.toggle = document.getElementById('rotationLockToggle') as HTMLInputElement | null;
        this.toggle?.addEventListener('change', () => {
            this.eventBus.emit('camera:rotationLock', { locked: this.toggle?.checked ?? false });
        });
    }
}
