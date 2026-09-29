/**
 * @vitest-environment happy-dom
 */
/*
 启动时的**参数契约**回归网(把 wasm 模块 mock 掉,只验调用序列).

 这里守着两条都"错了也不报错,只是画面不对"的约定:

 1. **滑块初值要推入**.滑块参数有两处初值来源--前端 `config.ts` 的
    `SLIDER_GROUPS[].value`(滑杆起始位置)与 Rust `glass_params.rs` 的
    `GlassParams::DEFAULT`(wasm 内部值).库的 `SliderHandle.onInput` 订阅时
    不回调,而本站的订阅挂在 `createSlider` 之后,所以装配期写进值源的那次初值
    根本没有经过 `setParam`;启动后必须**补推一次**;少了它,改 `value` 只动界面,
    不动画面.
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
    PANEL_LEGEND,
    RUNTIME_CONFIG,
    SLIDER_GROUPS,
    SLIDER_SPECS,
    TRANSPORT_BUTTONS,
    TRANSPORT_TOGGLE_LABEL,
    UPLOAD_LAYERS,
    UPLOAD_LEGEND,
    type SliderSpec,
} from './config';
import { mountMetroWindow } from './metro_window';

/** 站点建的那颗设置组(类名契约见 src/setting/setting.css) */
const SITE_GROUP_CLASS = 'setting-group';

/**
 * 装出四个宿主并挂载车窗(挂载即开始异步 boot).
 *
 * 前两颗是骨架/站点给的**空容器**(舞台与风格按钮行),后两颗是 SETTING 页给的
 * **设置组 fieldset** -- 组件往它们里面长内容,只补自己的样式作用域类.
 */
function mountAtEmptyHosts(): HTMLDivElement {
    const host = document.createElement('div');
    const stage = document.createElement('div');
    const styles = document.createElement('div');
    const panel = document.createElement('fieldset');
    panel.className = SITE_GROUP_CLASS;
    const uploads = document.createElement('fieldset');
    uploads.className = SITE_GROUP_CLASS;
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

/** 本次用例的挂载宿主(由 `beforeEach` 赋值;断言都从它往下查,见 sliderRow 的说明) */
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
        const stage = mountedHost.querySelector<HTMLElement>('.metro-window--stage');
        expect(stage).not.toBeNull();
        expect(stage?.style.getPropertyValue(CANVAS_ASPECT_PROPERTY)).toBe(
            `${CANVAS_WIDTH} / ${CANVAS_HEIGHT}`,
        );
    });
});

/*
  SETTING 页给车窗的两块宿主**就是设置组本身**(`fieldset.setting-group`,由
  src/setting/setting_page.ts 建).组件只往里面长内容(legend + 主体),并补上自己的
  样式作用域类 `.metro-window` -- 它**不碰**站点的框体类,也不再自己建框体.

  这类"少了就静默失效"的约定只能靠断言钉住:宿主上少一个 `.metro-window` 是
  "面板看着没坏但全乱"(组件自己的排布规则全都以它作用域),而组件多写 / 少写
  `.setting-group` 则是"两处各定义一半框体".
*/
describe('地铁车窗设置组', () => {
    it('内容长进调用方给的设置组 fieldset,宿主上只多一个组件作用域类', async () => {
        await waitBooted();
        const groups = [...mountedHost.querySelectorAll<HTMLFieldSetElement>(`fieldset.${SITE_GROUP_CLASS}`)];
        expect(groups).toHaveLength(2);
        for (const group of groups) {
            // 站点类原样保留(框体归它),组件只叠自己的作用域类
            expect([...group.classList], group.id).toEqual([SITE_GROUP_CLASS, 'metro-window']);
        }
        // legend 由组件放在最前(组标题属于内容,不属于框体)
        expect(groups[0]?.querySelector(':scope > legend')?.textContent).toBe(PANEL_LEGEND);
        expect(groups[1]?.querySelector(':scope > legend')?.textContent).toBe(UPLOAD_LEGEND);
        // 参数组里是滑块,上传组里是上传行 -- 两块内容不串门
        expect(groups[0]?.querySelector('.slider-field')).not.toBeNull();
        expect(groups[0]?.querySelector('.upload')).toBeNull();
        expect(groups[1]?.querySelector('.upload')).not.toBeNull();
    });

    it('框体不在组件这一侧:宿主的类名与 id 全由设置页给,组件一个都不加', async () => {
        await waitBooted();
        const group = mountedHost.querySelector<HTMLFieldSetElement>(`fieldset.${SITE_GROUP_CLASS}`);
        // 组件不写 id(那是设置页的声明),也不铺内边距 / 底色(那是 .setting-group 的活)
        expect(group?.id).toBe('');
        expect(group?.getAttribute('style')).toBeNull();
    });
});

