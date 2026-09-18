// ============================================================
// EmberWebGPU -- 451 余烬粒子的对外门面
//
// 设计目标: 把原来每帧 180 次 arc() + createRadialGradient() + 两次全屏
// fillRect 的 CPU 绘制全部搬到 GPU:
//   · 粒子仿真: compute shader, 状态常驻显存, CPU 每帧只写 32 字节 uniform
//   · 粒子绘制: 单次 instanced draw (1 粒子 = 1 实例 = 6 顶点)
//   · 拖尾/烟雾: 片元着色器里的指数衰减, 取代 CPU 逐帧全屏 fillRect
//   · 最终合成: 一次全屏三角形采样, 把离屏图拷到画布
//
// 失败策略: WebGPU 不可用(不支持 / 没有适配器 / 设备申请失败 / 设备丢失)
// 一律返回 false 并移除画布, 页面直接不画粒子, 不做任何降级绘制.
//
// 本文件只负责"串起来"(生命周期 + 每帧录制命令);具体职责已拆到同目录:
//   capabilities(拿设备/选格式) / pipelines(建管线) / resources(建缓冲纹理)
//   viewport(尺寸) / frame_clock(定步长) / pointer_wind(指针风) / log(日志)
// ============================================================

import {
    COMPOSITE_CLEAR_VALUE,
    COMPOSITE_VERTEX_COUNT,
    DEFAULT_DEVICE_PIXEL_RATIO,
    FIXED_DT,
    FLOAT_BYTES,
    FRAME_JITTER_MS,
    MAX_FPS,
    PARTICLE_CLEAR_VALUE,
    PARTICLE_COUNT,
    PARTICLE_VERTEX_COUNT,
    REDUCED_MOTION_FPS,
    REDUCED_MOTION_QUERY,
    UNIFORM_FLOAT_COUNT,
    UNIFORM_STRIDE,
    WORKGROUP_SIZE,
} from './config';
import {
    STATS_FPS_DATASET_KEY,
    STATS_REPORT_FRAMES,
    STATS_REPORT_INTERVAL_MS,
    STATS_REPORT_MIN_FRAMES,
} from './stats.config';
import { CANVAS_ALPHA_MODE, FALLBACK_TEXTURE_FORMAT } from './capabilities.config';
import { log } from './log';
import { acquireGpuContext, pickTextureFormat } from './capabilities';
import { buildPipelines, type EmberPipelines } from './pipelines';
import {
    createHistoryTextures,
    createParticleStore,
    reseedParticleStore,
    type ParticleStore,
} from './resources';
import { computeViewport, isSameViewport, type Viewport } from './viewport';
import { FixedStepClock } from './frame_clock';
import { PointerWind } from './pointer_wind';
import { FrameStats, type FrameStatsSnapshot } from './stats';
import { createGpuTimer, type GpuTimer } from './gpu_timing';
import { createPerfOverlay, type PerfOverlay } from './perf_overlay';

export interface EmberOptions {
    /** 粒子数量,默认 180 */
    particleCount?: number;
    /** 左上角性能 HUD(等价于地址栏 ?perf=1) */
    hud?: boolean;
}

export type { FrameStatsSnapshot, GpuPassTimings, Distribution } from './stats';

/** 系统是否要求"减少动态效果" */
function prefersReducedMotion(): boolean {
    try {
        return window.matchMedia(REDUCED_MOTION_QUERY).matches;
    } catch {
        return false;
    }
}

export class EmberWebGPU {
    readonly canvas: HTMLCanvasElement;
    readonly particleCount: number;

    running = false;
    disposed = false;
    /** 离屏纹理格式,初始化成功后才有意义 */
    textureFormat: GPUTextureFormat = FALLBACK_TEXTURE_FORMAT;
    /** 适配器信息,便于在控制台排查实际跑在哪块 GPU 上 */
    adapterInfo: GPUAdapterInfo | null = null;
    /** 最近一次解析出的物理像素尺寸,便于调试 */
    physWidth = 0;
    physHeight = 0;

