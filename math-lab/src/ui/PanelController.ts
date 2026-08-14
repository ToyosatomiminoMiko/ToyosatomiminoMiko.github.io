/**
 * 通用面板折叠控制器.
 * 折叠时只保留一个写有面板名称的按钮，点击可重新展开.
 */
export class PanelController {
    bind(root: HTMLElement): void {
        root.querySelectorAll<HTMLElement>('[data-panel-toggle]').forEach((button) => {
            button.addEventListener('click', () => {
                const selector = button.dataset.panelToggle;
                if (!selector) return;

                const panel = document.querySelector<HTMLElement>(selector);
                if (!panel) return;

                const header = button.closest<HTMLElement>('.panel-header');
                const collapsed = panel.classList.toggle('collapsed');
                const title = panel.querySelector<HTMLElement>('.panel-title')?.textContent ?? '面板';

                for (const child of Array.from(panel.children)) {
                    if (child === header) continue;
                    (child as HTMLElement).style.display = collapsed ? 'none' : '';
                }

                button.textContent = collapsed ? title : '收起';
            });
        });
    }
}
