// --- 导入样式 ---
import 'bootstrap/dist/css/bootstrap.min.css';

// --- 导入 JS 依赖 ---
import 'bootstrap/dist/js/bootstrap.bundle.min.js';
import { mountClock } from '@/clock/clock';
import { mountRBT } from '@/rbt/rbt';
import { OLEDCanvas } from '@/oled/oled';
import { mountIEEE754 } from '@/ieee754/ieee754';
import { mountMetroWindowAtMountIds } from '@/metro_window/src/metro_window';
import { mountBackgroundSwitcher } from '@/common/background';
import { mountHeaderState } from '@/common/header_state';

document.addEventListener('DOMContentLoaded', () => {
    // 背景切换:把 SETTING 标签页缩略图的 URL 写进 --bg-image-active 令牌
    mountBackgroundSwitcher();

    // 导航条:压在首屏画面上时隐形(只有文字),滚过去/切走标签页变实底
    mountHeaderState();

    // 挂载所有独立控件(原生 TS)
    mountClock();
    mountRBT();
    new OLEDCanvas();
    mountIEEE754();
    // 地铁车窗拆成两块:舞台(画布)挂在 HOME 的空宿主 #metro-window 上,
    // 控制台(整套设置面板)挂在 SETTING 的空宿主 #metro-params 上(挂载点 id
    // 见其 config.ts 的 MOUNT_IDS).组件内部按可见性自动暂停/恢复,
    // 切走标签页不会让 GPU 空转.
    mountMetroWindowAtMountIds();
});