    // ---- 打点: 帧间隔 / 主线程耗时 / GPU pass 耗时 ----
    /** 帧统计窗口 */
    readonly stats = new FrameStats();
    /** GPU 计时器; 适配器不支持 timestamp-query 时为 null */
    gpuTimer: GpuTimer | null = null;
    /** 每攒够这么多帧上报一次统计 */
    statsIntervalFrames = STATS_REPORT_FRAMES;
    /** 距上次上报超过这么久也强制上报一次(低帧率下 HUD 才不会僵住) */
    statsIntervalMs = STATS_REPORT_INTERVAL_MS;
    /** 帧率上限; 设为 0 表示不限制 */
    maxFps = MAX_FPS;
    /** 上报回调(屏幕 HUD / 控制台用), 默认不挂 */
    onStats: ((snapshot: FrameStatsSnapshot) => void) | null = null;

    private lastRafTime = 0;
    private lastReportTime = 0;
    private framesSinceReport = 0;
    private hud: PerfOverlay | null = null;
    private resizeObserver: ResizeObserver | null = null;

    private get frameInterval(): number {
        return this.maxFps > 0 ? 1000 / this.maxFps : 0;
    }

    private device: GPUDevice | null = null;
    private context: GPUCanvasContext | null = null;
    private contextConfigured = false;

    private readonly clock = new FixedStepClock();
    private readonly wind = new PointerWind();

    private readonly uniformData = new Float32Array(UNIFORM_STRIDE / FLOAT_BYTES);

    // init() 成功后才会全部就位
    private pipelines: EmberPipelines | null = null;
    private store: ParticleStore | null = null;
    private simBuffer: GPUBuffer | null = null;
    private historyTextures: GPUTexture[] | undefined;
    private historyViews: GPUTextureView[] = [];
    private computeBindGroup: GPUBindGroup | null = null;
    private renderBindGroup: GPUBindGroup | null = null;
    private compositeBindGroups: GPUBindGroup[] = [];
    private pendingEncoder: GPUCommandEncoder | null = null;

    private viewport: Viewport | null = null;
    private pingPong = 0;
    private rafId = 0;

    // 事件回调先给出空实现,这样 init() 失败时 dispose() 也能安全解绑
    private onPointerMove: (event: PointerEvent) => void = () => { /* 绑定前为空 */ };
    private onPointerLeave: () => void = () => { /* 绑定前为空 */ };
    private onResize: () => void = () => { /* 绑定前为空 */ };

    constructor(canvas: HTMLCanvasElement, options: EmberOptions = {}) {
        this.canvas = canvas;
        this.particleCount = options.particleCount ?? PARTICLE_COUNT;
        if (options.hud) this.hud = createPerfOverlay();
        this.frame = this.frame.bind(this);
    }

