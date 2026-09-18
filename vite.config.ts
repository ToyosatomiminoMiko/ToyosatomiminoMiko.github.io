import { fileURLToPath } from 'node:url';
// defineConfig 从 vitest/config 拿:它只是给 Vite 的 UserConfig 多加了 test 段,
// 这样 vitest 的排除规则可以和构建配置写在同一个文件里,不必再养一份 vitest.config.ts
import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';

const here = (relativePath: string): string => fileURLToPath(new URL(relativePath, import.meta.url));

/**
 * 源码根别名 `@/` == `src/`.跨目录的模块导入统一用它
 * (`@/clock/config`,`@/common/utils`,`@/4xx_page/shared/icon`),同目录的兄弟模块
 * 才继续用 `./x`;HTML 里的 <link>/<script> 不用别名,写相对站点根的 `/src/...`.
 * tsconfig.json 的 `paths` 必须与这里保持一致(TS 与打包器各认一份).
 */
const SRC_ALIAS = here('./src').replace(/\/$/, '');

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
 * dev 下的公开地址是 /4xx_page/451.html, 而页面里的 <link>/<script> 一律写成
 * 相对站点根的 /src/4xx_page/451/451.css, 也就是磁盘上的真实路径; 下面
 * configureServer 只负责把公开地址 /4xx_page/*.html 重写到源码文件上.
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
 *     `/metro_window/resource/...` 自己 fetch(见 `src/metro_window/rust/src/app_params.rs`
 *     的 RESOURCE_BASE),所以目录层级必须与 URL 一致,这里不做任何重写.
 *
 * 不变量:public 里的路径 == 线上 URL.Vite 只有一个 publicDir,所以不要再给
 * 子项目另建 public/(那需要额外插件在 dev 重写,在 build 里手动 emit),
 * 直接把文件放进这棵树下即可.
 */
export default defineConfig({
    base: '/',
    resolve: {
        alias: [{ find: /^@\//, replacement: `${SRC_ALIAS}/` }],
    },
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
    // 开发服务器:不要把 cargo 的构建目录交给文件监听器.
    // 地铁车窗的 Rust crate 放在 src/metro_window/rust/ 下,它的 target/ 是
    // 十几万个文件 / GB 级的构建缓存;让 chokidar 去遍历,轻则拖慢启动,
    // 重则吃满 inotify watch.它和站点源码无关,直接忽略.
    server: {
        watch: {
            ignored: ['**/src/metro_window/rust/target/**'],
        },
    },
    // 测试只需要纯 TS 单测(src/ 下,含地铁车窗前端的 config.test.ts).
    // 排除 src/metro_window/rust/ 是必须的而不是洁癖:那边有 cargo 的 target/
    // (构建后体积以 GB 计,文件数十万),让 vitest 去 glob 一遍会白白卡住整条流水线.
    // 只排 rust/ 不排 web/:前端单测就在 src/metro_window/web/src 下,要照常收集.
    test: {
        include: ['src/**/*.test.ts'],
        exclude: ['node_modules/**', 'dist/**', 'src/metro_window/rust/**'],
    },
});
