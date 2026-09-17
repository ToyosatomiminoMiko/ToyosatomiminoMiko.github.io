import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

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

export default defineConfig({
    base: '/',
    plugins: [
        fourXXPage(),
        VitePWA({
            registerType: 'autoUpdate',
            injectRegister: 'auto',
            includeAssets: [
                'favicon.ico',
                'apple-touch-icon.png',
                'pwa-192x192.png',
                'pwa-512x512.png',
            ],
            manifest: {
                name: 'ToyosatomiminoMiko',
                short_name: 'Miko',
                description: 'ToyosatomiminoMiko 的个人主页',
                lang: 'zh-CN',
                theme_color: '#0d0d0d',
                background_color: '#0d0d0d',
                display: 'standalone',
                orientation: 'any',
                scope: '/',
                start_url: '/',
                icons: [
                    {
                        src: 'pwa-192x192.png',
                        sizes: '192x192',
                        type: 'image/png',
                    },
                    {
                        src: 'pwa-512x512.png',
                        sizes: '512x512',
                        type: 'image/png',
                    },
                    {
                        src: 'pwa-maskable-512x512.png',
                        sizes: '512x512',
                        type: 'image/png',
                        purpose: 'maskable',
                    },
                ],
            },
            workbox: {
                globPatterns: ['**/*.{js,css,html,ico,png,svg,jpg,gif,woff2}'],
                cleanupOutdatedCaches: true,
                // 默认只忽略 utm_* / fbclid, 于是 /4xx_page/451.html?perf=1 匹配不上
                // 预缓存条目, 被下面的 NavigationRoute 兜底成了 /index.html --
                // 也就是说 ?nogpu=1 / ?perf=1 这些调试开关在装过 SW 的浏览器上全部失效.
                // 本站资源名自带 hash, 忽略全部查询参数是安全的.
                ignoreURLParametersMatching: [/.*/],
                // 本 SW 的 scope 是 '/',它的 SPA 回退对站内所有导航生效,包括
                // 其它项目页. GraphCalc 已拆到 /miko_graphcalc/,必须排除,否则
                // 已经装过本 SW 的访客点进新站时,导航会被兜底成这里的主页,
                // 新站自己的 SW 也就永远没机会注册接管.
                navigateFallback: '/index.html',
                navigateFallbackDenylist: [/^\/miko_graphcalc(\/|$)/],
                maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
            },
        }),
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
});
