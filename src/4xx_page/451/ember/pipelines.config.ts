// ================================================================
// 451 余烬粒子 -- 管线构建(pipelines.ts)的常量配置
//
// 这里集中"跨文件契约"性质的常量:绑定槽位,着色器入口点名,管线标签,
// 以及固定的混合/采样器状态.槽位与入口点名必须与
// `shaders/*.wgsl` 里的 `@group(0) @binding(n)` 与 `fn` 名逐一对应,
// 写错不会报错,只会静默失效,所以集中在这里便于对照.
// ================================================================

// ---------- 绑定槽位(与 shaders/*.wgsl 的 @binding 一致) ----------

/** compute pass:粒子 storage buffer */
export const COMPUTE_BINDING_PARTICLES = 0;

/** compute pass:仿真参数 uniform buffer */
export const COMPUTE_BINDING_UNIFORMS = 1;

/** render pass:粒子 read-only storage buffer(顶点着色器读取) */
export const RENDER_BINDING_PARTICLES = 0;

/** render pass:仿真参数 uniform buffer(片元着色器用 dt 做拖尾衰减) */
export const RENDER_BINDING_UNIFORMS = 1;

/** composite pass:离屏画面纹理 */
export const COMPOSITE_BINDING_SCENE = 0;

/** composite pass:画面采样器 */
export const COMPOSITE_BINDING_SAMPLER = 1;

/** composite pass:合成参数 uniform buffer */
export const COMPOSITE_BINDING_UNIFORMS = 2;

// ---------- 着色器入口点(必须与 WGSL 的 fn 名一致) ----------

/** 顶点着色器入口(render / composite 共用同名入口) */
export const VERTEX_ENTRY_POINT = 'vs_main';

/** 片元着色器入口(render / composite 共用同名入口) */
export const FRAGMENT_ENTRY_POINT = 'fs_main';

/** 计算着色器入口(粒子物理更新) */
export const COMPUTE_ENTRY_POINT = 'update';

/**
 * 着色器编译检查报错文案里用的短名(`WGSL(<name>) 编译错误: ...`).
 * 与 [`SHADER_MODULE_LABELS`] 的长标签不同:这里只求简短可读,文案逐字保持不变.
 */
export const SHADER_DEBUG_NAMES = {
    compute: 'compute',
    render: 'render',
    composite: 'composite',
} as const;

// ---------- 管线 / 模块标签(调试用,出现在错误信息里) ----------

/** 着色器模块标签 */
export const SHADER_MODULE_LABELS = {
    /** 计算模块(common + compute) */
    compute: '451-compute',
    /** 渲染模块(common + render) */
    render: '451-render',
    /** 合成模块(common + composite) */
    composite: '451-composite',
} as const;

/** bind group layout 标签 */
export const LAYOUT_LABELS = {
    compute: '451-compute-layout',
    render: '451-render-layout',
    composite: '451-composite-layout',
} as const;

/** 管线标签 */
export const PIPELINE_LABELS = {
    compute: '451-compute-pipeline',
    particle: '451-particle-pipeline',
    composite: '451-composite-pipeline',
} as const;

/** 采样器标签 */
export const SAMPLER_LABEL = '451-history-sampler';

// ---------- 固定渲染状态 ----------

/** 粒子渲染的原始拓扑(两点/粒子按 triangle-list 展开) */
export const PARTICLE_TOPOLOGY = 'triangle-list' as const;

/**
 * 粒子渲染的加法混合:颜色按 src-alpha 叠加,alpha 累加,
 * 让重叠的火星自然变亮(拖尾靠片元里的 dt 衰减).
 */
export const PARTICLE_BLEND_STATE = {
    color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
    alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
} as const;

/** 历史/离屏纹理采样器:线性过滤 + 边缘钳制(避免越界采样出接缝) */
export const SAMPLER_CONFIG = {
    magFilter: 'linear',
    minFilter: 'linear',
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
} as const;
