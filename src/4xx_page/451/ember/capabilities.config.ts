/**
 * WebGPU 能力协商(capabilities.ts)的常量.
 * 从 capabilities.ts 抽出: 可选特性 / 适配器偏好 / 离屏格式候选.
 */

/**
 * 有就用, 没有也能跑的可选设备特性.
 * timestamp-query 只服务于性能打点, 缺失时统计里少一项 GPU 耗时而已.
 */
export const OPTIONAL_DEVICE_FEATURES: GPUFeatureName[] = ['timestamp-query'];

/** 申请适配器时的功耗偏好(独显优先, 集显也能跑) */
export const ADAPTER_POWER_PREFERENCE = 'high-performance' as const;

/** 离屏纹理格式候选(按优先级): 优先 16F, 加法叠加不易断层 */
export const PREFERRED_TEXTURE_FORMATS: GPUTextureFormat[] = ['rgba16float', 'rgba8unorm'];

/** 候选都不支持 / 查询接口缺失时的兜底格式 */
export const FALLBACK_TEXTURE_FORMAT: GPUTextureFormat = 'rgba8unorm';

/** 画布上下文的 alpha 模式 */
export const CANVAS_ALPHA_MODE = 'premultiplied' as const;
