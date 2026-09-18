/**
 * 418 专用: 引用该页内联 sprite 里的图标.
 *
 * sprite 本身写在 418.html 里(一组 <symbol id="i-...">),这里只负责生成引用它的
 * <svg> 片段 -- 用于 JS 动态拼 HTML 的场景(静态标记直接写在 HTML 里即可).
 * 样式见 shared/icon.css.
 */

/** <svg> 上的类名(对应 shared/icon.css 的 .icon) */
const ICON_CLASS = 'icon';

/** 让图标对读屏软件隐藏 -- 相邻文字已经说明了含义 */
const ICON_ARIA_HIDDEN = 'true';

/** 不参与键盘 Tab 聚焦(图标永远只是装饰) */
const ICON_FOCUSABLE = 'false';

export function icon(id: string, style = ''): string {
    const styleAttr = style ? ` style="${style}"` : '';
    return `<svg class="${ICON_CLASS}" aria-hidden="${ICON_ARIA_HIDDEN}" focusable="${ICON_FOCUSABLE}"${styleAttr}><use href="#${id}"></use></svg>`;
}