    // ---------------------------------------------------------
    // 初始化: 任何一步失败都返回 false (调用方据此放弃绘制)
    // ---------------------------------------------------------
    async init(): Promise<boolean> {
        try {
            const gpu = await acquireGpuContext();
            if (!gpu) return false;

            const { device } = gpu;
            this.device = device;
            this.adapterInfo = gpu.adapterInfo;

            // lib.dom 的 getContext 重载表里还没有 'webgpu', 这里补一个窄化断言
            const context = this.canvas.getContext('webgpu') as GPUCanvasContext | null;
            if (!context) {
                log('getContext("webgpu") 失败, 放弃绘制');
                return false;
            }
            this.context = context;

            this.textureFormat = pickTextureFormat(device);
            context.configure({
                device,
                format: this.textureFormat,
                alphaMode: CANVAS_ALPHA_MODE,
            });
            this.contextConfigured = true;

            this.pipelines = await buildPipelines(device, this.textureFormat);

            // GPU 计时是可选的: 拿不到就少一项观测,不影响绘制
            this.gpuTimer = createGpuTimer(device);
            log(this.gpuTimer ? 'GPU 计时已启用 (timestamp-query)' : 'GPU 计时不可用 (无 timestamp-query)');

            const viewport = this.measureViewport();
            this.store = createParticleStore(device, this.particleCount, viewport.cssWidth, viewport.cssHeight);
            this.simBuffer = device.createBuffer({
                label: '451-sim-uniforms',
                size: UNIFORM_STRIDE,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            });

            // resize() 会创建离屏历史纹理并据此建立 bind group
            this.resize();

            device.lost.then((info) => {
                if (this.disposed) return;
                log('设备丢失, 停止绘制:', info?.reason, info?.message);
                this.dispose();
            });
            device.addEventListener('uncapturederror', (event) => {
                const gpuError = (event as GPUUncapturedErrorEvent).error;
                log('GPU 未捕获错误:', gpuError?.message ?? gpuError);
            });

            this.bindInput();
            return true;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const stack = error instanceof Error ? error.stack ?? '' : '';
            log('WebGPU 初始化失败, 放弃绘制:', message, stack);
            this.dispose();
            return false;
        }
    }

    // ---------------------------------------------------------
    // 尺寸
    // ---------------------------------------------------------
    private measureViewport(): Viewport {
        return computeViewport(
            this.canvas,
            { width: window.innerWidth, height: window.innerHeight },
            window.devicePixelRatio || DEFAULT_DEVICE_PIXEL_RATIO
        );
    }

    private resize(): void {
        const device = this.device;
        const store = this.store;
        if (!device || !store || !this.simBuffer || !this.pipelines) return;

        const viewport = this.measureViewport();
        if (isSameViewport(this.viewport, viewport)) return;
        const first = this.viewport === null;

        this.viewport = viewport;
        this.physWidth = viewport.physWidth;
        this.physHeight = viewport.physHeight;
        this.canvas.width = viewport.physWidth;
        this.canvas.height = viewport.physHeight;

        this.historyTextures?.forEach((texture) => texture.destroy());
        this.historyTextures = createHistoryTextures(
            device,
            viewport.physWidth,
            viewport.physHeight,
            this.textureFormat
        );
        this.historyViews = this.historyTextures.map((texture) => texture.createView());
        this.buildBindGroups();

        // 首次只是把离屏纹理建起来, 粒子保留 createParticleStore() 那份"铺满整屏"
        // 的预置状态. 原来这里无条件 reseed, 一上来就把所有粒子丢到屏幕下方,
        // 于是刚打开页面时画面是空的, 要等好几秒才慢慢升满.
        if (!first) {
            // 画面尺寸变了: 让所有余烬重新从底部升起(按新宽度均匀铺开)
            reseedParticleStore(device, store, this.particleCount, viewport.cssWidth, viewport.cssHeight);
        }
        this.pingPong = 0;
    }

    private buildBindGroups(): void {
        const device = this.device;
        const pipelines = this.pipelines;
        const store = this.store;
        const simBuffer = this.simBuffer;
        if (!device || !pipelines || !store || !simBuffer) return;

        this.computeBindGroup = device.createBindGroup({
            label: '451-compute-bindgroup',
            layout: pipelines.computeLayout,
            entries: [
                { binding: 0, resource: { buffer: store.buffer } },
                { binding: 1, resource: { buffer: simBuffer } },
            ],
        });
        this.renderBindGroup = device.createBindGroup({
            label: '451-render-bindgroup',
            layout: pipelines.renderLayout,
            entries: [
                { binding: 0, resource: { buffer: store.buffer } },
                { binding: 1, resource: { buffer: simBuffer } },
            ],
        });
        this.compositeBindGroups = [0, 1].map((i) =>
            device.createBindGroup({
                label: `451-composite-bindgroup-${i}`,
                layout: pipelines.compositeLayout,
                entries: [
                    // 合成时读的是"另一张"历史纹理, 由此形成逐帧反馈拖尾
                    { binding: 0, resource: this.historyViews[i === 0 ? 1 : 0] },
                    { binding: 1, resource: pipelines.sampler },
                    { binding: 2, resource: { buffer: simBuffer } },
                ],
            })
        );
    }

