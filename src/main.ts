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
是库的 `createSlider`,OLED 数据区那颗输入框则是库的 `createCodeEditor`,所以
库自带的默认主题(`tokens.css`)必须引进来:库的控件
只写结构,颜色 / 圆角 / 间距一律 `var(--...)`,那一层的默认值就在 `tokens.css`.
库的主题是暗色,与本站深色画面同一路.

撞名处理:库的主题在 `:root` 上给出 `--radius-sm` / `--radius-md`,本站只在
**需要非零圆角**的地方引用它们(时钟面板为此另存了一个语义名
`--clock-panel-radius`,见 public/css/tokens.css),不自己重定义这两个名字,
所以库主题进来不会顺手把非按钮的圆角改掉.
*/
import 'miko_ui/styles/tokens.css';
import 'miko_ui/styles/widgets.css';
/*
编辑器外壳:OLED 数据区那颗 `createCodeEditor`(导出与导入共用,见
src/oled/ui/oled_panel.ts)读这一层的 `.code-editor*` 规则 -- 外框 / 行号槽 /
"透明 textarea + 背后高亮层"的严格重叠都在里面.本站样式表只给这个外框补
定高与可纵向拖动.
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
import { mountPageOpacity } from '@/common/page_opacity';
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

    // 标签页:点击 / 方向键 / 显隐(整个仓库唯一的"标签页"实现)
    mountTabs({ list: shell.navList, links: shell.navLinks, panes: shell.panes });

    // 背景切换:把 SETTING 标签页缩略图的 URL 写进 --bg-image-active 令牌
    // (点的是骨架生成的缩略图,行为走文档级委托,所以顺序无关)
    mountBackgroundSwitcher();

    // 页面透明度:往背景行(.bgrow)里追加那条滑块,拖它写 --tab-pane-opacity 令牌.
    // 宿主不是空容器(里面已经有两颗背景缩略图),所以这个挂载是 append 不是接管.
    mountPageOpacity(shell.backgroundRow);

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
