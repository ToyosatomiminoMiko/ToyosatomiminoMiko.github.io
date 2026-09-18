/**
 * 屏幕性能 HUD -- 只在显式开启时创建(?perf=1 或 EmberOptions.hud).
 *
 * 它是"打点"的眼睛: 把 FrameStats 的摘要贴在左上角, 直接看帧间隔,主线程占比,
 * GPU 三条 pass 的耗时.默认不开, 页面上一个多余的 DOM 都不加.
 *
 * 更新频率由引擎控制(每 statsIntervalFrames 帧一次), 这里只负责把字符串贴上去,
 * 而且刻意用 contain:strict 把这层隔离出去, 免得 HUD 自己反过来影响被测对象.
 *
 * 全部样式常量见 perf_overlay.config.ts.
 */
import {
    PERF_OVERLAY_BG,
    PERF_OVERLAY_COLOR,
    PERF_OVERLAY_FONT,
    PERF_OVERLAY_ID,
    PERF_OVERLAY_MAX_WIDTH,
    PERF_OVERLAY_PADDING,
    PERF_OVERLAY_ROLE,
    PERF_OVERLAY_Z_INDEX,
} from './perf_overlay.config';

export interface PerfOverlay {
    update(text: string): void;
    remove(): void;
}

const STYLE = [
    'position:fixed',
    'top:0',
    'left:0',
    `z-index:${PERF_OVERLAY_Z_INDEX}`,
    'margin:0',
    `padding:${PERF_OVERLAY_PADDING}`,
    `max-width:${PERF_OVERLAY_MAX_WIDTH}`,
    `background:${PERF_OVERLAY_BG}`,
    `color:${PERF_OVERLAY_COLOR}`,
    `font:${PERF_OVERLAY_FONT}`,
    'white-space:pre-wrap',
    'pointer-events:none',
    'contain:strict',
    'text-align:left',
].join(';');

export function createPerfOverlay(): PerfOverlay {
    const el = document.createElement('div');
    el.id = PERF_OVERLAY_ID;
    el.setAttribute('role', PERF_OVERLAY_ROLE);
    el.style.cssText = STYLE;
    (document.body ?? document.documentElement).appendChild(el);

    return {
        update(text: string): void {
            el.textContent = text;
        },
        remove(): void {
            el.remove();
        },
    };
}
