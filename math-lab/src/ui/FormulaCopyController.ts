/**
 * 公式复制控制器.
 *
 * 场景里的公式是 KaTeX 排版出来的展示元素,本身不可选中.这里做一层事件委托:
 * 点任意一个带 `data-tex` 的公式,就把它的原始 TeX 写进剪贴板.
 *
 * 为什么用委托而不是逐个绑定:
 * 公式 DOM 由 ObjectListController 在每次 sync 时整体重建
 * (createFormulaElement 返回的是模板 clone),逐个绑定会在重建后失效.
 *
 * 为什么提示只有一处:
 * "可复制"的文案只在底部"实体对象"标题旁出现,复制成功/失败也改那一处回显;
 * 公式本身只用 cursor 表达可点,不在每行挂 tooltip,避免列表被提示文字淹没.
 */

const HINT_RESET_DELAY = 1200;

const HINT_COPIED = '已复制 TeX';
const HINT_FAILED = '复制失败';

/** 优先走异步剪贴板 API;非安全上下文(如 file://)回退到 execCommand. */
async function writeClipboardText(text: string): Promise<boolean> {
    if (navigator.clipboard && window.isSecureContext) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch {
            // 权限被拒或浏览器实现异常时,继续尝试旧通道而不是直接失败.
        }
    }
    return legacyCopy(text);
}

/** 旧通道:临时 textarea + execCommand('copy'),兜住非 https 的本地打开场景. */
function legacyCopy(text: string): boolean {
    const staging = document.createElement('textarea');
    staging.value = text;
    staging.setAttribute('readonly', '');
    staging.style.position = 'fixed';
    staging.style.top = '-1000px';
    staging.style.opacity = '0';
    document.body.append(staging);
    staging.select();

    let copied = false;
    try {
        copied = document.execCommand('copy');
    } catch {
        copied = false;
    }
    staging.remove();
    return copied;
}

export class FormulaCopyController {
    private readonly defaultHint: string;
    private abortController: AbortController | null = null;

    /**
     * @cache
     * 缓存目的:回显定时器句柄;连续点击时重置同一个 timer,而不是叠加多个.
     * 键/失效策略:无键;每次回显清旧建新,dispose 时清除.
     * 生命周期:跟随 FormulaCopyController 实例.
     */
    private resetTimer: number | null = null;

    constructor(private readonly hint: HTMLElement) {
        this.defaultHint = hint.textContent ?? '';
    }

    bind(root: HTMLElement): void {
        this.abortController?.abort();
        this.abortController = new AbortController();
        root.addEventListener('click', this.onClick, {
            signal: this.abortController.signal,
        });
    }

    dispose(): void {
        this.abortController?.abort();
        this.abortController = null;
        if (this.resetTimer !== null) {
            clearTimeout(this.resetTimer);
            this.resetTimer = null;
        }
        this.hint.textContent = this.defaultHint;
        this.hint.classList.remove('is-copied', 'is-error');
    }

    private readonly onClick = (event: MouseEvent): void => {
        const target = event.target;
        if (!(target instanceof Element)) return;

        const formula = target.closest<HTMLElement>('[data-tex]');
        const tex = formula?.dataset.tex;
        if (!tex) return;

        void this._copy(tex);
    };

    private async _copy(tex: string): Promise<void> {
        const copied = await writeClipboardText(tex);
        this._flashHint(copied ? HINT_COPIED : HINT_FAILED, copied);
    }

    /** 回显写在"实体对象"标题旁的提示元素上,延时后恢复原文案. */
    private _flashHint(message: string, ok: boolean): void {
        if (this.resetTimer !== null) clearTimeout(this.resetTimer);

        this.hint.textContent = message;
        this.hint.classList.toggle('is-copied', ok);
        this.hint.classList.toggle('is-error', !ok);

        this.resetTimer = window.setTimeout(() => {
            this.resetTimer = null;
            this.hint.textContent = this.defaultHint;
            this.hint.classList.remove('is-copied', 'is-error');
        }, HINT_RESET_DELAY);
    }
}
