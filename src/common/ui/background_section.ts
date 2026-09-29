/*
SETTING 标签页的**背景切换区**(声明式标记).

原先这两张缩略图写死在 index.html 的 `<ul class="bgul">` 里,改一张图要同时
记得"列表项类名 / 图片类名 / 文案"三处约定;现在清单在 site.config.ts 的
BACKGROUND_PRESETS 里声明,标记由这里生成.

本模块只交出**那一行缩略图按钮**这一个节点:SETTING 页的标题("设置")属于整页
那张面板,由 site_shell.ts 交给库的 `createPanel` 放进 `.ui-panel-header`(标题
文案见 site.config.ts 的 SETTING_PANEL_TITLE),背景区自己不再带第二个同名标题.

**整块 tile 是一颗库的按钮**(`createButton`,基线类 `.ui-button`),缩略图与名字
都在按钮里面:这样"点一下换背景"是一个真正的控件 -- 键盘能聚焦,回车/空格能触发,
焦点态与悬停态由库的基线给,点击目标也从"只有那张 <img>"扩到整块 tile.
本站只在 index.css 的 `.bgbtn` 里盖住基线中要改的部分(块的排布与内边距),
底色 / 描边 / 悬停 / 焦点全按库的基线走.

注意本模块**只有标记没有行为**:点击切换是文档级事件委托(见 common/background.ts),
所以增删缩略图不会掉监听,也不需要把元素引用传出去.

这一行**不是本模块独占的**:页面透明度滑块(common/page_opacity.ts)在挂载时往同一个
`.bgrow` 里 append 第三条参数行,所以这里的"行"只是"背景缩略图 + 那条滑块排在一起"的
flex 容器.本模块按自己的清单生成缩略图,不替滑块留位,也不管它排在哪儿.
*/

import { createButton, create_element } from 'miko_ui';
import {
    BACKGROUND_BUTTON_CLASS,
    BACKGROUND_IMAGE_CLASS,
    BACKGROUND_PRESETS,
    BACKGROUND_ROW_CLASS,
} from '@/common/site.config';

/**
 * 生成背景缩略图行(顺序即 BACKGROUND_PRESETS 的顺序),交给 SETTING 面板的
 * `.ui-panel-body` 当第一个子节点.
 *
 * 结构:`<div class="bgrow"><button type="button" class="ui-button bgbtn">...</button> ...</div>`.
 * 只有两颗按钮时不需要列表语义:一层 `<ul><li>` 既不带来可访问性(读屏里
 * "列表,2 项"对两个并列按钮没有信息量),又要靠浮动排版 + `flow-root` 收高,
 * 所以列表撤掉,行由 `.bgrow` 的 flex 摊开.
 *
 * 按钮的文案走库的 `text`(可访问名就是这个名字,不必再补 `aria-label`);
 * 缩略图在按钮建好之后 `prepend` 进去,排在文案前面.
 *
 * 缩略图带 `alt=""`:同一颗按钮的文字已经写着这张图的名字,再念一遍只是读屏噪音
 * (装饰性图片的标准写法).
 *
 * CSS 只认 `.bgrow`(行排布),`.bgimg`(尺寸)与 `.bgbtn`(块的排布 / 内边距)
 * 三个类;圆角写在站点的 `.bgimg` 规则里,引 miko_ui 主题的 `--radius-sm`.
 */
export function createBackgroundSection(): HTMLDivElement {
    const buttons = BACKGROUND_PRESETS.map((preset) => {
        const button = createButton({ text: preset.label, class: BACKGROUND_BUTTON_CLASS });
        button.element.prepend(
            create_element(
                { tag: 'img' },
                { class: BACKGROUND_IMAGE_CLASS, src: preset.src, alt: '' },
            ),
        );
        return button.element;
    });
    return create_element({ tag: 'div' }, { class: BACKGROUND_ROW_CLASS }, ...buttons);
}
