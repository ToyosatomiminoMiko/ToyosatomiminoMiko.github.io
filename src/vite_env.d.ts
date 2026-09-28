declare module '*.css';
declare module '*.js';

/**
 * Vite 的 `?raw` 后缀: 把文件按文本导入.
 *
 * 这是 Vite 层面的全局能力,不属于任何单个页面,所以声明放在项目级的这个文件里.
 *
 * 当前使用者:
 *   - `src/4xx_page/451/ember/shader_sources.ts` -- 着色器是货真价实的 .wgsl 文件,
 *     用 `?raw` 直接导入,不必嵌进 JS 字符串.
 */
declare module '*?raw' {
    const source: string;
    export default source;
}
