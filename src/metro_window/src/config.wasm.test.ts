/*
 启动配置的**真实 wasm 边界**测试.

 config.ts 里那份 `RUNTIME_CONFIG` 会被 wasm 按字段名读走(见 rust/src/boot_config.rs
 的 `BootConfig::from_js`):字段名写错,少一项,类型不对,层数与着色器实现不一致,
 都只能在启动那一刻才暴露 -- 而 `startApp` 接着就要 WebGPU 设备,CI 与无 GPU 环境
 根本走不到校验那一步.

 所以这里直接实例化**真的** wasm 模块(不 mock),调用只做校验的 `validateConfig`:
 它跑的是与 startApp 完全同一条解析路径,却不需要设备.于是"TS 与 Rust 对同一份
 配置的理解是否一致"变成了一条能在 CI 里跑的断言.

 注意与 metro_window.test.ts 的分工:那边 mock 掉 wasm 验**调用序列**(启动时推了
 哪些值),这边用真 wasm 验**配置本身**能不能被接受.
*/
import { readFile } from 'node:fs/promises';

import { beforeAll, describe, expect, it } from 'vitest';

import init, { validateConfig } from '@/metro_window/wasm/metro_window.js';

import { RUNTIME_CONFIG } from './config';

beforeAll(async () => {
    // web 目标的 glue 允许直接喂字节:Node 里没有 fetch 一个相对路径的语义,
    // 读文件最省事,也避免了"测试依赖 http 服务".
    const bytes = await readFile(new URL('../wasm/metro_window_bg.wasm', import.meta.url));
    await init({ module_or_path: bytes });
});

describe('启动配置的 wasm 边界', () => {
    it('config.ts 的 RUNTIME_CONFIG 能被真实 wasm 接受', () => {
        expect(() => validateConfig(RUNTIME_CONFIG)).not.toThrow();
    });

    it('缺字段时报出缺的是哪一个', () => {
        // 字段名是跨语言契约:改名只改一边时,这条断言会直接指出缺谁.
        // (`from_js` 先读数组字段,所以空对象先报 layers.)
        expect(() => validateConfig({})).toThrow(/缺少字段 layers/);
        const { layers, ...withoutLayers } = RUNTIME_CONFIG;
        expect(layers.length).toBeGreaterThan(0); // 确保下面去掉的确实是一项
        expect(() => validateConfig(withoutLayers)).toThrow(/缺少字段 layers/);
        const { resourceBase, ...withoutBase } = RUNTIME_CONFIG;
        expect(resourceBase).not.toBe('');
        expect(() => validateConfig(withoutBase)).toThrow(/缺少字段 resourceBase/);
    });

    it('层数与着色器实现不一致时拒绝启动', () => {
        // 城市层数由着色器/管线固定:前端多写或少写都不能静默通过.
        expect(() =>
            validateConfig({ ...RUNTIME_CONFIG, layers: RUNTIME_CONFIG.layers.slice(1) }),
        ).toThrow(/着色器\/管线/);
    });

    it('滑块名在 Rust 侧没有对应字段时拒绝启动', () => {
        // 名字写错在运行时只会"拖了没反应",所以要在启动前拦住.
        expect(() =>
            validateConfig({
                ...RUNTIME_CONFIG,
                params: [{ name: 'vehcle_speed', min: 0, max: 3 }],
            }),
        ).toThrow(/GlassParams 字段/);
    });

    it('上传上限为 0 / 区间颠倒时拒绝启动', () => {
        expect(() => validateConfig({ ...RUNTIME_CONFIG, uploadMaxDimension: 0 })).toThrow(
            /uploadMaxDimension/,
        );
        expect(() =>
            validateConfig({
                ...RUNTIME_CONFIG,
                params: [{ name: 'vehicle_speed', min: 3, max: 0 }],
            }),
        ).toThrow(/区间非法/);
    });
});
