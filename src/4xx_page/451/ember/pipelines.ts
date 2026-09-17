/**
 * 管线构建: 着色器模块 + bind group layout + 三条管线 + 采样器.
 * 全部是 (device, format) 的纯函数,不持有任何运行时状态.
 */
import { shaderSources } from './shader-sources';

export interface EmberPipelines {
    computeLayout: GPUBindGroupLayout;
    computePipeline: GPUComputePipeline;
    renderLayout: GPUBindGroupLayout;
    renderPipeline: GPURenderPipeline;
    compositeLayout: GPUBindGroupLayout;
    compositePipeline: GPURenderPipeline;
    sampler: GPUSampler;
}

/** 着色器编译错误要在初始化阶段就抛出去,由 init() 统一兜住 */
async function assertCompiles(module: GPUShaderModule, name: string): Promise<void> {
    if (typeof module.getCompilationInfo !== 'function') return;
    const info = await module.getCompilationInfo();
    const errors = info.messages.filter((m) => m.type === 'error');
    if (errors.length) {
        throw new Error(
            `WGSL(${name}) 编译错误: ` + errors.map((m) => `${m.lineNum}:${m.linePos} ${m.message}`).join('; ')
        );
    }
}

export async function buildPipelines(device: GPUDevice, format: GPUTextureFormat): Promise<EmberPipelines> {
    // common.wgsl 里是共用的结构体/工具函数,与各 pass 拼成完整模块
    const computeModule = device.createShaderModule({
        label: '451-compute',
        code: `${shaderSources.common}\n${shaderSources.compute}`,
    });
    const renderModule = device.createShaderModule({
        label: '451-render',
        code: `${shaderSources.common}\n${shaderSources.render}`,
    });
    const compositeModule = device.createShaderModule({
        label: '451-composite',
        code: `${shaderSources.common}\n${shaderSources.composite}`,
    });

    await assertCompiles(computeModule, 'compute');
    await assertCompiles(renderModule, 'render');
    await assertCompiles(compositeModule, 'composite');

    // ---- compute: 更新粒子 ----
    const computeLayout = device.createBindGroupLayout({
        label: '451-compute-layout',
        entries: [
            { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
            { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        ],
    });
    const computePipeline = device.createComputePipeline({
        label: '451-compute-pipeline',
        layout: device.createPipelineLayout({ bindGroupLayouts: [computeLayout] }),
        compute: { module: computeModule, entryPoint: 'update' },
    });

    // ---- render: 画粒子 (顶点取粒子数据, 片元用 dt 做拖尾衰减) ----
    const renderLayout = device.createBindGroupLayout({
        label: '451-render-layout',
        entries: [
            { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
            {
                binding: 1,
                visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
                buffer: { type: 'uniform' },
            },
        ],
    });
    const renderPipeline = device.createRenderPipeline({
        label: '451-particle-pipeline',
        layout: device.createPipelineLayout({ bindGroupLayouts: [renderLayout] }),
        vertex: { module: renderModule, entryPoint: 'vs_main' },
        fragment: {
            module: renderModule,
            entryPoint: 'fs_main',
            targets: [
                {
                    format,
                    blend: {
                        color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
                        alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
                    },
                },
            ],
        },
        primitive: { topology: 'triangle-list' },
    });

    // ---- composite: 把离屏图(已是最终画面)拷到画布 ----
    const compositeLayout = device.createBindGroupLayout({
        label: '451-composite-layout',
        entries: [
            { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
            { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
            { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        ],
    });
    const compositePipeline = device.createRenderPipeline({
        label: '451-composite-pipeline',
        layout: device.createPipelineLayout({ bindGroupLayouts: [compositeLayout] }),
        vertex: { module: compositeModule, entryPoint: 'vs_main' },
        fragment: { module: compositeModule, entryPoint: 'fs_main', targets: [{ format }] },
        primitive: { topology: 'triangle-list' },
    });

    const sampler = device.createSampler({
        label: '451-history-sampler',
        magFilter: 'linear',
        minFilter: 'linear',
        addressModeU: 'clamp-to-edge',
        addressModeV: 'clamp-to-edge',
    });

    return {
        computeLayout,
        computePipeline,
        renderLayout,
        renderPipeline,
        compositeLayout,
        compositePipeline,
        sampler,
    };
}
