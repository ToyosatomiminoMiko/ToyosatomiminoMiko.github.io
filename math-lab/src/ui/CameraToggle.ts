import { EventBus } from '../service/EventBus';
import type { MathLabEvents, CamMode } from '../types';

/**
 * 相机投影模式切换开关 透视 <-> 正交
 */
export class CameraToggle {
    eventBus: EventBus<MathLabEvents>;
    camToggle: HTMLInputElement;
    camLabels: NodeListOf<HTMLElement>;
    currentCam: CamMode;

    constructor(eventBus: EventBus<MathLabEvents>) {
        this.eventBus = eventBus;
        this.camToggle = document.getElementById('camToggle') as HTMLInputElement;
        this.camLabels = document.querySelectorAll('.cam-label');
        this.currentCam = 'perspective';

        this.camToggle.addEventListener('change', (e: Event) => {
            const mode: CamMode = (e.target as HTMLInputElement).checked
                ? 'orthographic'
                : 'perspective';
            this._setCamMode(mode);
        });

        this.camLabels.forEach(label => {
            label.addEventListener('click', () => {
                const mode = label.dataset.cam as CamMode | undefined;
                if (mode && mode !== this.currentCam) {
                    this.camToggle.checked = mode === 'orthographic';
                    this._setCamMode(mode);
                }
            });
        });

        this._syncUI();
    }

    private _setCamMode(mode: CamMode): void {
        if (mode === this.currentCam) return;
        this.currentCam = mode;
        this.eventBus.emit('camera:changed', { camMode: mode });
        this._syncUI();
    }

    private _syncUI(): void {
        this.camLabels.forEach(label => {
            label.classList.toggle('active', label.dataset.cam === this.currentCam);
        });
    }
}