/*
地铁车窗组件(可挂载)

- 标记写在页面里(metro_window/index.html 的 #metro-window),本模块负责:
  引入样式(metro_window.css),绑定交互,加载 wasm,启动 WebGPU 渲染;
- 做成"挂载函数"而不是页面入口,是把"标记放哪,什么时候挂"留给宿主决定.

所有字面量(id / 类名 / data-* 键名 / Rust 参数名 / 文案 / 阈值)都集中在
./config.ts,本文件只保留逻辑与结构.

调用方式:

    import { mountMetroWindow } from '../metro_window/web/src/metro-window';
    const el = document.getElementById('metro-window');
    if (el) mountMetroWindow(el);

单实例约束:wasm 侧的 App 是 crate 内的 thread_local 单例,setStyle/setParam/
setRunning/reset 全都作用于它,所以一个页面只应挂载一次.
*/
import './metro_window.css';

import init, { reset, setParam, setRunning, setStyle, startApp } from '../pkg/metro_window.js';

import {
    ADAPTER_LABEL_SEPARATOR,
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
    NUMBER_INPUT_ID_SUFFIX,
    SLIDERS,
    SOFTWARE_ADAPTER_PATTERN,
    STATUS_HTML_SEPARATOR,
    STATUS_LOADING_WASM,
    STATUS_NO_ADAPTER,
    STATUS_NO_WEBGPU_API,
    STYLE_BUTTON_ACTIVE_CLASS,
    STYLE_BUTTON_CLASS,
    STYLE_DATA_KEY,
    UNKNOWN_ADAPTER_LABEL,
    WARN_ADAPTER_INFO_UNAVAILABLE,
    WEBGPU_ADAPTER_ERROR_KEYWORD,
    WEBGPU_HELP_STEPS,
    WINDOW_CLASS,
} from './config';

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

export function mountMetroWindow(root: HTMLElement): void {
    // 标记由页面提供(metro_window/index.html).这里只补类名:样式全靠它作用域,
    // 漏写就是"样式静默失效",补一下比报错划算.
    root.classList.add(WINDOW_CLASS);

    const status = mustFind(root, ELEMENT_IDS.status);
    const canvas = mustFind<HTMLCanvasElement>(root, ELEMENT_IDS.canvas);
    const setStatus = (message: string): void => {
        status.textContent = message;
        console.log(message);
    };

    // 容器不可见(被切走的标签页 / 滚出视口)时暂停;标签页是 display:none,
    // 交集为空会直接反映成 isIntersecting === false
    const observer = new IntersectionObserver((entries) => {
        const entry = entries[entries.length - LAST_ENTRY_OFFSET];
        if (!entry) return;
        rootOnScreen = entry.isIntersecting;
        bootedRunning();
    });
    observer.observe(root);

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

            await startApp(canvas, status);
            booted = true;
            root.querySelectorAll<HTMLButtonElement>(`.${STYLE_BUTTON_CLASS}`).forEach((btn) => {
                btn.disabled = false;
            });
            mustFind<HTMLButtonElement>(root, ELEMENT_IDS.pauseButton).disabled = false;
            mustFind<HTMLFieldSetElement>(root, ELEMENT_IDS.paramPanel).disabled = false;
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
            }
            console.error(error);
        }
    }

    function showWebGpuHelp(message: string): void {
        status.innerHTML = `${message}${STATUS_HTML_SEPARATOR}${WEBGPU_HELP_STEPS}`;
    }

    function setup(): void {
        const styleButtons = root.querySelectorAll<HTMLButtonElement>(`.${STYLE_BUTTON_CLASS}`);
        styleButtons.forEach((btn) => {
            btn.disabled = true;
            btn.addEventListener(EVENTS.click, () => {
                if (!booted) return;
                setStyle(Number(btn.dataset[STYLE_DATA_KEY] ?? DEFAULT_STYLE_INDEX));
                styleButtons.forEach((b) => b.classList.toggle(STYLE_BUTTON_ACTIVE_CLASS, b === btn));
            });
        });

        mustFind(root, ELEMENT_IDS.startButton).addEventListener(EVENTS.click, () => {
            wantRunning = true;
            bootedRunning();
        });
        mustFind(root, ELEMENT_IDS.pauseButton).addEventListener(EVENTS.click, () => {
            wantRunning = false;
            bootedRunning();
        });
        mustFind(root, ELEMENT_IDS.resetButton).addEventListener(EVENTS.click, () => {
            if (booted) reset();
        });

        // 滑块:拖动时实时写入 Rust 参数,下一帧立即生效
        SLIDERS.forEach(({ id, param }) => {
            const input = mustFind<HTMLInputElement>(root, id);
            const numberInput = mustFind<HTMLInputElement>(root, `${id}${NUMBER_INPUT_ID_SUFFIX}`);
            const min = Number(input.min);
            const max = Number(input.max);
            const decimals = (Number(input.step).toString().split(DECIMAL_SEPARATOR)[DECIMAL_FRACTION_INDEX] ?? '').length;
            const syncFromSlider = (): void => {
                const value = Number(input.value);
                numberInput.value = String(value);
                if (booted) {
                    setParam(param, value);
                }
            };
            const syncFromNumber = (): void => {
                const raw = Number(numberInput.value);
                if (!Number.isFinite(raw)) return;
                const clamped = Number(Math.min(max, Math.max(min, raw)).toFixed(decimals));
                input.value = String(clamped);
                numberInput.value = String(clamped);
                if (booted) {
                    setParam(param, clamped);
                }
            };
            input.addEventListener(EVENTS.input, syncFromSlider);
            numberInput.addEventListener(EVENTS.input, syncFromNumber);
            numberInput.addEventListener(EVENTS.change, syncFromNumber);
            syncFromSlider();
        });
    }
}
