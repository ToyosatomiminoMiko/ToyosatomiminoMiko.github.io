/*
地铁车窗组件(可挂载)

拆成两块,各挂各的宿主:

- **舞台**(挂载点的 `stage`):宿主只提供一个**空容器**,画布由 ui/stage_content.ts 生成;
- **控制台**(挂载点的 `panel`):整套设置面板(风格按钮 / 播放控制 / 全部滑块 /
  状态区)由 ui/settings.ts 按 config.ts 的声明式模型生成,插进面板宿主;
  省略面板宿主时退回一个隐藏容器,面板与状态区仍然存在,只是不显示.

两个宿主都会由挂载函数补上样式作用域类 `.metro-window`:**样式全靠它作用域**,
面板换了宿主却没这个类就是"样式静默失效".本模块负责:引入样式,长出标记,
组装面板,绑定交互,加载 wasm,启动 WebGPU 渲染.

所有字面量(id / 类名 / data-* 键名 / Rust 参数名 / 文案 / 阈值)都集中在
@/metro_window/src/config.ts,标记与面板的结构集中在 @/metro_window/src/ui/,本文件只保留逻辑与生命周期.

调用方式(两种等价写法,取一即可;导入统一用源码根别名 `@/`):

    // 1) 宿主自己已经拿到了容器(只挂舞台也行:面板退回隐藏容器)
    import { mountMetroWindow } from '@/metro_window/src/metro_window';
    const stage = document.getElementById('metro-window');
    const panel = document.getElementById('metro-params');
    if (stage) mountMetroWindow({ stage, panel });

    // 2) 按约定的两个挂载点 id 找容器(站点入口用这种,省得宿主自己写查找与报错)
    import { mountMetroWindowAtMountIds } from '@/metro_window/src/metro_window';
    mountMetroWindowAtMountIds();

宿主必须是**空容器**:标记全部由组件生成,已有的子节点不会被清掉,重复挂载
只会把标记插两遍(wasm 侧的 App 是单例,本来也不允许挂载两次).

单实例约束:wasm 侧的 App 是 crate 内的 thread_local 单例,setStyle/setParam/
setRunning/reset 全都作用于它,所以一个页面只应挂载一次(舞台上也只应有一张画布).
*/
import './metro_window.css';

import init, { reset, resize as resizeApp, setParam, setRunning, setStyle, startApp } from '@/metro_window/pkg/metro_window.js';

import {
    ADAPTER_LABEL_SEPARATOR,
    BARE_MODIFIER_CLASS,
    buildSoftwareAdapterMessage,
    DECIMAL_FRACTION_INDEX,
    DECIMAL_SEPARATOR,
    DEFAULT_STYLE_INDEX,
    ELEMENT_IDS,
    ERROR_LABEL,
    EVENTS,
    GPU_ADAPTER_OPTIONS,
    ID_SELECTOR_PREFIX,
    LAST_ENTRY_OFFSET,
    LOG_ADAPTER_PREFIX,
    MISSING_ELEMENT_MESSAGE_PREFIX,
    MISSING_MOUNT_MESSAGE_PREFIX,
    MOUNT_IDS,
    PANEL_SINK_CLASS,
    RESIZE_DEBOUNCE_MS,
    SOFTWARE_ADAPTER_PATTERN,
    STAGE_MODIFIER_CLASS,
    STAGE_NOTE_CLASS,
    STAGE_NOTE_UNAVAILABLE,
    STAGE_STATE_DATA_KEY,
    STAGE_STATE_UNAVAILABLE,
    STATUS_HTML_SEPARATOR,
    STATUS_LOADING_WASM,
    STATUS_NO_ADAPTER,
    STATUS_NO_WEBGPU_API,
    STYLE_BUTTON_ACTIVE_CLASS,
    STYLE_DATA_KEY,
    UNKNOWN_ADAPTER_LABEL,
    WARN_ADAPTER_INFO_UNAVAILABLE,
    WEBGPU_ADAPTER_ERROR_KEYWORD,
    WEBGPU_HELP_STEPS,
    WINDOW_CLASS,
} from './config';
import { h } from '@/metro_window/src/ui/dom';
import { createSettingsPanel, createStyleRow, type SliderControl } from '@/metro_window/src/ui/settings';
import { createStageContent } from '@/metro_window/src/ui/stage_content';
import { computeBackingSize } from '@/metro_window/src/stage_size';

