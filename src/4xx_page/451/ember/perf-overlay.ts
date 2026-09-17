/**
 * 屏幕性能 HUD -- 只在显式开启时创建(?perf=1 或 EmberOptions.hud).
 *
 * 它是"打点"的眼睛: 把 FrameStats 的摘要贴在左上角, 直接看帧间隔,主线程占比,
 * GPU 三条 pass 的耗时.默认不开, 页面上一个多余的 DOM 都不加.
 *
 * 更新频率由引擎控制(每 statsIntervalFrames 帧一次), 这里只负责把字符串贴上去,
 * 而且刻意用 contain:strict 把这层隔离出去, 免得 HUD 自己反过来影响被测对象.
 */

export interface PerfOverlay {
    update(text: string): void;
    remove(): void;
}

const STYLE = [
    'position:fixed',
    'top:0',
    'left:0',
    'z-index:2147483647',
    'margin:0',
    'padding:4px 8px',
    'max-width:100vw',
    'background:rgba(0,0,0,0.72)',
    'color:#ffb37a',
    'font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace',
    'white-space:pre-wrap',
    'pointer-events:none',
    'contain:strict',
    'text-align:left',
].join(';');

export function createPerfOverlay(): PerfOverlay {
    const el = document.createElement('div');
    el.id = 'emberPerfHud';
    el.setAttribute('role', 'presentation');
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
