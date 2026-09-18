/*
地铁车窗组件(可挂载)

- 标记写在页面里(metro_window/index.html 的 #metro-window),本模块负责:
  引入样式(metro_window.css),绑定交互,加载 wasm,启动 WebGPU 渲染;
- 做成"挂载函数"而不是页面入口,是把"标记放哪,什么时候挂"留给宿主决定.

调用方式:

    import { mountMetroWindow } from '../metro_window/web/src/metro-window';
    const el = document.getElementById('metro-window');
    if (el) mountMetroWindow(el);

单实例约束:wasm 侧的 App 是 crate 内的 thread_local 单例,setStyle/setParam/
setRunning/reset 全都作用于它,所以一个页面只应挂载一次.
*/
import './metro_window.css';

import init, { reset, setParam, setRunning, setStyle, startApp } from '../pkg/metro_window.js';

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

// 只匹配明确表示软件渲染的适配器名称,避免把 NVIDIA/AMD 硬件误判
const SOFTWARE_ADAPTER_PATTERN = /swiftshader|llvmpipe|lavapipe|microsoft basic render/i;

// 滑块 <-> Rust 参数名的映射.名字必须与 src/lib.rs 的 set_param 分支一致,
// 写错不会报错,只会静默不生效,所以集中在这里便于对照.
const SLIDERS: ReadonlyArray<{ id: string; param: string }> = [
    { id: 'vehicleSpeed', param: 'vehicle_speed' },
    { id: 'farDistance', param: 'far_distance' },
    { id: 'midDistance', param: 'mid_distance' },
    { id: 'nearDistance', param: 'near_distance' },
    { id: 'dropletSize', param: 'droplet_size' },
    { id: 'windBackward', param: 'wind_backward_factor' },
    { id: 'windSway', param: 'wind_sway_scale' },
    { id: 'gravityScale', param: 'gravity_scale' },
    { id: 'refractionScale', param: 'refraction_scale' },
    { id: 'dirtOpacity', param: 'dirt_opacity' },
    { id: 'fogOpacity', param: 'fog_opacity' },
    { id: 'interiorOpacity', param: 'interior_opacity' },
];

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
    const element = root.querySelector<T>(`#${id}`);
    if (!element) {
        throw new Error(`找不到页面元素 #${id}`);
    }
    return element;
}

