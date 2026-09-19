// ================================================================
// 站点入口:生成骨架,再把各模块挂到骨架交回的空宿主上.
//
// 顺序有讲究:
//   1. `mountSiteShell()` 先生成整页骨架(导航条 / 首屏 / 五个标签页 / 所有空宿主),
//      并交回元素引用 -- 后面的模块全都靠这些引用,不按 id 查 DOM;
//   2. 各模块各自把标记长进自己的宿主(每个模块的挂载函数只认宿主,不认页面);
//   3. 最后挂行为:导航条状态与背景切换.
//
// 没有"按 id 找元素"这一步:骨架是唯一的结构来源,id 只留给 CSS 与调试定位.
// 单例约束照旧:地铁车窗的 wasm App 是 crate 内 thread_local 单例,一个页面只挂一次.
// ================================================================

// --- 导入样式 ---
import 'bootstrap/dist/css/bootstrap.min.css';

// --- 导入 JS 依赖 ---
import 'bootstrap/dist/js/bootstrap.bundle.min.js';
import { mountClock } from '@/clock/clock';
import { mountRBT } from '@/rbt/rbt';
import { mountOLED } from '@/oled/oled';
import { mountIEEE754 } from '@/ieee754/ieee754';
import { mountMetroWindow } from '@/metro_window/src/metro_window';
import { mountBackgroundSwitcher } from '@/common/background';
import { mountHeaderState } from '@/common/header_state';
import { mountSiteShell } from '@/common/ui/site_shell';

document.addEventListener('DOMContentLoaded', () => {
    // 1) 整页骨架:宿主建好,引用交回
    const shell = mountSiteShell();

    // 2) 各模块:只往宿主里长标记,宿主从骨架拿
    mountClock(shell.clockHost);
    mountOLED(shell.panes.oled);
    mountRBT(shell.panes.rbt);
    mountIEEE754(shell.panes.ieee754);

    // 背景切换:把 SETTING 标签页缩略图的 URL 写进 --bg-image-active 令牌
    // (点的是骨架生成的缩略图,行为走文档级委托,所以顺序无关)
    mountBackgroundSwitcher();

    // 导航条:压在首屏画面上时隐形(只有文字),滚过去/切走标签页变实底
    mountHeaderState({ header: shell.header, hero: shell.hero });

    // 地铁车窗:舞台在首屏,风格按钮在首屏底部,控制台与上传面板在 SETTING.
    // 挂载点 id 见 src/metro_window/src/config.ts 的 MOUNT_IDS --
    // 骨架按同一份清单建宿主,所以这里给的是引用而不是 id.
    mountMetroWindow({
        stage: shell.metroStage,
        styles: shell.metroStyles,
        panel: shell.metroPanel,
        uploads: shell.metroUploads,
    });
});