    // ---------------------------------------------------------
    // 交互: 指针作为"风"
    // ---------------------------------------------------------
    private bindInput(): void {
        this.onPointerMove = (event: PointerEvent): void => {
            // pointer* 事件本身不带 touches, 这里保留旧实现的触摸回退,
            // 便于以后直接复用同一处理器接 touch* 事件
            const touch = (event as PointerEvent & { touches?: TouchList }).touches?.[0];
            const point = touch ?? event;
            this.wind.moveTo(point.clientX, point.clientY);
        };
        this.onPointerLeave = (): void => this.wind.release();
        this.onResize = (): void => this.resize();

        window.addEventListener('pointermove', this.onPointerMove, { passive: true });
        window.addEventListener('pointerdown', this.onPointerMove, { passive: true });
        window.addEventListener('pointerleave', this.onPointerLeave, { passive: true });
        window.addEventListener('blur', this.onPointerLeave);
        window.addEventListener('resize', this.onResize);
        window.addEventListener('orientationchange', this.onResize);
        document.addEventListener('visibilitychange', this.onResize);

        // 主循环里不再逐帧量 clientWidth(那是一次强制布局), 改成事件驱动:
        // ResizeObserver 负责 canvas 自身尺寸, window resize 负责 dpr 变化
        if (typeof ResizeObserver === 'function') {
            this.resizeObserver = new ResizeObserver(this.onResize);
            this.resizeObserver.observe(this.canvas);
        }
    }

    private unbindInput(): void {
        window.removeEventListener('pointermove', this.onPointerMove);
        window.removeEventListener('pointerdown', this.onPointerMove);
        window.removeEventListener('pointerleave', this.onPointerLeave);
        window.removeEventListener('blur', this.onPointerLeave);
        window.removeEventListener('resize', this.onResize);
        window.removeEventListener('orientationchange', this.onResize);
        document.removeEventListener('visibilitychange', this.onResize);
        this.resizeObserver?.disconnect();
        this.resizeObserver = null;
    }

    // ---------------------------------------------------------
    // 主循环
    // ---------------------------------------------------------
    start(): void {
        if (this.running || this.disposed) return;
        this.running = true;
        // 系统要求"减少动态效果"时把装饰性动画降到 30fps
        if (prefersReducedMotion()) this.maxFps = Math.min(this.maxFps || REDUCED_MOTION_FPS, REDUCED_MOTION_FPS);
        this.clock.reset(performance.now());
        this.lastRafTime = 0;
        this.lastReportTime = 0;
        this.stats.reset();
        this.framesSinceReport = 0;
        this.rafId = requestAnimationFrame(this.frame);
    }

    private frame(now: number): void {
        if (!this.running || this.disposed) return;

        // 帧率上限: 高刷屏上没必要为了一层余烬跑满 144/240Hz,
        // 整条 合成/光栅 流水线都跟着省下来.跳过时不动仿真时钟,
        // 下一帧 delta 变大, 定步长时钟自己会补步.
        if (this.lastRafTime !== 0 && now - this.lastRafTime < this.frameInterval - FRAME_JITTER_MS) {
            this.rafId = requestAnimationFrame(this.frame);
            return;
        }

        const steps = this.clock.advance(now);
        let cpu = 0;
        if (steps === 0) {
            // 帧间隔不足一个仿真步: 只合成一次, 反馈纹理继续衰减, 不必空转
            cpu += this.renderFrame(0);
        } else {
            for (let i = 0; i < steps; i++) cpu += this.renderFrame(FIXED_DT);
        }

        this.recordStats(now, cpu, steps);
        this.rafId = requestAnimationFrame(this.frame);
    }