export function mountMetroWindow(root: HTMLElement): void {
    // 标记由页面提供(metro_window/index.html).这里只补类名:样式全靠它作用域,
    // 漏写就是"样式静默失效",补一下比报错划算.
    root.classList.add('metro-window');

    const status = mustFind(root, 'status');
    const canvas = mustFind<HTMLCanvasElement>(root, 'webgpu-canvas');
    const setStatus = (message: string): void => {
        status.textContent = message;
        console.log(message);
    };

    // 容器不可见(被切走的标签页 / 滚出视口)时暂停;标签页是 display:none,
    // 交集为空会直接反映成 isIntersecting === false
    const observer = new IntersectionObserver((entries) => {
        const entry = entries[entries.length - 1];
        if (!entry) return;
        rootOnScreen = entry.isIntersecting;
        bootedRunning();
    });
    observer.observe(root);

    document.addEventListener('visibilitychange', () => {
        documentVisible = !document.hidden;
        bootedRunning();
    });

    setup();
    void boot();

    async function boot(): Promise<void> {
        setStatus('正在加载 WebAssembly...');
        try {
            await init();

            const gpu = (navigator as Navigator & { gpu?: GpuNavigator }).gpu;
            if (!gpu) {
                showWebGpuHelp('当前浏览器不支持 WebGPU(未找到 navigator.gpu).');
                return;
            }

            // 严格模式:只接受硬件 WebGPU.
            // 软件渲染(SwiftShader/llvmpipe)会用 CPU 模拟每一帧,导致
            // 所有核心高占用/风扇狂转,因此直接报错而不是降级运行.
            const adapter = await gpu.requestAdapter({
                powerPreference: 'high-performance',
                forceFallbackAdapter: false,
            });
            if (!adapter) {
                showWebGpuHelp('当前浏览器未提供 WebGPU 适配器(No available adapters).请检查是否已启用 WebGPU 与硬件加速后刷新重试');
                return;
            }

            let info: GpuAdapterInfo | null = null;
            let adapterLabel = '未知';
            try {
                info = adapter.info;
                adapterLabel = [info.vendor, info.architecture, info.device, info.description]
                    .filter(Boolean)
                    .join(' ');
            } catch (error) {
                // 部分浏览器/版本未实现 adapter.info:不阻塞,交给 Rust 侧继续初始化
                console.warn('无法读取 WebGPU 适配器信息,跳过软件渲染检查', error);
            }
            console.info('WebGPU 适配器:', adapterLabel);

            if (info && SOFTWARE_ADAPTER_PATTERN.test(adapterLabel)) {
                showWebGpuHelp(
                    `❌ 当前 WebGPU 适配器为 CPU 软件渲染(${adapterLabel}),说明这个浏览器实例访问不到独立显卡.若你用的是 Fedora/Chromium 且系统浏览器仍报此错,已知是 Chromium 沙箱挡住了 NVIDIA Vulkan 驱动,可改用 Firefox,或用 \`chromium-browser --no-sandbox --enable-unsafe-webgpu\` 启动(仅限本机可信页面).注意:chrome://flags/#enable-vulkan 可能导致 Chromium 黑屏,不建议启用`,
                );
                return;
            }

            await startApp(canvas, status);
            booted = true;
            root.querySelectorAll<HTMLButtonElement>('.style-btn').forEach((btn) => {
                btn.disabled = false;
            });
            mustFind<HTMLButtonElement>(root, 'pauseBtn').disabled = false;
            mustFind<HTMLFieldSetElement>(root, 'paramPanel').disabled = false;
            // startApp 里的 App 默认就是 running,这里按当前可见性同步一次,
            // 免得在隐藏的标签页里挂载时白跑 (IntersectionObserver 的首次回调
            // 可能早于 booted = true,不能只依赖它)
            bootedRunning();
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (message.includes('WebGPU 适配器')) {
                showWebGpuHelp(`❌ ${message}`);
            } else {
                setStatus(`❌ ${message}`);
            }
            console.error(error);
        }
    }

    function showWebGpuHelp(message: string): void {
        status.innerHTML = `${message}<br><br>` +
            '请按以下任一步骤启用 WebGPU:<br>' +
            '① Chrome / Edge:地址栏打开 <b>chrome://flags/#enable-unsafe-webgpu</b> 或 <b>edge://flags/#enable-unsafe-webgpu</b>,选择 <b>Enabled</b> 并重启浏览器;<br>' +
            '② 在设置中开启"使用硬件加速"(Chrome 设置 -> 系统 -> 使用图形加速),并到 <b>chrome://gpu</b> 确认 WebGPU 状态为可用;<br>' +
            '③ Firefox:地址栏打开 <b>about:config</b>,搜索 <b>dom.webgpu.enabled</b> 设为 <b>true</b>;<br>' +
            '④ 若在虚拟机/远程桌面或无独显环境运行,请改用支持 WebGPU 的物理机/浏览器.';
    }

    function setup(): void {
        const styleButtons = root.querySelectorAll<HTMLButtonElement>('.style-btn');
        styleButtons.forEach((btn) => {
            btn.disabled = true;
            btn.addEventListener('click', () => {
                if (!booted) return;
                setStyle(Number(btn.dataset.style ?? 0));
                styleButtons.forEach((b) => b.classList.toggle('active', b === btn));
            });
        });

        mustFind(root, 'startBtn').addEventListener('click', () => {
            wantRunning = true;
            bootedRunning();
        });
        mustFind(root, 'pauseBtn').addEventListener('click', () => {
            wantRunning = false;
            bootedRunning();
        });
        mustFind(root, 'resetBtn').addEventListener('click', () => {
            if (booted) reset();
        });

        // 滑块:拖动时实时写入 Rust 参数,下一帧立即生效
        SLIDERS.forEach(({ id, param }) => {
            const input = mustFind<HTMLInputElement>(root, id);
            const numberInput = mustFind<HTMLInputElement>(root, `${id}Num`);
            const min = Number(input.min);
            const max = Number(input.max);
            const decimals = (Number(input.step).toString().split('.')[1] ?? '').length;
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
            input.addEventListener('input', syncFromSlider);
            numberInput.addEventListener('input', syncFromNumber);
            numberInput.addEventListener('change', syncFromNumber);
            syncFromSlider();
        });
    }
}
