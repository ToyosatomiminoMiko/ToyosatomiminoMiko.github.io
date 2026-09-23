/**
 * @vitest-environment happy-dom
 */
/*
 启动时的**参数契约**回归网(把 wasm 模块 mock 掉,只验调用序列).

 这里守着两条都"错了也不报错,只是画面不对"的约定:

 1. **滑块初值要推入**.滑块参数有两处初值来源--前端 `config.ts` 的
    `SLIDER_GROUPS[].value`(滑杆起始位置)与 Rust `glass_params.rs` 的
    `GlassParams::DEFAULT`(wasm 内部值).`bindSlider` 末尾那次同步跑在
    `booted` 之前,里面的 `setParam` 会被 `if (booted)` 跳过,所以启动后必须
    **补推一次**;少了它,改 `value` 只动界面,不动画面.
 2. **启动配置要整体传进去**.`startApp(canvas, status, config)` 的第三个参数
    就是 `config.ts` 里的 `RUNTIME_CONFIG`:风格,图层清单,资源路径,上传上限,
    滑块区间全在里面,Rust 侧不再各存一份.漏传/字段名漂移会让 wasm 启动即报错
    (boot_config.rs 的校验),表现是首屏一直停在"初始化中"或直接报配置错误.

 为什么 mock wasm 而不是跑真的:真 wasm 要 WebGPU 与 GPU 设备,CI 里没有;这里
 要验的是**调用序列**,不是渲染结果.渲染结果由 `scripts/smoke_home.mjs` 在真浏览器
 里兜(那边无 GPU 会走 unavailable 回退,同样验不了这两条).
*/
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/metro_window/wasm/metro_window.js', () => ({
    default: vi.fn(async () => {}),
    setParam: vi.fn(),
    setStyle: vi.fn(),
    setRunning: vi.fn(),
    reset: vi.fn(),
    resize: vi.fn(),
    setLayerImage: vi.fn(),
    resetLayerImage: vi.fn(),
    startApp: vi.fn(async () => {}),
}));

import * as wasm from '@/metro_window/wasm/metro_window.js';

import {
    CANVAS_ASPECT_PROPERTY,
    CANVAS_HEIGHT,
    CANVAS_WIDTH,
    RUNTIME_CONFIG,
    SLIDER_GROUPS,
    type SliderGroupSpec,
    type SliderSpec,
} from './config';
import { mountMetroWindow } from './metro_window';

/**
 * `SLIDER_GROUPS` 摊平后的全部滑块声明(与组件实际建的滑块一一对应).
 * 与 config.test.ts 同款写法:分组是各自的元组类型,这里按统一的 SliderSpec 收口.
 */
const SLIDER_SPECS: readonly SliderSpec[] = SLIDER_GROUPS.flatMap(
    (group: SliderGroupSpec) => group.sliders,
);

/** 装出四个空宿主并挂载车窗(挂载即开始异步 boot) */
function mountAtEmptyHosts(): HTMLDivElement {
    const host = document.createElement('div');
    const stage = document.createElement('div');
    const styles = document.createElement('div');
    const panel = document.createElement('div');
    const uploads = document.createElement('div');
    host.append(stage, styles, panel, uploads);
    document.body.append(host);
    mountMetroWindow({ stage, styles, panel, uploads });
    return host;
}

/**
 * 本次挂载长进面板宿主里的第 `index` 条滑块行(库生成的 `.slider-field`).
 *
 * 从 `beforeEach` 交回的宿主往下查,而不是 `document.querySelector`:每次用例都往
 * `document.body` 追加一个新宿主,按文档查会命中上一个用例留下的那份旧标记.
 */
function sliderRow(host: HTMLElement, index: number): HTMLElement {
    const row = host.querySelectorAll<HTMLElement>('.metro-window .slider-field')[index];
    if (!row) throw new Error(`没有第 ${index} 条滑块行`);
    return row;
}

/** 等启动补推完成:此时 `booted = true`,滑块的改动才会真的落到 wasm. */
async function waitBooted(): Promise<void> {
    await vi.waitFor(() => {
        expect(wasm.setParam).toHaveBeenCalledTimes(SLIDER_SPECS.length);
    });
}

/**
 * 本次用例的挂载宿主(由 `beforeEach` 赋值).
 *
 * 滑块相关的断言都从它往下查,而不是 `document.querySelector`:每次挂载都往
 * `document.body` 追加一个新宿主,按文档查会命中上一个用例留下的那份旧标记.
 */
let mountedHost: HTMLDivElement;

beforeEach(() => {
    // mock 是模块级的,用例之间要清掉调用记录,否则后面的 "调用一次" 会数到前面那次.
    vi.clearAllMocks();
    // 组件只认 navigator.gpu 与 adapter.info(vendor 不能命中软件渲染黑名单).
    Object.defineProperty(globalThis.navigator, 'gpu', {
        configurable: true,
        value: {
            requestAdapter: async () => ({ info: { vendor: 'AMD', architecture: 'rdna3' } }),
        },
    });
    mountedHost = mountAtEmptyHosts();
});

