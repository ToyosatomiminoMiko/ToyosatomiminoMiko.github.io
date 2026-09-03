import { EventBus } from '../../service/EventBus';
import type { MathLabEvents } from '../../types';

/**
 * 旋转锁定开关:锁定旋转时仍允许平移和缩放.
 */
export class RotationLockController {
    private readonly toggle: HTMLInputElement | null;
    private readonly _abortController = new AbortController();
    private rotationLocked: boolean;

    constructor(private readonly eventBus: EventBus<MathLabEvents>) {
        this.toggle = document.getElementById('rotationLockToggle') as HTMLInputElement | null;
        this.rotationLocked = this.toggle?.checked ?? false;
        this.toggle?.addEventListener('change', () => {
            this.rotationLocked = this.toggle?.checked ?? false;
            this.eventBus.emit('camera:rotationLock', { locked: this.rotationLocked });
        }, { signal: this._abortController.signal });
    }

    /** 当前是否锁定旋转,供切换向上轴重建 OrbitControls 后恢复. */
    get locked(): boolean {
        return this.rotationLocked;
    }

    dispose(): void {
        this._abortController.abort();
    }
}
