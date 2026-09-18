/*
独立页面入口(/metro_window/).

只做一件事:把组件挂到容器上.站点首页的欢迎页走的是同一个 mountMetroWindow,
所以这个页面同时也是一个"不依赖站点首页"的最小验证入口.
*/
import { mountMetroWindow } from './metro-window';

const root = document.getElementById('metro-window');
if (!root) {
    throw new Error('找不到挂载点 #metro-window');
}
mountMetroWindow(root);
