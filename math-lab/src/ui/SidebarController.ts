/**
 * 左侧抽屉控制器:打开/关闭 + 宽度拖拽.
 * 从 main.ts 中剥离,避免启动脚本直接包含纯 UI 逻辑.
 */
export class SidebarController {
    private readonly toggleBtn: HTMLButtonElement;
    private readonly panel: HTMLElement;
    private readonly resizeHandle: HTMLElement;

    private readonly minWidth = 280;
    private readonly maxWidth = 900;
    private panelWidth = 600;
    private isDragging = false;
    private startX = 0;
    private startWidth = 0;

    private readonly onMouseDown = (event: MouseEvent): void => {
        this.isDragging = true;
        this.startX = event.clientX;
        this.startWidth = this.panel.offsetWidth;
        this.resizeHandle.classList.add('dragging');
        document.body.style.userSelect = 'none';
        event.preventDefault();
    };

    private readonly onMouseMove = (event: MouseEvent): void => {
        if (!this.isDragging) return;
        const delta = event.clientX - this.startX;
        const nextWidth = Math.max(
            this.minWidth,
            Math.min(this.maxWidth, this.startWidth + delta),
        );
        this.applyPanelWidth(nextWidth);
        this.panelWidth = nextWidth;
    };

    private readonly onMouseUp = (): void => {
        if (!this.isDragging) return;
        this.isDragging = false;
        this.resizeHandle.classList.remove('dragging');
        document.body.style.userSelect = '';
    };

    constructor() {
        this.toggleBtn = document.getElementById('sidebarToggleBtn') as HTMLButtonElement;
        this.panel = document.getElementById('panel') as HTMLElement;
        this.resizeHandle = document.getElementById('resizeHandle') as HTMLElement;
    }

    init(): void {
        this.toggleBtn.addEventListener('click', () => {
            const isOpen = this.panel.classList.toggle('open');
            this.toggleBtn.textContent = isOpen ? '◀' : '▶';
        });

        this.resizeHandle.addEventListener('mousedown', this.onMouseDown);
        document.addEventListener('mousemove', this.onMouseMove);
        document.addEventListener('mouseup', this.onMouseUp);

        this.applyPanelWidth(this.panelWidth);
    }

    dispose(): void {
        document.removeEventListener('mousemove', this.onMouseMove);
        document.removeEventListener('mouseup', this.onMouseUp);
    }

    private applyPanelWidth(width: number): void {
        this.panel.style.width = `${width}px`;
        document.documentElement.style.setProperty('--panel-width', `${width}px`);
    }
}