    /**
     * 打点: 帧间隔和主线程耗时都记下来.
     * 帧间隔被拉长而 cpu 很小, 就说明瓶颈在 GPU / 合成器, 不在 JS.
     */
    private recordStats(now: number, cpu: number, steps: number): void {
        const interval = this.lastRafTime === 0 ? 0 : now - this.lastRafTime;
        this.lastRafTime = now;
        this.stats.record({ interval, cpu, steps, gpu: this.gpuTimer?.timings ?? undefined });

        this.framesSinceReport += 1;
        // 帧数够了,或者时间到了就上报一次: 低帧率下 HUD 也不会半天不动
        const due =
            this.framesSinceReport >= this.statsIntervalFrames ||
            now - this.lastReportTime >= this.statsIntervalMs;
        if (!due || this.framesSinceReport < STATS_REPORT_MIN_FRAMES) return;
        this.framesSinceReport = 0;
        this.lastReportTime = now;

        const snapshot = this.stats.snapshot();
        // 同时挂到 <html> 上, 便于控制台/自动化直接读, 不用实例
        document.documentElement.dataset[STATS_FPS_DATASET_KEY] = String(snapshot.fps);
        if (this.hud) this.hud.update(this.stats.format());
        this.onStats?.(snapshot);
    }

    /** 取一份当前统计快照 */
    getStats(): FrameStatsSnapshot {
        return this.stats.snapshot();
    }

    /** 清空统计窗口(改完参数想重新量一段时用) */
    resetStats(): void {
        this.stats.reset();
        this.framesSinceReport = 0;
        this.lastRafTime = 0;
    }

    /** 一行摘要, 直接 console.log 用 */
    reportStats(): string {
        return this.stats.format();
    }

    /** 写 uniform -> 录制 compute/粒子/合成三个 pass -> 提交; 返回主线程花掉的毫秒数 */
    private renderFrame(dt: number): number {
        const started = performance.now();
        this.writeUniforms(dt);
        this.encode();
        this.submit();
        return performance.now() - started;
    }

    private writeUniforms(dt: number): void {
        const device = this.device;
        const simBuffer = this.simBuffer;
        const viewport = this.viewport;
        if (!device || !simBuffer || !viewport) return;

        this.wind.update(dt);

        const u = this.uniformData;
        u[0] = this.clock.time;      // 运行时间(秒)
        u[1] = dt;                   // 仿真步长(秒)
        u[2] = viewport.cssWidth;    // 逻辑宽度
        u[3] = viewport.cssHeight;   // 逻辑高度
        u[4] = viewport.dpr;         // 设备像素比
        u[5] = this.wind.x;          // 指针位置
        u[6] = this.wind.y;
        u[7] = this.wind.strength;   // 指针影响强度(0 = 无交互)
        device.queue.writeBuffer(simBuffer, 0, u, 0, UNIFORM_FLOAT_COUNT);
    }

