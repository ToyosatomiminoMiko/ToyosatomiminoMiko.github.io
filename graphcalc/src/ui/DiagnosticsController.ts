/**
 * 仅保留错误与警告的紧凑提示控制器.
 *
 * 计算成功信息不进入这里;解析/编译错误/资源降采样等警告
 * 会显示在右侧参数滑块下方.
 */
export type DiagnosticLevel = 'warning' | 'error';

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
