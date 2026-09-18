/*
独立页面入口(/metro_window/).

只做一件事:把组件挂到容器上.站点首页的欢迎页走的是同一个 mountMetroWindow,
所以这个页面同时也是一个"不依赖站点首页"的最小验证入口.

页面级样式(page.css)在这里引入,而不是塞进 index.html 的 <style>:
样式一律外置,HTML 里不留 CSS.
*/
import './page.css';

import { mountMetroWindow } from './metro_window';

const root = document.getElementById('metro-window');
if (!root) {
    throw new Error('找不到挂载点 #metro-window');
}
mountMetroWindow(root);
