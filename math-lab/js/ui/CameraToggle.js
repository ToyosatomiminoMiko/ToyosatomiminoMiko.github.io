export class CameraToggle {
    /**
     * @param {import('../service/EventBus.js').EventBus} eventBus
     */
    constructor(eventBus) {
        this.eventBus = eventBus;
        this.camToggle = document.getElementById('camToggle');
        this.camLabels = document.querySelectorAll('.cam-label');
        this.currentCam = 'perspective';

        this.camToggle.addEventListener('change', (e) => {
            const mode = e.target.checked ? 'orthographic' : 'perspective';
            this._setCamMode(mode);
        });

        this.camLabels.forEach(label => {
            label.addEventListener('click', () => {
                const mode = label.dataset.cam;
                if (mode && mode !== this.currentCam) {
                    this.camToggle.checked = (mode === 'orthographic');
                    this._setCamMode(mode);
                }
            });
        });

        this._syncUI();
    }

    _setCamMode(mode) {
        if (mode === this.currentCam) return;
        this.currentCam = mode;
        this.eventBus.emit('camera:changed', { camMode: mode });
        this._syncUI();
    }

    _syncUI() {
        this.camLabels.forEach(label => {
            label.classList.toggle('active', label.dataset.cam === this.currentCam);
        });
    }
}