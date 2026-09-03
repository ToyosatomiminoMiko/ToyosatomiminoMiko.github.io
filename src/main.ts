// --- 导入样式 ---
import 'bootstrap/dist/css/bootstrap.min.css';

// --- 导入 JS 依赖 ---
import 'bootstrap/dist/js/bootstrap.bundle.min.js';
import { mountClock } from './clock';
// PAGES 标签页需要后端数据接口(文章列表/图片等),当前仓库没有后端,
// 页面结构保留在 index.html,后端就绪前不挂载.
//import { mountPages } from './page';
import { mountRBT } from './rbt';
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

    // 挂载所有独立控件(原生 TS)
    mountClock();
    // 见文件头注释:PAGES 依赖后端,暂不 mountPages()
    //mountPages();
    mountRBT();
    new OLEDCanvas();
});