// WebGPU 适配器的最小类型定义(不依赖具体 TypeScript 版本的 DOM 类型)
interface GpuAdapterInfo {
    readonly vendor: string;
    readonly architecture: string;
    readonly device: string;
    readonly description: string;
}

interface GpuAdapter {
    readonly info: GpuAdapterInfo;
}

interface GpuNavigator {
    requestAdapter(options?: {
        powerPreference?: 'low-power' | 'high-performance';
        forceFallbackAdapter?: boolean;
    }): Promise<GpuAdapter | null>;
}

let booted = false;

// --- 渲染生命周期 ---
// 「用户想不想跑」(▶/⏸)与「现在能不能看见」分开记,实际渲染 = wantRunning && 可见.
// 这样做是因为:车窗是常驻的 rAF + 计算着色器负载,一旦它嵌进标签页,切走以后
// 标签页只是 display:none,浏览器不会自动停 rAF,GPU 会一直空转.
// 分开记的另一个好处是切回来能恢复用户原来的选择,而不是把"暂停"覆盖掉.
let wantRunning = true;
let documentVisible = !document.hidden;
let rootOnScreen = true;

function bootedRunning(): void {
    if (!booted) return; // startApp 之前调 setRunning 是空操作,别浪费
    setRunning(wantRunning && documentVisible && rootOnScreen);
}

function mustFind<T extends HTMLElement>(root: ParentNode, id: string): T {
    const element = root.querySelector<T>(`${ID_SELECTOR_PREFIX}${id}`);
    if (!element) {
        throw new Error(`${MISSING_ELEMENT_MESSAGE_PREFIX}${id}`);
    }
    return element;
}

/** step(如 0.01)的小数位数,用于数值框夹取后的显示精度 */
function decimalPlaces(step: number): number {
    const fraction = String(step).split(DECIMAL_SEPARATOR)[DECIMAL_FRACTION_INDEX];
    return fraction === undefined ? 0 : fraction.length;
}

/**
 * 盯着设备像素比:把窗口拖到另一块缩放比例不同的显示器上时,宿主尺寸没变,
 * 但 dpr 变了,`ResizeObserver` 不会触发,后备缓冲就会停在旧密度上(画面发糊).
 *
 * 做法是匹配"当前 dpr"的媒体查询,命中一次就重新武装一次 --
 * 没有轮询,也没有给 window 挂 resize 监听(那个同样漏掉 dpr 变化).
 */
function watchDevicePixelRatio(onChange: () => void): void {
    const arm = (): void => {
        window
            .matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
            .addEventListener(
                EVENTS.change,
                () => {
                    onChange();
                    arm();
                },
                { once: true },
            );
    };
    arm();
}

/** 三个挂载点的元素引用:舞台必需;风格按钮与控制台省略时各自退回默认位置 */
export interface MetroMountPoints {
    /** 舞台宿主:承接画布(必填) */
    readonly stage: HTMLElement;
    /** 风格按钮宿主(首屏底部);不给则风格按钮留在控制台里 */
    readonly styles?: HTMLElement;
    /** 控制台宿主:承接整套设置面板;不给则退回隐藏容器 */
    readonly panel?: HTMLElement;
}

