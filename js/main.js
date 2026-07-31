import { mountClock } from './clock.js';
import { mountPages } from './page.js';
import { mountRBT } from './rbt_lab.js';
import { OLEDCanvas } from '../dist-js/js/oled.js';

// 在 DOMContentLoaded 之前初始化
document.addEventListener('DOMContentLoaded', function () {
    // 背景切换
    const imgs = document.getElementsByClassName("bgimg");
    for (let i = 0; i < imgs.length; i++) {
        imgs[i].onclick = function () { // onclick事件会在元素被点击时发生
            //document.body.style.setProperty("backgroundImage", "url('" + this.src + "')", "important");
            document.body.style.cssText = 'background-image: url("' + this.src + '") !important;';
            //console.log('background changed:' + this.src);

        };
    }

    // 挂载所有 Vue 应用
    mountClock();
    mountPages();
    mountRBT();
    new OLEDCanvas();
});