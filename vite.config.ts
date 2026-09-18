import { fileURLToPath } from 'node:url';
// defineConfig 从 vitest/config 拿:它只是给 Vite 的 UserConfig 多加了 test 段,
// 这样 vitest 的排除规则可以和构建配置写在同一个文件里,不必再养一份 vitest.config.ts
import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';

const here = (relativePath: string): string => fileURLToPath(new URL(relativePath, import.meta.url));

/**
 * 418 / 451 / 404 的源码放在 src/4xx_page 下(与主页代码分开), 但它们的公开地址
 * 仍然是站点根目录的 /4xx_page/*.html.
 *
 * Vite 对 HTML 入口的输出路径 = 该文件相对 root 的路径, 所以 src/4xx_page/451.html
 * 会被写到 dist/src/4xx_page/451.html.这里在最后把它挪回 dist/4xx_page/451.html.
 * 这么做是安全的: base 是 '/', HTML 里引用的资源本来就是绝对路径(/assets/...),
 * 换一层目录不会让任何链接失效.
 *
 * 三个 HTML 因此**必须留在 src/4xx_page/ 这一层**(不能收进 418/ 451/ 子目录):
 * dev 下的地址是 /4xx_page/451.html, 页面里 `./451/451.css` 这类相对引用要能
 * 原样落到 /src/4xx_page/451/451.css, 中间那层映射见下面的 configureServer.
 */
const PUBLIC_PREFIX = '4xx_page/';
/** 仓库源码根目录名. Vite 的 HTML 入口输出路径 = 相对 root 的路径, 因此以它开头. */
const SOURCE_ROOT = 'src/';
/** 三个彩蛋页的源码前缀 = 源码根 + 公开前缀, 由上面两个常量拼出, 只此一处定义. */
const SOURCE_PREFIX = `${SOURCE_ROOT}${PUBLIC_PREFIX}`;

function fourXXPage(): Plugin {
    return {
        name: 'four-xx-page',

        // 开发服务器: 让 /4xx_page/*.html 也能直接访问, 与线上地址保持一致
        configureServer(server) {
            server.middlewares.use((req, _res, next) => {
                if (req.url?.startsWith(`/${PUBLIC_PREFIX}`)) {
                    req.url = `/${SOURCE_PREFIX}${req.url.slice(PUBLIC_PREFIX.length + 1)}`;
                }
                next();
            });
        },

        // 构建: 把 src/4xx_page/**.html 挪到 4xx_page/**.html
        enforce: 'post',
        generateBundle(_options, bundle) {
            for (const fileName of Object.keys(bundle)) {
                if (!fileName.startsWith(SOURCE_PREFIX)) continue;
                const output = bundle[fileName];
                if (!output) continue;
                const target = fileName.slice(SOURCE_ROOT.length);
                if (bundle[target]) continue;
                // 必须重新 emit: 直接往 bundle 上挂新 key 不会被 rolldown 写出去
                this.emitFile({
                    type: 'asset',
                    fileName: target,
                    source: output.type === 'asset' ? output.source : '',
                });
                delete bundle[fileName];
            }
        },
    };
}

/*
 * 站点只有**一个**静态资源根:`public/`(Vite 的 publicDir).
 *
 * 所有按原 URL 直接访问,不参与打包的文件都放这里,dev 直接挂载,build 原样拷贝:
 *   - 主站图片 `public/images/`,图标 `public/favicon.ico`,样式表 `public/css/`;
 *   - 地铁车窗的运行时贴图 `public/metro_window/resource/*.png` -- Rust 按
 *     `/metro_window/resource/...` 自己 fetch(见 `metro_window/src/app_params.rs`
 *     的 RESOURCE_BASE),所以目录层级必须与 URL 一致,这里不做任何重写.
 *
 * 不变量:public 里的路径 == 线上 URL.Vite 只有一个 publicDir,所以不要再给
 * 子项目另建 public/(那需要额外插件在 dev 重写,在 build 里手动 emit),
 * 直接把文件放进这棵树下即可.
 */
export default defineConfig({
    base: '/',
    plugins: [
        fourXXPage(),
    ],
    build: {
        rollupOptions: {
            input: {
                // 主页(单页应用)
                main: here('index.html'),
                // 状态码彩蛋页: 源码在 src/4xx_page, 产物由 fourXXPage() 挪到 /4xx_page/
                '4xx_page/404': here('src/4xx_page/404.html'),
                '4xx_page/418': here('src/4xx_page/418.html'),
                '4xx_page/451': here('src/4xx_page/451.html'),
            },
        },
    },
    // 测试只需要 src/ 下的纯 TS 单测.排除 metro_window/ 是必须的而不是洁癖:
    // 那边有 cargo 的 target/(构建后体积以 GB 计,文件数十万),
    // 让 vitest 去 glob 一遍会白白卡住整条流水线.
    test: {
        include: ['src/**/*.test.ts'],
        exclude: ['node_modules/**', 'dist/**', 'metro_window/**'],
    },
});
