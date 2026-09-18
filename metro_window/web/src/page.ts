/*
独立页面入口(/metro_window/).

只做一件事:把组件挂到容器上.站点首页的欢迎页走的是同一个 mountMetroWindow,
所以这个页面同时也是一个"不依赖站点首页"的最小验证入口.
挂载点 id 与报错文案取自 ./config.ts.
*/
import './metro_index.css';

import { MISSING_MOUNT_MESSAGE_PREFIX, MOUNT_ID } from './config';
import { mountMetroWindow } from './metro_window';

const root = document.getElementById(MOUNT_ID);
if (!root) {
    throw new Error(`${MISSING_MOUNT_MESSAGE_PREFIX}${MOUNT_ID}`);
}
mountMetroWindow(root);
