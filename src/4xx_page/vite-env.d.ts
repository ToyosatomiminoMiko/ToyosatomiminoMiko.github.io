/**
 * 4xx 状态页的全局环境声明.
 *
 * `?raw` 导入的 ambient 声明原来在这里,现在挪到了项目级的 `src/vite-env.d.ts`:
 * 那是 Vite 层面的全局能力,`metro_window` 子项目也要用,不属于 4xx 页面.
 */