/*
  调用方**只给舞台**(或只给舞台与风格按钮)时的兜底:面板 / 状态区 / 上传行一个都
  不能少,只是不显示.这条也在 README 的"组件形态"里承诺过,坏了不会报错 --
  表现是"挂上去了但状态区永远停在初始化中"(状态 span 根本不在 DOM 里).
*/
describe('地铁车窗:省略 SETTING 宿主时的兜底', () => {
    it('参数组与上传组都落进舞台里的隐藏容器,内容一个不少', () => {
        const host = document.createElement('div');
        const stage = document.createElement('div');
        host.append(stage);
        document.body.append(host);
        mountMetroWindow({ stage });

        const sink = stage.querySelector<HTMLElement>('.metro-panel-sink');
        expect(sink).not.toBeNull();
        // 两颗自建的设置组都在隐藏容器里(上传组落在参数组内部,所以是"容器里两颗")
        expect(sink!.querySelectorAll('fieldset.metro-window')).toHaveLength(2);
        expect(sink!.querySelectorAll('.slider-field')).toHaveLength(SLIDER_SPECS.length);
        expect(sink!.querySelectorAll('.upload')).toHaveLength(UPLOAD_LAYERS.length);
        // 状态区仍在(面板不显示,但启动状态照旧写进它)
        expect(sink!.querySelector('.gpu_info span')).not.toBeNull();
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

/*
 播放与暂停合成了一颗开关(见 config.ts 的 TRANSPORT_BUTTONS / TRANSPORT_TOGGLE_LABEL):
 点一下在 "想跑 / 不想跑" 之间切,文案跟着换.这条链路错了不会报错,只会"按钮点了
 画面照跑"(或反过来),所以在 mock wasm 上把两个方向各钉一次.
*/
describe('地铁车窗播放-暂停开关', () => {
    it('点一下切到暂停(文案变"播放"),再点一下切回播放("暂停")', async () => {
        await waitBooted();
        vi.clearAllMocks();

        const toggle = mountedHost.querySelector<HTMLButtonElement>('#playPauseBtn');
        expect(toggle).not.toBeNull();
        // 初始状态:App 默认就在跑,所以按钮上的字是"暂停"(点它会发生的事)
        expect(toggle!.textContent).toBe(TRANSPORT_TOGGLE_LABEL.running);

        toggle!.click();
        expect(wasm.setRunning).toHaveBeenCalledTimes(1);
        expect(wasm.setRunning).toHaveBeenCalledWith(false);
        expect(toggle!.textContent).toBe(TRANSPORT_TOGGLE_LABEL.paused);

        vi.clearAllMocks();
        toggle!.click();
        expect(wasm.setRunning).toHaveBeenCalledTimes(1);
        expect(wasm.setRunning).toHaveBeenCalledWith(true);
        expect(toggle!.textContent).toBe(TRANSPORT_TOGGLE_LABEL.running);
    });

    it('播放控制只有开关与重置两颗按钮(旧的三颗已合并)', async () => {
        await waitBooted();
        const ids = [...mountedHost.querySelectorAll('.controls button')].map((btn) => btn.id);
        expect(ids).toEqual([TRANSPORT_BUTTONS[0].id, TRANSPORT_BUTTONS[1].id]);
        expect(document.querySelector('#startBtn')).toBeNull();
        expect(document.querySelector('#pauseBtn')).toBeNull();
        // 控制条不再用 flex 布局,那个把按钮推到右边的 .spacer 也随之撤掉
        // (见 metro_window.css 的 .controls 一条):留着就是"看不见的空元素".
        expect(mountedHost.querySelector('.controls .spacer')).toBeNull();
    });
});

/*
 控制台的结构:实时参数的分组**不再可折叠**(见 ui/settings.ts 的 createSliderGroup).
 这条决策错了不会报错,只会"面板里又冒出两个可点的分组条";标记对不对得上也只有
 在这里能钉,所以按 DOM 断言一次:没有 <details> / <summary>,每个分组一个静态标题.
*/
describe('地铁车窗实时参数的分组', () => {
    it('分组不可折叠,标题是静态文案(与声明一一对应)', async () => {
        await waitBooted();
        const panel = mountedHost.querySelector<HTMLFieldSetElement>(`fieldset.${SITE_GROUP_CLASS}`);
        expect(panel).not.toBeNull();
        expect(panel!.querySelector('details')).toBeNull();
        expect(panel!.querySelector('summary')).toBeNull();

        const titles = [...panel!.querySelectorAll('.slider-group-title')].map(
            (element) => element.textContent,
        );
        expect(titles).toEqual(SLIDER_GROUPS.map((group) => group.title));
    });
});