/**
 * 按约定的三个挂载点 id 找空宿主,再挂载车窗.
 * 站点入口 src/main.ts 用这一条,省得宿主自己写一遍"找元素 + 报错".
 * 三个 id 定义在 config.ts 的 MOUNT_IDS:舞台与风格按钮在首屏,控制台在 SETTING.
 */
export function mountMetroWindowAtMountIds(): void {
    mountMetroWindow({
        stage: mustFindMount(MOUNT_IDS.stage),
        styles: mustFindMount(MOUNT_IDS.styles),
        panel: mustFindMount(MOUNT_IDS.panel),
    });
}

/**
 * 按 id 找一个宿主,找不到直接抛错.
 * 这里和"省略 panel"是两回事:省略是宿主有意不显示面板(退回隐藏容器),
 * 配了 id 却在页面里找不到是**布局写错了**,静默不挂比报错难查得多.
 */
function mustFindMount(id: string): HTMLElement {
    const element = document.getElementById(id);
    if (!element) {
        throw new Error(`${MISSING_MOUNT_MESSAGE_PREFIX}${id}`);
    }
    return element;
}

/** 省略面板宿主时自建的隐藏容器(见 config.ts 的 PANEL_SINK_CLASS) */
function createPanelSink(stage: HTMLElement): HTMLElement {
    const sink = h('div', { class: PANEL_SINK_CLASS });
    stage.append(sink);
    return sink;
}

