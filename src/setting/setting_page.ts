/*
SETTING 标签页的骨架生成者:整页面板 + 三块设置组.

结构(三块组由本函数建,内容由各自的模块往里长):

    #setting
      section.ui-panel                         <- 库的 createPanel,标题在 .ui-panel-header
        header.ui-panel-header > span.ui-panel-title  "设置"
        div.ui-panel-body
          fieldset.setting-group#setting-bg     <- 背景组(背景缩略图行 + 页面透明度滑块)
          fieldset.setting-group#metro-params   <- 车窗实时参数控制台
          fieldset.setting-group#metro-uploads  <- 车窗图层贴图上传面板

**宿主就是那颗设置组 fieldset**:面板体的直接子节点正好三颗组,没有 `div` 包
`fieldset` 的空壳.三块组是同一种东西的三份实例,所以它们的 id / 类名由这里统一
建,内容各自交回给对应模块去填:

  - 背景 -> `mountBackgroundSection(group)`(本目录 background_section.ts)
  - 实时参数 / 图层贴图 -> `mountMetroWindow({ panel, uploads })`
    (@/metro_window/src/metro_window)

各模块都按"整体接管宿主内容"的约定办事(`replaceChildren`),所以重复挂载不会插
两份.本函数也走同一条约定:`replaceChildren` 面板,重复调用不会插两张面板.

样式:`tokens.css` 与 `setting.css` 在本模块引入(与组件在自己的入口里引样式
同一条做法),页面里三块组的观感只由 `setting.css` 的 `.setting-group` 一份定义.
*/

import { create_element, createPanel } from 'miko_ui';

import '@/setting/setting.css';

import { SETTING_GROUP_CLASS, SETTING_GROUP_IDS, SETTING_PANEL_TITLE } from '@/setting/config';

/** 挂载后交回的元素引用(各模块只认宿主,不按 id 查 DOM) */
export interface SettingPageSlots {
    /** 整页面板根 `section.ui-panel` */
    readonly panel: HTMLElement;
    /** 背景设置组:交给 background_section.ts 填 */
    readonly backgroundGroup: HTMLFieldSetElement;
    /** 实时参数设置组:交给地铁车窗的控制台 */
    readonly paramsGroup: HTMLFieldSetElement;
    /** 图层贴图设置组:交给地铁车窗的上传面板 */
    readonly uploadsGroup: HTMLFieldSetElement;
}

/**
 * 建一颗**空的**设置组.
 *
 * 只给类名与 id:框体(内边距 / 底色 / 描边 / legend 观感)由样式表的
 * `.setting-group` 一份定义,legend 与内容都由填它的模块放进来(组标题属于内容,
 * 不属于框体).
 */
function createSettingGroup(id: string): HTMLFieldSetElement {
    return create_element({ tag: 'fieldset' }, { class: SETTING_GROUP_CLASS, id });
}

/**
 * 把 SETTING 页长进窗格,交回三块设置组.
 *
 * @param pane 标签页窗格(`#setting`),由站点骨架建;骨架不替本页记任何结构
 */
export function mountSettingPage(pane: HTMLElement): SettingPageSlots {
    const backgroundGroup = createSettingGroup(SETTING_GROUP_IDS.background);
    const paramsGroup = createSettingGroup(SETTING_GROUP_IDS.params);
    const uploadsGroup = createSettingGroup(SETTING_GROUP_IDS.uploads);

    const { element: panel } = createPanel({
        title: SETTING_PANEL_TITLE,
        // 顺序即界面顺序:背景在最前(它整页可见),车窗两块在后.
        body: [backgroundGroup, paramsGroup, uploadsGroup],
    });
    // 与各模块同一条约定:整体接管,重复挂载不会插两张面板.
    pane.replaceChildren(panel);

    return { panel, backgroundGroup, paramsGroup, uploadsGroup };
}
