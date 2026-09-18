declare module '*.css';
declare module '*.js';

/**
 * Vite 的 `?raw` 后缀: 把文件按文本导入.
 *
 * 这是 Vite 层面的全局能力,不属于任何单个页面,所以声明放在项目级的这个文件里.
 * (原先在 `src/4xx_page/vite-env.d.ts`;后来 `metro_window/web/src/metro-window.ts`
 * 也靠它导入组件标记,再挂在 4xx 目录下就名不副实了 -- 而 4xx 是计划清理的对象.)
 *
 * 当前使用者:
 *   - `src/4xx_page/451/ember/shader-sources.ts` -- 着色器是货真价实的 .wgsl 文件,
 *     不再需要"塞进 JS 模板字符串"来绕开浏览器的模块 MIME 校验;
 *   - `metro_window/web/src/metro-window.ts`     -- 组件标记是 .html 文件.
 */
declare module '*?raw' {
    const source: string;
    export default source;
}
