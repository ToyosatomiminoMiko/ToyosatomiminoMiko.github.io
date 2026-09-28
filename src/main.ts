// ================================================================
// 站点入口:生成骨架,再把各模块挂到骨架交回的空宿主上.
//
// 顺序有讲究:
//   1. `mountSiteShell()` 先生成整页骨架(导航条 / 首屏 / 五个标签页 / 所有空宿主),
//      并交回元素引用 -- 后面的模块全都靠这些引用,不按 id 查 DOM;
//   2. 各模块各自把标记长进自己的宿主(每个模块的挂载函数只认宿主,不认页面);
//   3. 最后挂行为:标签页切换与导航条状态.
//
// 没有"按 id 找元素"这一步:骨架是唯一的结构来源,id 只留给 CSS 与调试定位.
// 单例约束照旧:地铁车窗的 wasm App 是 crate 内 thread_local 单例,一个页面只挂一次.
// ================================================================

// --- 导入样式 ---
/*
UI 库的主题与控件样式.

站内**所有按钮**现在都由 `miko_ui` 生成(OLED / IEEE754 / 地铁车窗),滑块也一直
是库的 `createSlider`,OLED 数据区那两个输入框则是库的 `createCodeEditor`,所以
库自带的默认主题(`tokens.css`)必须引进来:库的控件
只写结构,颜色 / 圆角 / 间距一律 `var(--...)`,那一层的默认值就在 `tokens.css`.
库的主题是暗色,与本站深色画面同一路.

撞名处理:`tokens.css` 会把 `--radius-sm` / `--radius-md` 写成它自己的默认值
(0px),而本站原来也用这两个名字给坐标条与时钟面板定圆角.本站那两条已按用途
改名(`--coords-radius` / `--clock-panel-radius`,见 `public/css/tokens.css`),
所以库主题进来不会顺手把非按钮的圆角改掉.
*/
import 'miko_ui/styles/tokens.css';
import 'miko_ui/styles/widgets.css';
/*
编辑器外壳:OLED 数据区的两套 `createCodeEditor`(见 src/oled/ui/oled_panel.ts)
读这一层的 `.code-editor*` 规则 -- 外框 / 行号槽 / "透明 textarea + 背后高亮层"
的严格重叠都在里面.本站样式表只给这个外框补最小高度与可纵向拖动.
*/
import 'miko_ui/styles/editor.css';
/*
滚动条(单独的一条规定):OLED 数据区的编辑器里唯一会滚的是库的 textarea
(定高后竖着滚导出的 C 源码),它在 oled_panel.ts 里挂了 `ui-scrollbar`.
*/
import 'miko_ui/styles/scrollbar.css';

// --- 导入 JS 依赖 ---
import { mountClock } from '@/clock/clock';
import { mountRBT } from '@/rbt/rbt';
import { mountOLED } from '@/oled/oled';
import { mountIEEE754 } from '@/ieee754/ieee754';
import { mountMetroWindow } from '@/metro_window/src/metro_window';
import { mountBackgroundSwitcher } from '@/common/background';
import { mountHeaderState } from '@/common/header_state';
import { mountTabs } from '@/common/tabs';
import { mountSiteShell } from '@/common/ui/site_shell';

document.addEventListener('DOMContentLoaded', () => {
    // 1) 整页骨架:宿主建好,引用交回
    const shell = mountSiteShell();

    // 2) 各模块:只往宿主里长标记,宿主从骨架拿
    mountClock(shell.clockHost);
    mountOLED(shell.panes.oled);
    mountRBT(shell.panes.rbt);
    mountIEEE754(shell.panes.ieee754);

    // 标签页:点击 / 方向键 / 显隐(整个仓库唯一的"标签页"实现,不再是 bootstrap)
    mountTabs({ list: shell.navList, links: shell.navLinks, panes: shell.panes });

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
