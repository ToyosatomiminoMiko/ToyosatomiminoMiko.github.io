import { defineConfig } from 'vite';
import { resolve } from 'path';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
    base: '/',
    build: {
        rollupOptions: {
            input: {
                main: resolve(import.meta.dirname, 'index.html'),
                'math-lab': resolve(import.meta.dirname, 'math-lab/index.html'),
            },
        },
    },
    resolve: {
        alias: {
            '@': resolve(import.meta.dirname, 'src'),
        },
    },
    optimizeDeps: {
        include: ['three'],
    },
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
                description: 'ToyosatomiminoMiko 的个人主页与 Math-Lab',
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
                // 根站点使用 SPA 回退;math-lab 是独立页面,避免被回退到根 index.html.
                navigateFallback: '/index.html',
                navigateFallbackDenylist: [/^\/math-lab(\/|$)/],
                maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
            },
        }),
    ],
});
