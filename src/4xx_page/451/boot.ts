/**
 * 451 的启动流程: 判断开关 -> 起引擎(带超时) -> 把结果写到 <html data-ember="...">.
 *
 * 刻意的取舍: WebGPU 起不来就什么都不画,不做 Canvas2D / WebGL 降级.
 */
import { EmberWebGPU, type EmberOptions } from './ember';

/** 个别驱动上 requestAdapter/requestDevice 会长时间不返回,超时就按失败处理 */
const INIT_TIMEOUT_MS = 8000;

/** 引擎参数 + boot 层自己的开关(超时是启动流程的事,引擎不关心) */
export interface EmberBootOptions extends EmberOptions {
    /** 初始化超时,默认 8000ms; 软件适配器首次编译管线可能更慢 */
    initTimeoutMs?: number;
}

/** 见 README 的 data-ember 对照表 */
type EmberStatus = 'running' | 'unavailable' | 'disabled';

/**
 * 把初始化结果挂到 <html data-ember="..."> 上并派发事件,
 * 便于控制台/自动化检查本次是否真的走了 GPU 绘制.
 */
function reportStatus(status: EmberStatus, detail: string): void {
    const root = document.documentElement;
    root.dataset.ember = status;
    if (detail) root.dataset.emberDetail = detail;
    document.dispatchEvent(new CustomEvent('ember:status', { detail: { status, detail } }));
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
        promise,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`init-timeout-${ms}ms`)), ms)),
    ]);
}

/** 用户主动关闭 / ?nogpu=1 时直接放弃绘制 */
function drawingDisabled(): boolean {
    if (window.__emberDisabled === true) return true;
    try {
        return new URLSearchParams(location.search).has('nogpu');
    } catch {
        return false;
    }
}

/** ?perf=1 时打开性能 HUD(并把摘要打到控制台) */
function perfEnabled(): boolean {
    try {
        return new URLSearchParams(location.search).has('perf');
    } catch {
        return false;
    }
}

/** 页面入口调用;自身不会 reject */
export async function startEmber(): Promise<void> {
    try {
        const canvas = document.getElementById('emberCanvas');
        if (!(canvas instanceof HTMLCanvasElement)) return;

        if (drawingDisabled()) {
            canvas.remove();
            reportStatus('disabled', 'disabled-by-flag');
            return;
        }

        const options: EmberBootOptions = { ...(window.__emberOptions ?? {}) };
        const perf = perfEnabled();
        if (perf) options.hud = true;

        const ember = new EmberWebGPU(canvas, options);

        const ready = await withTimeout(ember.init(), options.initTimeoutMs ?? INIT_TIMEOUT_MS);
        if (!ready) {
            // 用户明确要求: WebGPU 调用失败就放弃绘制, 不做 Canvas2D/WebGL 降级
            ember.dispose();
            reportStatus('unavailable', 'webgpu-init-failed');
            return;
        }

        if (perf) {
            // HUD 打开时顺手把摘要打到控制台, 限频到 1 秒一条, 免得刷屏
            let lastLog = 0;
            const report = ember.reportStats.bind(ember);
            ember.onStats = () => {
                const now = performance.now();
                if (now - lastLog < 1000) return;
                lastLog = now;
                console.info('[451/perf]', report());
            };
        }

        ember.start();
        reportStatus('running', ember.textureFormat);
        // 方便调试: window.__ember.dispose()
        window.__ember = ember;
        // 打点读数: window.__emberStats() 取快照, window.__emberReport() 取一行摘要
        window.__emberStats = () => ember.getStats();
        window.__emberReport = () => ember.reportStats();
    } catch (error: unknown) {
        const reason = error instanceof Error ? error.message : 'boot-error';
        console.info('[451/ember] 启动异常, 放弃绘制:', reason);
        document.getElementById('emberCanvas')?.remove();
        reportStatus('unavailable', reason);
    }
}
