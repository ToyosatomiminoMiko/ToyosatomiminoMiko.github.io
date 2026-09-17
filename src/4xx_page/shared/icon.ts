/**
 * 418 专用: 引用该页内联 sprite 里的图标.
 *
 * sprite 本身写在 418.html 里(一组 <symbol id="i-...">),这里只负责生成引用它的
 * <svg> 片段 -- 用于 JS 动态拼 HTML 的场景(静态标记直接写在 HTML 里即可).
 * 样式见 shared/icon.css.
 */
export function icon(id: string, style = ''): string {
    const styleAttr = style ? ` style="${style}"` : '';
    return `<svg class="icon" aria-hidden="true" focusable="false"${styleAttr}><use href="#${id}"></use></svg>`;
}
