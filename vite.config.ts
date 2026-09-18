import { readdirSync, readFileSync } from 'node:fs';
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
const SOURCE_PREFIX = 'src/4xx_page/';

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
                const target = fileName.slice('src/'.length);
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

/**
 * 地铁车窗的城市贴图(`metro_window/public/resource/*.png`).
 *
 * 这四张 PNG 既不进 JS 资源图,也拿不到带 hash 的地址:它们是 Rust 在运行时
 * 自己 fetch 的(路径见 `metro_window/src/app.rs` 的 `RESOURCE_BASE`).
 * 所以地址必须是构建后稳定可访问的,做法沿用上面 fourXXPage() 的双段式:
 *   - dev:   Vite 的 publicDir 只能有一个,子项目的 public/ 不会被自动挂载,
 *            这里把 /metro_window/resource/* 重写到 metro_window/public/resource/*;
 *   - build: 按同名路径 emit 进产物,让 dev 与线上的 URL 完全一致.
 *
 * 资源留在 metro_window/public/ 而不是挪进站点 public/,是为了让这个子项目
 * 自身完整:搬迁/回滚/对照上游归档时,不用再去站点 public/ 里翻.
 */
const METRO_PUBLIC_PREFIX = 'metro_window/resource/';
const METRO_SOURCE_PREFIX = 'metro_window/public/resource/';

function metroWindowAssets(): Plugin {
    const sourceDir = here(METRO_SOURCE_PREFIX);
    return {
        name: 'metro-window-assets',

        // 开发服务器:让 /metro_window/resource/*.png 直接可访问,与线上地址一致
        configureServer(server) {
            server.middlewares.use((req, _res, next) => {
                if (req.url?.startsWith(`/${METRO_PUBLIC_PREFIX}`)) {
                    req.url = `/${METRO_SOURCE_PREFIX}${req.url.slice(METRO_PUBLIC_PREFIX.length + 1)}`;
                }
                next();
            });
        },

        // 构建:整目录按原路径写进产物(不 hash -- 地址是 Rust 里写死的)
        enforce: 'post',
        generateBundle() {
            for (const name of readdirSync(sourceDir)) {
                this.emitFile({
                    type: 'asset',
                    fileName: `${METRO_PUBLIC_PREFIX}${name}`,
                    source: readFileSync(`${sourceDir}${name}`),
                });
            }
        },
    };
}

export default defineConfig({
    base: '/',
    plugins: [
        fourXXPage(),
        metroWindowAssets(),
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
                // 地铁车窗的独立入口: 产物 -> dist/metro_window/index.html, 地址 /metro_window/
                'metro_window/index': here('metro_window/index.html'),
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
