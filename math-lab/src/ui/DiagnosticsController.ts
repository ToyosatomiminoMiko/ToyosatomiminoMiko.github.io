/**
 * 诊断输出控制器.
 * 从 DslApp 拆出,负责清空诊断区域并添加分级日志.
 */
export type DiagnosticLevel = 'info' | 'warning' | 'error' | 'log';

export class DiagnosticsController {
    constructor(private readonly container: HTMLElement) {}

    clear(): void {
        this.container.replaceChildren();
    }

    add(level: DiagnosticLevel, message: string): void {
        const entry = document.createElement('div');
        entry.className = `diagnostic diagnostic-${level}`;
        entry.textContent = `[${level}] ${message}`;
        this.container.appendChild(entry);
    }

    dispose(): void {
        this.clear();
    }
}
