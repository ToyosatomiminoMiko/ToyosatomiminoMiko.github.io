import { defineConfig } from 'vite';
import { resolve } from 'path';

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
            'vue': 'vue/dist/vue.esm-bundler.js', // 给 Vite/Rollup 用的编译版
        },
    },
    optimizeDeps: {
        include: ['three', 'mathjs'],
    },
});