describe('地铁车窗启动参数', () => {
    it('boot 后把每个滑块的声明初值推给 wasm', async () => {
        // boot 是异步的(init wasm -> requestAdapter -> startApp),等补推做完.
        await waitBooted();
        for (const spec of SLIDER_SPECS) {
            expect(wasm.setParam).toHaveBeenCalledWith(spec.param, spec.value);
        }
    });

    it('把 RUNTIME_CONFIG 作为 startApp 的第三个参数传给 wasm', async () => {
        await vi.waitFor(() => {
            expect(wasm.startApp).toHaveBeenCalledTimes(1);
        });
        // 传的就是 config.ts 里那份声明本身(不是复制出来的一份):任何可配置值
        // 都只在那一个地方写,wasm 侧读它并校验.
        expect(wasm.startApp).toHaveBeenCalledWith(
            expect.anything(),
            expect.anything(),
            RUNTIME_CONFIG,
        );
    });

    it('启动配置里带着图层清单与滑块区间', () => {
        // wasm 侧不再存这些清单:漏传就等于"上传面板不认任何槽位""滑块没有区间",
        // 这里顺带把"配置确实非空"钉一下.
        expect(RUNTIME_CONFIG.layers.length).toBeGreaterThan(0);
        expect(RUNTIME_CONFIG.params.length).toBeGreaterThan(0);
    });

    it('把画布宽高比写给 CSS(与后备缓冲同一个来源)', async () => {
        // 比例只有 CANVAS_WIDTH / CANVAS_HEIGHT 一份:挂载时写到舞台上,
        // 免得 CSS 里再手写一份 16 / 9 与它并行.
        const stage = document.querySelector<HTMLElement>('.metro-window');
        expect(stage).not.toBeNull();
        expect(stage?.style.getPropertyValue(CANVAS_ASPECT_PROPERTY)).toBe(
            `${CANVAS_WIDTH} / ${CANVAS_HEIGHT}`,
        );
    });
});

/*
 滑块的三条入口(拖动滑杆 / 输入数值框 / 点重置按钮)都要落到 `setParam`.

 滑块本身由 UI 库的 `createSlider` 生成,本站只剩 `slider.onInput(...)` 这一条
 "参数变了就通知渲染内核"的业务语义.这条绑定错了不会报错,只会"界面动了画面不动",
 所以在这里把三条入口各钉一次.
*/
describe('地铁车窗滑块的写回', () => {
    /** 取本次挂载的第 `index` 条滑块声明(与界面顺序一致). */
    const specAt = (index: number): SliderSpec => {
        const spec = SLIDER_SPECS[index];
        if (!spec) throw new Error(`没有第 ${index} 条滑块声明`);
        return spec;
    };

    it('拖动滑杆把新值写进对应的 wasm 参数', async () => {
        await waitBooted();
        vi.clearAllMocks();

        // 取中间那条:值肯定与声明值不同,免得被"同值不通知"短路掉.
        const spec = specAt(2);
        const range = sliderRow(mountedHost, 2).querySelector<HTMLInputElement>('input[type=range]');
        expect(range).not.toBeNull();
        range!.value = String(spec.max);
        range!.dispatchEvent(new Event('input', { bubbles: true }));

        expect(wasm.setParam).toHaveBeenCalledTimes(1);
        expect(wasm.setParam).toHaveBeenCalledWith(spec.param, spec.max);
    });

    it('数值框输入把夹取后的值写进对应的 wasm 参数', async () => {
        await waitBooted();
        vi.clearAllMocks();

        const spec = specAt(2);
        const number = sliderRow(mountedHost, 2).querySelector<HTMLInputElement>('input[type=number]');
        expect(number).not.toBeNull();

        // 越界输入由本站传给滑块的 normalize 夹回上限后才进值源:
        // 因此 wasm 拿到的已经是区间内的值,滑杆也不会被更大的数顶到区间外.
        number!.value = String(spec.max + 100);
        number!.dispatchEvent(new Event('input', { bubbles: true }));
        expect(wasm.setParam).toHaveBeenCalledTimes(1);
        expect(wasm.setParam).toHaveBeenCalledWith(spec.param, spec.max);

        // `change`(失焦 / 回车)阶段:库把最终文本回填到输入框(值没变就不再通知).
        vi.clearAllMocks();
        number!.dispatchEvent(new Event('change', { bubbles: true }));
        expect(number!.value).toBe(String(spec.max));
        expect(wasm.setParam).not.toHaveBeenCalled();
    });

    it('重置按钮把参数改回声明值', async () => {
        await waitBooted();

        // 先把值拖离声明值,再点重置:重置是"回到声明值",不是"清空".
        const spec = specAt(2);
        const range = sliderRow(mountedHost, 2).querySelector<HTMLInputElement>('input[type=range]');
        expect(range).not.toBeNull();
        range!.value = String(spec.max);
        range!.dispatchEvent(new Event('input', { bubbles: true }));
        vi.clearAllMocks();

        const reset = sliderRow(mountedHost, 2).querySelector<HTMLButtonElement>('.slider-field-reset');
        expect(reset).not.toBeNull();
        reset!.click();

        expect(wasm.setParam).toHaveBeenCalledTimes(1);
        expect(wasm.setParam).toHaveBeenCalledWith(spec.param, spec.value);
    });
});
