/*
页面透明度:SETTING 标签页背景行里那条滑块,拖它调整个站标签页窗格的 opacity.

唯一真值是文档根上的 CSS 自定义属性 `--tab-pane-opacity`(默认值在
public/css/tokens.css,消费方是 index.css 的 `.tab-pane` 规则).拖动只改写这一个
令牌,所以 JS 侧不存"当前透明度",也就没有"状态与画面不一致"这种中间态 -- 与
src/common/background.ts 的换背景同一套路.

与背景切换唯一的区别是值的来源:那边是文档级点击委托(骨架增删缩略图都不用重挂
监听),这边只能从库的滑块句柄上订阅 -- 条目的引用在挂载时就交回来了,委托在这里
既没有对象也没有好处.

两个刻意的选择:

1. **不往窗格上写内联 opacity**:窗格显隐靠 `.tab-pane.fade:not(.show)
   { opacity: 0 }`,内联样式压得过它,切走的窗格就会以半透明留在页面上.写令牌,
   让 CSS 里那条 (0,3,0) 的隐藏规则继续赢.
2. **挂载时不写令牌**:CSS 里的默认值就是初值,再写一次等于在 JS 里存了第二份
   "初值";只要两处都等于 site.config.ts 的 PAGE_OPACITY_DEFAULT 就不会分叉.
*/

import { createSlider, type SliderHandle } from 'miko_ui';
import {
    PAGE_OPACITY_DEFAULT,
    PAGE_OPACITY_FIELD_CLASS,
    PAGE_OPACITY_LABEL,
    PAGE_OPACITY_MAX,
    PAGE_OPACITY_MIN,
    PAGE_OPACITY_STEP,
    PAGE_OPACITY_VARIABLE,
} from '@/common/site.config';

/**
 * 值 -> 文本.
 *
 * 固定两位小数:滑杆的取值是 `min + n * step`(step = 0.01),浮点累加会算出
 * 0.8999999999999999 这种数,直接 `String()` 会把它写进数值框与 CSS.
 * 数值框这边还必须给**纯数字**文本:它是 `<input type="number">`,
 * 写 "90%" 会被浏览器当成非法值丢掉(框里变空),所以这里不做百分比换算.
 */
function formatOpacity(value: number): string {
    return value.toFixed(2);
}

/**
 * 数值框写回值源前的夹取.
 *
 * 只挂在数值框上:滑杆本身由浏览器按 min/max 夹住,越不了界,再过一遍是多余的
 * (见库 `widgets/Slider.ts` 的 `normalize` 那条注释).
 */
function clampOpacity(value: number): number {
    return Math.min(PAGE_OPACITY_MAX, Math.max(PAGE_OPACITY_MIN, value));
}

/**
 * 把"页面透明度"滑块追加到宿主里并接上行为,返回库的滑块句柄.
 *
 * @param host 背景缩略图行(`.bgrow`).**用 append 而不是 replaceChildren**:
 *             这个宿主里已经有背景缩略图(见 ui/background_section.ts),本模块
 *             只往里加第三条参数行,不是独占它.
 */
export function mountPageOpacity(host: HTMLElement): SliderHandle {
    const slider = createSlider({
        // 初值 / 区间 / 重置目标:口径都在 site.config.ts 里,这里不写死任何数.
        value: PAGE_OPACITY_DEFAULT,
        min: PAGE_OPACITY_MIN,
        max: PAGE_OPACITY_MAX,
        step: PAGE_OPACITY_STEP,
        label: PAGE_OPACITY_LABEL,
        resetValue: PAGE_OPACITY_DEFAULT,
        format: formatOpacity,
        normalize: clampOpacity,
    });
    // 站点只加"它在行里占多宽"这一个类;库的 `.slider-field` 保住内部排布.
    slider.element.classList.add(PAGE_OPACITY_FIELD_CLASS);

    slider.onInput((value) => {
        document.documentElement.style.setProperty(PAGE_OPACITY_VARIABLE, formatOpacity(value));
    });

    host.append(slider.element);
    return slider;
}
