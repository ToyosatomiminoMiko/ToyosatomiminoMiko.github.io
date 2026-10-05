// ================================================================
// 站点入口:生成骨架,再把各模块挂到骨架交回的空宿主上.
//
// 顺序有讲究:
//   1. `mountSiteShell()` 先生成整页骨架(导航条 / 首屏 / 六个空窗格 / 首屏那两颗
//      空宿主),并交回元素引用 -- 后面的模块全都靠这些引用,不按 id 查 DOM;
//   2. 各模块把标记长进骨架给的宿主(每个模块的挂载函数只认宿主,不认页面);
//      其中 Calendario 页自己长面板,再把面板顶部的时钟宿主转交给时钟模块;
//   3. SETTING 页自己建整张面板与三块设置组(src/setting/setting_page.ts),
//      再把交回的那三块组分给背景区与地铁车窗;
//   4. 最后挂行为:标签页切换,背景切换,导航条状态,地铁车窗(wasm 启动).
//
// 没有"按 id 找元素"这一步:骨架与设置页是唯一的结构来源,id 只留给 CSS 与调试定位.
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
**定尺(宽 / 高)**与可纵向拖动:库的默认是"外框随内容长,滚动归宿主",本站要的是
"定尺的盒子 + textarea 内部滚"(理由与实测见 public/css/index.css 那条规则).
*/
import 'miko_ui/styles/editor.css';
/*
滚动条(单独的一条规定):OLED 数据区的编辑器里唯一会滚的是库的 textarea
(定尺后竖着滚导出的 C 源码,长行横着滚),它在 oled_panel.ts 里挂了 `ui-scrollbar`.
*/
import 'miko_ui/styles/scrollbar.css';

// --- 导入 JS 依赖 ---
import { mountCalendar } from '@/calendar/calendar';
import { mountClock } from '@/clock/clock';
import { mountRBT } from '@/rbt/rbt';
import { mountOLED } from '@/oled/oled';
import { mountIEEE754 } from '@/ieee754/ieee754';
import { mountMetroWindow } from '@/metro_window/src/metro_window';
import { mountBackgroundSwitcher } from '@/setting/background';
import { mountPageOpacity } from '@/setting/page_opacity';
import { mountHeaderState } from '@/common/header_state';
import { mountTabs } from '@/common/tabs';
import { mountSiteShell } from '@/common/ui/site_shell';
import { mountBackgroundSection } from '@/setting/background_section';
import { mountSettingPage } from '@/setting/setting_page';

document.addEventListener('DOMContentLoaded', () => {
    // 1) 整页骨架:宿主建好,引用交回
    const shell = mountSiteShell();

    // 2) 各模块:只往骨架给的宿主里长标记
    //    Calendario 页整页(顶部时钟宿主 + 三张日历卡)由它自己长出来,再把时钟宿主
    //    转交给时钟模块 -- LED 时钟从 HOME 首屏搬到了这一页顶部,但时钟的标记与
    //    行为仍然只在 src/clock/ 里(挂载函数只认宿主,不认页面).
    const calendar = mountCalendar(shell.panes.calendar);
    mountClock(calendar.clockHost);
    mountOLED(shell.panes.oled);
    mountRBT(shell.panes.rbt);
    mountIEEE754(shell.panes.ieee754);

    // 3) SETTING 页:整页面板与三块设置组由它自己建(骨架只给它一个空窗格),
    //    三块组都是空 fieldset,内容由下面几个模块分别长进去.
    const setting = mountSettingPage(shell.panes.setting);
    // 背景组:挂载函数交回组里那条行 -- 页面透明度滑块要往它里面追加
    const backgroundRow = mountBackgroundSection(setting.backgroundGroup);
    // 页面透明度:往背景组里那条行(.bgrow)追加滑块,拖它写 --tab-pane-opacity 令牌.
    // 宿主不是空容器(里面已经有两颗背景缩略图),所以这个挂载是 append 不是接管.
    mountPageOpacity(backgroundRow);

    // 标签页:点击 / 方向键 / 显隐(整个仓库唯一的"标签页"实现)
    mountTabs({ list: shell.navList, links: shell.navLinks, panes: shell.panes });

    // 背景切换:把 SETTING 标签页缩略图的 URL 写进 --bg-image-active 令牌
    // (点的是设置页生成的缩略图,行为走文档级委托,所以顺序无关)
    mountBackgroundSwitcher();

    // 导航条:压在首屏画面上时隐形(只有文字),滚过去/切走标签页变实底
    mountHeaderState({ header: shell.header, hero: shell.hero });

    // 地铁车窗:舞台在首屏,风格按钮在首屏底部,控制台与上传面板长进 SETTING 页
    // 交回的那两块设置组里.挂载点是**元素引用**,组件不按 id 查 DOM.
    mountMetroWindow({
        stage: shell.metroStage,
        styles: shell.metroStyles,
        panel: setting.paramsGroup,
        uploads: setting.uploadsGroup,
    });
});
