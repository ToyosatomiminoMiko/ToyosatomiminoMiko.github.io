import { logError, logWarning } from '../service/logger';

/**
 * 统一的 UI 错误处理入口.
 * 页面内所有用户可见的错误提示统一走这里,避免 alert/console 混用.
 */

const TOAST_DURATION_MS = 3600;

let toastContainer: HTMLDivElement | null = null;

function getToastContainer(): HTMLDivElement {
    if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.className = 'math-lab-toast-container';
        document.body.appendChild(toastContainer);
    }
    return toastContainer;
}

function showToast(message: string): void {
    const container = getToastContainer();
    const toast = document.createElement('div');
    toast.className = 'math-lab-toast math-lab-toast--error';
    toast.textContent = message;
    container.appendChild(toast);

    window.setTimeout(() => {
        toast.classList.add('math-lab-toast--leaving');
        window.setTimeout(() => toast.remove(), 240);
    }, TOAST_DURATION_MS);
}

/** 用户主动触发的校验/操作错误:既提示用户,也写入控制台. */
export function notifyError(message: string): void {
    logError('MathLab', message);
    showToast(message);
}

/** 未预期的运行时错误:记录上下文后提示用户. */
export function reportError(error: unknown, context?: string): void {
    const message = error instanceof Error ? error.message : String(error);
    logError(context ?? 'MathLab', message);
    showToast(message);
}

/** 非阻塞警告:只写控制台,不打断用户. */
export function reportWarning(message: string, context?: string): void {
    logWarning(context ?? 'MathLab', message);
}
