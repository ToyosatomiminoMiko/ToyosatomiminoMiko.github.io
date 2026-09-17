/**
 * 4xx 状态页的全局环境声明.
 */

/**
 * Vite 的 `?raw` 后缀: 把文件按文本导入.
 * 451 的 WGSL 着色器走这条路 -- 于是着色器可以是货真价实的 .wgsl 文件,
 * 不再需要"塞进 JS 模板字符串"来绕开浏览器的模块 MIME 校验.
 *
 * 只有 451/ember/shader-sources.ts 会用到它,声明放这里是因为它是 Vite 层面的
 * 全局能力,不属于任何单个页面.
 */
declare module '*?raw' {
    const source: string;
    export default source;
}
