/**
 * 管线构建: 着色器模块 + bind group layout + 三条管线 + 采样器.
 * 全部是 (device, format) 的纯函数,不持有任何运行时状态.
 *
 * 绑定槽位 / 入口点名 / 标签 / 混合与采样器状态集中在
 * `pipelines.config.ts`,这里只做接线,不再出现裸字面量.
 */
import {
    COMPOSITE_BINDING_SAMPLER,
    COMPOSITE_BINDING_SCENE,
    COMPUTE_BINDING_PARTICLES,
    COMPUTE_BINDING_UNIFORMS,
    COMPUTE_ENTRY_POINT,
    FRAGMENT_ENTRY_POINT,
    LAYOUT_LABELS,
    PARTICLE_BLEND_STATE,
    PARTICLE_TOPOLOGY,
    PIPELINE_LABELS,
    RENDER_BINDING_PARTICLES,
    RENDER_BINDING_UNIFORMS,
    SAMPLER_CONFIG,
    SAMPLER_LABEL,
    SHADER_DEBUG_NAMES,
    SHADER_MODULE_LABELS,
    VERTEX_ENTRY_POINT,
} from './pipelines.config';
import { shaderSources } from './shader_sources';

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
        label: SHADER_MODULE_LABELS.compute,
        code: `${shaderSources.common}\n${shaderSources.compute}`,
    });
    const renderModule = device.createShaderModule({
        label: SHADER_MODULE_LABELS.render,
        code: `${shaderSources.common}\n${shaderSources.render}`,
    });
    const compositeModule = device.createShaderModule({
        label: SHADER_MODULE_LABELS.composite,
        code: `${shaderSources.common}\n${shaderSources.composite}`,
    });

    await assertCompiles(computeModule, SHADER_DEBUG_NAMES.compute);
    await assertCompiles(renderModule, SHADER_DEBUG_NAMES.render);
    await assertCompiles(compositeModule, SHADER_DEBUG_NAMES.composite);

    // ---- compute: 更新粒子 ----
    const computeLayout = device.createBindGroupLayout({
        label: LAYOUT_LABELS.compute,
        entries: [
            {
                binding: COMPUTE_BINDING_PARTICLES,
                visibility: GPUShaderStage.COMPUTE,
                buffer: { type: 'storage' },
            },
            {
                binding: COMPUTE_BINDING_UNIFORMS,
                visibility: GPUShaderStage.COMPUTE,
                buffer: { type: 'uniform' },
            },
        ],
    });
    const computePipeline = device.createComputePipeline({
        label: PIPELINE_LABELS.compute,
        layout: device.createPipelineLayout({ bindGroupLayouts: [computeLayout] }),
        compute: { module: computeModule, entryPoint: COMPUTE_ENTRY_POINT },
    });

    // ---- render: 画粒子 (顶点取粒子数据, 片元用 dt 做拖尾衰减) ----
    const renderLayout = device.createBindGroupLayout({
        label: LAYOUT_LABELS.render,
        entries: [
            {
                binding: RENDER_BINDING_PARTICLES,
                visibility: GPUShaderStage.VERTEX,
                buffer: { type: 'read-only-storage' },
            },
            {
                binding: RENDER_BINDING_UNIFORMS,
                visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
                buffer: { type: 'uniform' },
            },
        ],
    });
    const renderPipeline = device.createRenderPipeline({
        label: PIPELINE_LABELS.particle,
        layout: device.createPipelineLayout({ bindGroupLayouts: [renderLayout] }),
        vertex: { module: renderModule, entryPoint: VERTEX_ENTRY_POINT },
        fragment: {
            module: renderModule,
            entryPoint: FRAGMENT_ENTRY_POINT,
            targets: [{ format, blend: PARTICLE_BLEND_STATE }],
        },
        primitive: { topology: PARTICLE_TOPOLOGY },
    });

    // ---- composite: 把离屏图(已是最终画面)拷到画布 ----
    const compositeLayout = device.createBindGroupLayout({
        label: LAYOUT_LABELS.composite,
        entries: [
            {
                binding: COMPOSITE_BINDING_SCENE,
                visibility: GPUShaderStage.FRAGMENT,
                texture: { sampleType: 'float' },
            },
            {
                binding: COMPOSITE_BINDING_SAMPLER,
                visibility: GPUShaderStage.FRAGMENT,
                sampler: { type: 'filtering' },
            },
        ],
    });
    const compositePipeline = device.createRenderPipeline({
        label: PIPELINE_LABELS.composite,
        layout: device.createPipelineLayout({ bindGroupLayouts: [compositeLayout] }),
        vertex: { module: compositeModule, entryPoint: VERTEX_ENTRY_POINT },
        fragment: { module: compositeModule, entryPoint: FRAGMENT_ENTRY_POINT, targets: [{ format }] },
        primitive: { topology: PARTICLE_TOPOLOGY },
    });

    const sampler = device.createSampler({
        label: SAMPLER_LABEL,
        ...SAMPLER_CONFIG,
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