    private encode(): void {
        const device = this.device;
        const context = this.context;
        const pipelines = this.pipelines;
        const simBuffer = this.simBuffer;
        const computeBindGroup = this.computeBindGroup;
        const renderBindGroup = this.renderBindGroup;
        if (
            !device ||
            !context ||
            !pipelines ||
            !simBuffer ||
            !computeBindGroup ||
            !renderBindGroup
        ) {
            return;
        }

        const encoder = device.createCommandEncoder({ label: '451-frame' });
        const writeIndex = this.pingPong;
        const readIndex = 1 - writeIndex;

        // GPU 打点: 三条 pass 各切一段,不支持 timestamp-query 时整段为空操作
        const timer = this.gpuTimer;
        const slot = timer ? timer.beginFrame() : 0;
        if (timer) timer.mark(encoder, slot);

        // ---- 1) 更新粒子 (GPU compute) ----
        const computePass = encoder.beginComputePass({ label: '451-compute-pass' });
        computePass.setPipeline(pipelines.computePipeline);
        computePass.setBindGroup(0, computeBindGroup);
        computePass.dispatchWorkgroups(Math.ceil(this.particleCount / WORKGROUP_SIZE));
        computePass.end();

        if (timer) timer.mark(encoder, slot + 1);

        // ---- 2) 粒子(含历史衰减)写入离屏纹理 ----
        // loadOp:clear + 透明黑 = 上一帧历史清零, 由着色器按 fade 重新加回,
        // 以此实现 CPU 版那条 rgba(5,2,1,0.2) 拖尾, 但不需要 CPU 逐帧填充
        const particlePass = encoder.beginRenderPass({
            label: '451-particle-pass',
            colorAttachments: [
                {
                    view: this.historyViews[writeIndex],
                    loadOp: 'clear',
                    clearValue: PARTICLE_CLEAR_VALUE,
                    storeOp: 'store',
                },
            ],
        });
        particlePass.setPipeline(pipelines.renderPipeline);
        particlePass.setBindGroup(0, renderBindGroup);
        particlePass.draw(PARTICLE_VERTEX_COUNT, this.particleCount);
        particlePass.end();

        if (timer) timer.mark(encoder, slot + 2);

        // ---- 3) 反馈合成 -> 画布 (拖尾 + 烟雾) ----
        const compositePass = encoder.beginRenderPass({
            label: '451-composite-pass',
            colorAttachments: [
                {
                    view: context.getCurrentTexture().createView(),
                    loadOp: 'clear',
                    clearValue: COMPOSITE_CLEAR_VALUE,
                    storeOp: 'store',
                },
            ],
        });
        compositePass.setPipeline(pipelines.compositePipeline);
        compositePass.setBindGroup(0, this.compositeBindGroups[writeIndex]);
        compositePass.draw(COMPOSITE_VERTEX_COUNT);
        compositePass.end();

        if (timer) {
            timer.mark(encoder, slot + 3);
            timer.endFrame(encoder, slot);
        }

        this.pendingEncoder = encoder;
        this.pingPong = readIndex;
    }

    private submit(): void {
        const encoder = this.pendingEncoder;
        const device = this.device;
        if (!encoder || !device) return;
        device.queue.submit([encoder.finish()]);
        this.pendingEncoder = null;
    }

    // ---------------------------------------------------------
    // 清理
    // ---------------------------------------------------------
    dispose({ keepCanvas = false }: { keepCanvas?: boolean } = {}): void {
        if (this.disposed) {
            if (!keepCanvas) this.canvas.remove();
            return;
        }
        this.disposed = true;
        this.running = false;
        if (this.rafId) cancelAnimationFrame(this.rafId);
        this.rafId = 0;
        this.pendingEncoder = null;

        this.unbindInput();

        if (this.contextConfigured) {
            try {
                this.context?.unconfigure();
            } catch {
                /* 设备已丢失时 unconfigure 可能抛错, 忽略 */
            }
            this.contextConfigured = false;
        }

        this.historyTextures?.forEach((texture) => texture.destroy());
        this.historyTextures = undefined;
        this.historyViews = [];
        this.gpuTimer?.destroy();
        this.gpuTimer = null;
        this.hud?.remove();
        this.hud = null;
        this.stats.reset();
        this.onStats = null;
        this.store?.buffer.destroy();
        this.simBuffer?.destroy();
        this.store = null;
        this.simBuffer = null;
        this.computeBindGroup = null;
        this.renderBindGroup = null;
        this.compositeBindGroups = [];

        // 初始化失败/设备丢失 -> 直接移除画布, 不做任何降级绘制
        if (!keepCanvas) this.canvas.remove();
    }
}
