import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
    base: '/',
    plugins: [
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
});