export function mountMetroWindow(points: MetroMountPoints): void {
    const stage = points.stage;

    // 类名只在这里补:样式全靠它作用域,宿主漏写就是"样式静默失效",
    // 补一下比让宿主去记这个约定划算(站点的 HTML 里就不写类名了).
    // 舞台额外带两个修饰类:--bare 去掉车窗面板的内边距与底色,
    // --stage 再把它变成铺满父层的一层(画布用 object-fit: cover 覆盖).
    stage.classList.add(WINDOW_CLASS, BARE_MODIFIER_CLASS, STAGE_MODIFIER_CLASS);

    // 画布(以及可选的标题 / 副标题)由组件生成(宿主只提供空容器);顺序即显示顺序.
    stage.append(...createStageContent());

    // 画布仍然按 id 找回来:同一个 id 由 config.ts 的 ELEMENT_IDS 定义,
    // stage_content.ts 生成时用它,这里取值时也用它,两边不会各写一份.
    const canvas = mustFind<HTMLCanvasElement>(stage, ELEMENT_IDS.canvas);

    // 风格按钮行:站点给了宿主就挂到首屏底部(与 LED 时钟同排),否则留在控制台里.
    // 行本身只建一次,挂到哪由这里决定,所以不会出现两份.
    const styles = createStyleRow();
    const styleButtons = styles.buttons;
    if (points.styles) {
        // 与舞台同理:这个宿主也不要面板的内边距与底色,只留一排按钮.
        points.styles.classList.add(WINDOW_CLASS, BARE_MODIFIER_CLASS);
        points.styles.append(styles.root);
    }

    // 设置面板整体由声明式组件生成,挂到**另一个**宿主(站点放在 SETTING 标签页);
    // 调用方没给面板宿主时退回一个隐藏容器,面板 / 状态区 / 事件绑定一个不少.
    const settings = createSettingsPanel(points.styles ? null : styles);
    const panel = points.panel ?? createPanelSink(stage);
    // 面板宿主也要补样式作用域类:metro_window.css 的每条选择器都以 `.metro-window`
    // 开头,面板换了宿主却没有这个类,样式会静默失效(看着"没坏"但全乱).
    panel.classList.add(WINDOW_CLASS);
    panel.append(settings.root);

    const setStatus = (message: string): void => {
        settings.status.textContent = message;
        console.log(message);
    };

    // --- 后备缓冲尺寸:随首屏(宿主)尺寸变化 ---
    // 尺寸按"覆盖宿主所需的 16:9"算(见 stage_size.ts):画布比例恒为 16:9,
    // 场景不会被拉伸,水珠也恒为正圆;多出来的部分由 CSS 的 object-fit: cover 裁掉.
    const applyBackingSize = (): void => {
        const size = computeBackingSize(
            stage.clientWidth,
            stage.clientHeight,
            window.devicePixelRatio,
        );
        if (!size) return; // 宿主不可见(切走的标签页),量出来的尺寸没有意义
        if (size.width === canvas.width && size.height === canvas.height) return;
        // 顺序不能反:先改画布属性(此时后备缓冲已经换尺寸),再通知 Rust 重建
        // surface 与折射偏移图.两件事在同一个任务里做完,中间没有帧被提交,
        // 所以不会出现"surface 配置与画布尺寸对不上"的那一帧.
        canvas.width = size.width;
        canvas.height = size.height;
        if (booted) {
            resizeApp(size.width, size.height);
        }
    };
    // 首次必须在 boot() 之前:startApp 直接读画布当前的 width/height 建资源,
    // 于是第一次就按正确尺寸建好,不需要建完再立刻重建一遍.
    applyBackingSize();

    // 拖动窗口会连续触发,防抖之后再重建(每次重建都要重新分配后备缓冲与折射偏移图).
    let resizeTimer = 0;
    new ResizeObserver(() => {
        window.clearTimeout(resizeTimer);
        resizeTimer = window.setTimeout(applyBackingSize, RESIZE_DEBOUNCE_MS);
    }).observe(stage);
    watchDevicePixelRatio(applyBackingSize);

    /**
     * WebGPU 这条路走不通:藏掉画布(样式见 metro_window.css 的 [data-state]),
     * 首屏上只留一句短提示,完整排查步骤仍然进 SETTING 的状态区.
     * 首屏露出来的就是站点自己的背景(见 README 的"首屏"),不需要额外准备静帧图.
     */
    function markStageUnavailable(): void {
        if (stage.dataset[STAGE_STATE_DATA_KEY] === STAGE_STATE_UNAVAILABLE) return;
        stage.dataset[STAGE_STATE_DATA_KEY] = STAGE_STATE_UNAVAILABLE;
        stage.append(h('p', { class: STAGE_NOTE_CLASS, text: STAGE_NOTE_UNAVAILABLE }));
    }

    // 容器不可见(被切走的标签页 / 滚出视口)时暂停;标签页是 display:none,
    // 交集为空会直接反映成 isIntersecting === false.
    // 观察对象始终是**舞台**(画布所在的那个容器):面板搬到别的标签页去了,
    // 它可见与否不代表画面可见与否,不能拿来当暂停依据.
    const observer = new IntersectionObserver((entries) => {
        const entry = entries[entries.length - LAST_ENTRY_OFFSET];
        if (!entry) return;
        rootOnScreen = entry.isIntersecting;
        bootedRunning();
    });
    observer.observe(stage);

    document.addEventListener(EVENTS.visibilityChange, () => {
        documentVisible = !document.hidden;
        bootedRunning();
    });

    setup();
    void boot();

    async function boot(): Promise<void> {
        setStatus(STATUS_LOADING_WASM);
        try {
            await init();

            const gpu = (navigator as Navigator & { gpu?: GpuNavigator }).gpu;
            if (!gpu) {
                showWebGpuHelp(STATUS_NO_WEBGPU_API);
                return;
            }

            // 严格模式:只接受硬件 WebGPU.
            // 软件渲染(SwiftShader/llvmpipe)会用 CPU 模拟每一帧,导致
            // 所有核心高占用/风扇狂转,因此直接报错而不是降级运行.
            const adapter = await gpu.requestAdapter(GPU_ADAPTER_OPTIONS);
            if (!adapter) {
                showWebGpuHelp(STATUS_NO_ADAPTER);
                return;
            }

            let info: GpuAdapterInfo | null = null;
            let adapterLabel: string = UNKNOWN_ADAPTER_LABEL;
            try {
                info = adapter.info;
                adapterLabel = [info.vendor, info.architecture, info.device, info.description]
                    .filter(Boolean)
                    .join(ADAPTER_LABEL_SEPARATOR);
            } catch (error) {
                // 部分浏览器/版本未实现 adapter.info:不阻塞,交给 Rust 侧继续初始化
                console.warn(WARN_ADAPTER_INFO_UNAVAILABLE, error);
            }
            console.info(LOG_ADAPTER_PREFIX, adapterLabel);

            if (info && SOFTWARE_ADAPTER_PATTERN.test(adapterLabel)) {
                showWebGpuHelp(buildSoftwareAdapterMessage(adapterLabel));
                return;
            }

            await startApp(canvas, settings.status);
            booted = true;
            styleButtons.forEach((btn) => {
                btn.disabled = false;
            });
            settings.pauseButton.disabled = false;
            settings.root.disabled = false;
            // startApp 里的 App 默认就是 running,这里按当前可见性同步一次,
            // 免得在隐藏的标签页里挂载时白跑 (IntersectionObserver 的首次回调
            // 可能早于 booted = true,不能只依赖它)
            bootedRunning();
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (message.includes(WEBGPU_ADAPTER_ERROR_KEYWORD)) {
                showWebGpuHelp(`${ERROR_LABEL}${message}`);
            } else {
                setStatus(`${ERROR_LABEL}${message}`);
                // 初始化整体失败(wasm 加载 / 请求设备 / 建管线):首屏也拿不到画面,
                // 同样藏掉画布留短提示,否则访客看到的是一块什么都不显示的黑框.
                markStageUnavailable();
            }
            console.error(error);
        }
    }

    /** 状态区里给的是**完整排查步骤**(四步启用说明);首屏那边只留一句短的 */
    function showWebGpuHelp(message: string): void {
        settings.status.innerHTML = `${message}${STATUS_HTML_SEPARATOR}${WEBGPU_HELP_STEPS}`;
        markStageUnavailable();
    }

    /** 绑定一个滑块:拖动实时写入 Rust 参数,数值框输入反向同步并夹取 */
    function bindSlider({ spec, range, number }: SliderControl): void {
        const decimals = decimalPlaces(spec.step);
        const clamp = (value: number): number =>
            Number(Math.min(spec.max, Math.max(spec.min, value)).toFixed(decimals));

        const syncFromRange = (): void => {
            const value = Number(range.value);
            number.value = String(value);
            if (booted) {
                setParam(spec.param, value);
            }
        };
        const syncFromNumber = (): void => {
            const raw = Number(number.value);
            if (!Number.isFinite(raw)) return;
            const value = clamp(raw);
            range.value = String(value);
            number.value = String(value);
            if (booted) {
                setParam(spec.param, value);
            }
        };

        range.addEventListener(EVENTS.input, syncFromRange);
        number.addEventListener(EVENTS.input, syncFromNumber);
        number.addEventListener(EVENTS.change, syncFromNumber);
        syncFromRange();
    }

    function setup(): void {
        styleButtons.forEach((btn) => {
            btn.disabled = true;
            btn.addEventListener(EVENTS.click, () => {
                if (!booted) return;
                setStyle(Number(btn.dataset[STYLE_DATA_KEY] ?? DEFAULT_STYLE_INDEX));
                styleButtons.forEach((b) => b.classList.toggle(STYLE_BUTTON_ACTIVE_CLASS, b === btn));
            });
        });

        settings.startButton.addEventListener(EVENTS.click, () => {
            wantRunning = true;
            bootedRunning();
        });
        settings.pauseButton.addEventListener(EVENTS.click, () => {
            wantRunning = false;
            bootedRunning();
        });
        settings.resetButton.addEventListener(EVENTS.click, () => {
            if (booted) reset();
        });

        settings.sliders.forEach(bindSlider);
    }
}
