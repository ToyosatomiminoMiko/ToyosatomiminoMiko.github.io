/**
 * 451 的启动流程: 判断开关 -> 起引擎(带超时) -> 把结果写到 <html data-ember="...">.
 *
 * 刻意的取舍: WebGPU 起不来就什么都不画,不做 Canvas2D / WebGL 降级.
 * 全部常量见 boot.config.ts.
 */
import { EmberWebGPU, type EmberOptions } from './ember';
import { log } from './ember/log';
import {
    CANVAS_ID,
    DISABLE_QUERY_PARAM,
    EMBER_STATUS,
    INIT_TIMEOUT_MS,
    PERF_LOG_INTERVAL_MS,
    PERF_LOG_PREFIX,
    PERF_QUERY_PARAM,
    STATUS_DATASET_KEY,
    STATUS_DETAIL_BOOT_ERROR,
    STATUS_DETAIL_DATASET_KEY,
    STATUS_DETAIL_DISABLED,
    STATUS_DETAIL_INIT_FAILED,
    STATUS_EVENT_NAME,
    type EmberStatus,
} from './boot.config';

/** 引擎参数 + boot 层自己的开关(超时是启动流程的事,引擎不关心) */
export interface EmberBootOptions extends EmberOptions {
    /** 初始化超时,默认 8000ms; 软件适配器首次编译管线可能更慢 */
    initTimeoutMs?: number;
}

/**
 * 把初始化结果挂到 <html data-ember="..."> 上并派发事件,
 * 便于控制台/自动化检查本次是否真的走了 GPU 绘制.
 */
function reportStatus(status: EmberStatus, detail: string): void {
    const root = document.documentElement;
    root.dataset[STATUS_DATASET_KEY] = status;
    if (detail) root.dataset[STATUS_DETAIL_DATASET_KEY] = detail;
    document.dispatchEvent(new CustomEvent(STATUS_EVENT_NAME, { detail: { status, detail } }));
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
        return new URLSearchParams(location.search).has(DISABLE_QUERY_PARAM);
    } catch {
        return false;
    }
}

/** ?perf=1 时打开性能 HUD(并把摘要打到控制台) */
function perfEnabled(): boolean {
    try {
        return new URLSearchParams(location.search).has(PERF_QUERY_PARAM);
    } catch {
        return false;
    }
}

/** 页面入口调用;自身不会 reject */
export async function startEmber(): Promise<void> {
    try {
        const canvas = document.getElementById(CANVAS_ID);
        if (!(canvas instanceof HTMLCanvasElement)) return;

        if (drawingDisabled()) {
            canvas.remove();
            reportStatus(EMBER_STATUS.disabled, STATUS_DETAIL_DISABLED);
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
            reportStatus(EMBER_STATUS.unavailable, STATUS_DETAIL_INIT_FAILED);
            return;
        }

        if (perf) {
            // HUD 打开时顺手把摘要打到控制台, 限频到 1 秒一条, 免得刷屏
            let lastLog = 0;
            const report = ember.reportStats.bind(ember);
            ember.onStats = () => {
                const now = performance.now();
                if (now - lastLog < PERF_LOG_INTERVAL_MS) return;
                lastLog = now;
                console.info(PERF_LOG_PREFIX, report());
            };
        }

        ember.start();
        reportStatus(EMBER_STATUS.running, ember.textureFormat);
        // 方便调试: window.__ember.dispose()
        window.__ember = ember;
        // 打点读数: window.__emberStats() 取快照, window.__emberReport() 取一行摘要
        window.__emberStats = () => ember.getStats();
        window.__emberReport = () => ember.reportStats();
    } catch (error: unknown) {
        const reason = error instanceof Error ? error.message : STATUS_DETAIL_BOOT_ERROR;
        log('启动异常, 放弃绘制:', reason);
        document.getElementById(CANVAS_ID)?.remove();
        reportStatus(EMBER_STATUS.unavailable, reason);
    }
}
