declare module '*.css';
declare module '*.js';

/**
 * Vite 的 `?raw` 后缀: 把文件按文本导入.
 *
 * 这是 Vite 层面的全局能力,不属于任何单个页面,所以声明放在项目级的这个文件里
 * (原先挂在 `src/4xx_page/vite_env.d.ts` 下,而 4xx 本来就是计划清理的对象).
 *
 * 当前使用者:
 *   - `src/4xx_page/451/ember/shader_sources.ts` -- 着色器是货真价实的 .wgsl 文件,
 *     不再需要"塞进 JS 模板字符串"来绕开浏览器的模块 MIME 校验.
 */
declare module '*?raw' {
    const source: string;
    export default source;
}
