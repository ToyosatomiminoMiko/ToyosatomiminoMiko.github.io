type PanelId = 'left-panel' | 'right-panel' | 'bottom-panel';

const SIDE_MIN_WIDTH = 220;
const SIDE_MAX_WIDTH = 560;
const SIDE_DEFAULT_WIDTH = 300;
const FOOTER_MIN_HEIGHT = 120;
const FOOTER_MAX_HEIGHT = 520;
const FOOTER_DEFAULT_HEIGHT = 200;
const COLLAPSED_SIDE_WIDTH = 44;
const COLLAPSED_FOOTER_HEIGHT = 40;

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

/**
 * 面板布局控制器.
 *
 * 负责:
 * - 左/右 aside 的宽度调整
 * - 底部 footer 的高度调整
 * - 折叠/展开,折叠时同步 footer 的左右边界
 */
export class PanelController {
    private root: HTMLElement | null = null;
    private _abortController: AbortController | null = null;
    private readonly sideWidths: Record<'left-panel' | 'right-panel', number> = {
        'left-panel': SIDE_DEFAULT_WIDTH,
        'right-panel': SIDE_DEFAULT_WIDTH,
    };
    private footerHeight = FOOTER_DEFAULT_HEIGHT;
    private readonly collapsed = new Set<PanelId>();

    bind(root: HTMLElement): void {
        this.root = root;
        this._abortController?.abort();
        this._abortController = new AbortController();

        const signal = this._abortController.signal;
        this._bindToggleButtons(root, signal);
        this._bindResizeHandles(root, signal);
        this._applyLayout();
    }

    dispose(): void {
        this._abortController?.abort();
        this._abortController = null;
        this.root = null;
        this.collapsed.clear();
        document.body.style.cursor = '';
    }

    private _bindToggleButtons(root: HTMLElement, signal: AbortSignal): void {
        root.querySelectorAll<HTMLElement>('[data-panel-toggle]').forEach((button) => {
            button.addEventListener('click', () => {
                const selector = button.dataset.panelToggle;
                if (!selector) return;

                const panel = document.querySelector<HTMLElement>(selector);
                if (!panel) return;

                const header = button.closest<HTMLElement>('.panel-header');
                const collapsed = panel.classList.toggle('collapsed');
                const title =
                    panel.querySelector<HTMLElement>('.panel-title')?.textContent ?? '面板';

                for (const child of Array.from(panel.children)) {
                    if (child === header) continue;
                    (child as HTMLElement).style.display = collapsed ? 'none' : '';
                }

                const panelId = selector.replace('#', '') as PanelId;
                if (collapsed) {
                    this.collapsed.add(panelId);
                } else {
                    this.collapsed.delete(panelId);
                }

                button.textContent = collapsed ? title : '收起';
                this._applyLayout();
            }, { signal });
        });
    }

    private _bindResizeHandles(root: HTMLElement, signal: AbortSignal): void {
        root.querySelectorAll<HTMLElement>('[data-resize-panel]').forEach((handle) => {
            const panelId = handle.dataset.resizePanel as PanelId | undefined;
            if (!panelId) return;

            handle.addEventListener('pointerdown', (event: PointerEvent) => {
                if (this.collapsed.has(panelId)) return;
                event.preventDefault();

                const startX = event.clientX;
                const startY = event.clientY;
                const startLeftWidth = this.sideWidths['left-panel'];
                const startRightWidth = this.sideWidths['right-panel'];
                const startFooterHeight = this.footerHeight;
                const cursor = getComputedStyle(handle).cursor;
                document.body.style.cursor = cursor;

                const onPointerMove = (moveEvent: PointerEvent): void => {
                    if (panelId === 'left-panel') {
                        this.sideWidths['left-panel'] = clamp(
                            startLeftWidth + (moveEvent.clientX - startX),
                            SIDE_MIN_WIDTH,
                            SIDE_MAX_WIDTH,
                        );
                    } else if (panelId === 'right-panel') {
                        this.sideWidths['right-panel'] = clamp(
                            startRightWidth + (startX - moveEvent.clientX),
                            SIDE_MIN_WIDTH,
                            SIDE_MAX_WIDTH,
                        );
                    } else {
                        this.footerHeight = clamp(
                            startFooterHeight + (startY - moveEvent.clientY),
                            FOOTER_MIN_HEIGHT,
                            FOOTER_MAX_HEIGHT,
                        );
                    }

                    this._applyLayout();
                };

                const onPointerUp = (): void => {
                    window.removeEventListener('pointermove', onPointerMove);
                    window.removeEventListener('pointerup', onPointerUp);
                    window.removeEventListener('pointercancel', onPointerUp);
                    document.body.style.cursor = '';
                };

                window.addEventListener('pointermove', onPointerMove, { signal });
                window.addEventListener('pointerup', onPointerUp, { signal });
                window.addEventListener('pointercancel', onPointerUp, { signal });
            }, { signal });
        });
    }

    private _applyLayout(): void {
        if (!this.root) return;

        this.root.style.setProperty(
            '--left-panel-width',
            `${this.collapsed.has('left-panel') ? COLLAPSED_SIDE_WIDTH : this.sideWidths['left-panel']}px`,
        );
        this.root.style.setProperty(
            '--right-panel-width',
            `${this.collapsed.has('right-panel') ? COLLAPSED_SIDE_WIDTH : this.sideWidths['right-panel']}px`,
        );
        this.root.style.setProperty(
            '--footer-height',
            `${this.collapsed.has('bottom-panel') ? COLLAPSED_FOOTER_HEIGHT : this.footerHeight}px`,
        );
    }
}
