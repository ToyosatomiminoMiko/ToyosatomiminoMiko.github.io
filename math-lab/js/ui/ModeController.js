export class ModeController {
    /**
     * @param {import('../service/EventBus.js').EventBus} eventBus
     */
    constructor(eventBus) {
        this.eventBus = eventBus;
        this.modeBtns = document.querySelectorAll('[data-mode]');
        this.currentMode = '2d';

        this.modeBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const mode = btn.dataset.mode;
                if (mode && mode !== this.currentMode) {
                    this.currentMode = mode;
                    this.modeBtns.forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    this.eventBus.emit('mode:changed', { mode });
                }
            });
        });

        // 初始激活
        document.querySelector('[data-mode="2d"]')?.classList.add('active');
    }

    getMode() { return this.currentMode; }
}