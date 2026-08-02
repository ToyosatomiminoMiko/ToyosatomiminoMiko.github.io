// --- 导入样式 ---
import 'bootstrap/dist/css/bootstrap.min.css';
import 'katex/dist/katex.min.css';

// --- 导入 JS 依赖 ---
import 'bootstrap/dist/js/bootstrap.bundle.min.js';
import { mountClock } from './clock';
import { mountPages } from './page';
import { mountRBT } from './rbt_lab';
import { OLEDCanvas } from './oled';

document.addEventListener('DOMContentLoaded', () => {
    // 背景切换
    const imgs = document.getElementsByClassName('bgimg');
    for (let i = 0; i < imgs.length; i++) {
        const img = imgs[i] as HTMLImageElement;
        img.addEventListener('click', () => {
            document.body.style.cssText =
                'background-image: url("' + img.src + '") !important;';
        });
    }

    // 挂载所有 Vue 应用
    mountClock();
    mountPages();
    mountRBT();
    new OLEDCanvas();
});