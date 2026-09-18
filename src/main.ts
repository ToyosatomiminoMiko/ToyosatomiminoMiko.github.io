// --- 导入样式 ---
import 'bootstrap/dist/css/bootstrap.min.css';

// --- 导入 JS 依赖 ---
import 'bootstrap/dist/js/bootstrap.bundle.min.js';
import { mountClock } from './clock';
import { mountRBT } from './rbt';
import { OLEDCanvas } from './oled';
import { mountIEEE754 } from './ieee754';
import { mountMetroWindowAtMountId } from './metro_window/web/src/metro_window';
import { BACKGROUND_IMAGE_CLASS, BACKGROUND_IMAGE_STYLE_PROPERTY } from './site.config';

document.addEventListener('DOMContentLoaded', () => {
    // 背景切换
    const imgs = document.getElementsByClassName(BACKGROUND_IMAGE_CLASS);
    for (let i = 0; i < imgs.length; i++) {
        const img = imgs[i] as HTMLImageElement;
        img.addEventListener('click', () => {
            document.body.style.cssText =
                BACKGROUND_IMAGE_STYLE_PROPERTY + ': url("' + img.src + '") !important;';
        });
    }

    // 挂载所有独立控件(原生 TS)
    mountClock();
    mountRBT();
    new OLEDCanvas();
    mountIEEE754();
    // 地铁车窗挂到 HOME 卡片的空宿主 #metro-window 上(挂载点 id 见其 config.ts).
    // 组件内部按可见性自动暂停/恢复,切走标签页不会让 GPU 空转.
    mountMetroWindowAtMountId();
});
