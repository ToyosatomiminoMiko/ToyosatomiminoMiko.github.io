/*
SETTING 标签页的**背景切换区**(声明式标记).

原先这两张缩略图写死在 index.html 的 `<ul class="bgul">` 里,改一张图要同时
记得"列表项类名 / 图片类名 / 文案"三处约定;现在清单在 site.config.ts 的
BACKGROUND_PRESETS 里声明,标记由这里生成.

本模块只交出**缩略图列表**这一个节点:SETTING 页的标题("设置")属于整页那张
bootstrap 卡片,由 site_shell.ts 放进 `.card-header`(类名与文案见 site.config.ts
的 SETTING_CARD_*),背景区自己不再带第二个同名标题.

注意本模块**只有标记没有行为**:点击切换是文档级事件委托(见 common/background.ts),
所以增删缩略图不会掉监听,也不需要把元素引用传出去.
*/

import { create_element } from 'miko_ui';
import {
    BACKGROUND_IMAGE_CLASS,
    BACKGROUND_ITEM_CLASS,
    BACKGROUND_LIST_CLASS,
    BACKGROUND_PRESETS,
} from '@/common/site.config';

/**
 * 生成背景缩略图列表(顺序即 BACKGROUND_PRESETS 的顺序),交给 SETTING 卡片的
 * `.card-body` 当第一个子节点.
 *
 * 缩略图带 `alt=""`:它右边紧挨着的 `<span>` 已经写着同一张图的名字,
 * 再念一遍文件名对读屏用户只是噪音(装饰性图片的标准写法).
 *
 * 圆角不再靠 bootstrap 的 `.rounded` 工具类(那会把圆角绑死在
 * `--bs-border-radius*` 上):缩略图只有 `.bgimg` 一个类,圆角写在站点的
 * `.bgimg` 规则里,引 miko_ui 主题的 `--radius-sm`.
 */
export function createBackgroundSection(): HTMLUListElement {
    const items = BACKGROUND_PRESETS.map((preset) =>
        create_element(
            { tag: 'li' },
            { class: BACKGROUND_ITEM_CLASS },
            create_element(
                { tag: 'img' },
                { class: BACKGROUND_IMAGE_CLASS, src: preset.src, alt: '' },
            ),
            create_element({ tag: 'span' }, {}, preset.label),
        ),
    );
    return create_element({ tag: 'ul' }, { class: BACKGROUND_LIST_CLASS }, ...items);
}
