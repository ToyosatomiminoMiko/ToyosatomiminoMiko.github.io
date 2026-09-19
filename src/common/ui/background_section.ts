/*
SETTING 标签页的**背景切换区**(声明式标记).

原先这两张缩略图写死在 index.html 的 `<ul class="bgul">` 里,改一张图要同时
记得"列表项类名 / 图片类名 / 文案"三处约定;现在清单在 site.config.ts 的
BACKGROUND_PRESETS 里声明,标记由这里生成.

注意本模块**只有标记没有行为**:点击切换是文档级事件委托(见 common/background.ts),
所以增删缩略图不会掉监听,也不需要把元素引用传出去.
*/

import { h, type DomChild } from '@/common/dom';
import {
    BACKGROUND_IMAGE_CLASS,
    BACKGROUND_IMAGE_ROUNDED_CLASS,
    BACKGROUND_ITEM_CLASS,
    BACKGROUND_LIST_CLASS,
    BACKGROUND_PRESETS,
    BACKGROUND_SECTION_TITLE,
} from '@/common/site.config';

/**
 * 生成"修改背景"整块:标题 + 缩略图列表(顺序即 BACKGROUND_PRESETS 的顺序).
 *
 * 缩略图带 `alt=""`:它右边紧挨着的 `<span>` 已经写着同一张图的名字,
 * 再念一遍文件名对读屏用户只是噪音(装饰性图片的标准写法).
 */
export function createBackgroundSection(): readonly DomChild[] {
    const items = BACKGROUND_PRESETS.map((preset) =>
        h('li', { class: BACKGROUND_ITEM_CLASS }, [
            h('img', {
                class: `${BACKGROUND_IMAGE_ROUNDED_CLASS} ${BACKGROUND_IMAGE_CLASS}`,
                attrs: { src: preset.src, alt: '' },
            }),
            h('span', { text: preset.label }),
        ]),
    );
    return [
        h('h4', { text: BACKGROUND_SECTION_TITLE }),
        h('ul', { class: BACKGROUND_LIST_CLASS }, items),
    ];
}
