/**
 * WebGPU 能力协商(capabilities.ts)的常量: 可选设备特性 / 适配器功耗偏好 /
 * 离屏纹理格式候选与兜底格式.
 */

/**
 * 有就用, 没有也能跑的可选设备特性. timestamp-query 只服务于性能打点,
 * 缺失时统计里少一项 GPU 耗时而已.
 */
export const TIMESTAMP_QUERY_FEATURE: GPUFeatureName = 'timestamp-query';

/** requestDevice 时要申请的可选特性列表: 名称的唯一来源 */
export const OPTIONAL_DEVICE_FEATURES: GPUFeatureName[] = [TIMESTAMP_QUERY_FEATURE];

/** 申请适配器时的功耗偏好(独显优先, 集显也能跑) */
export const ADAPTER_POWER_PREFERENCE = 'high-performance' as const;

/**
 * 离屏纹理格式候选(按优先级): 优先 16F -- 加法叠加下 rgba16float 不易断层,
 * 但它并非所有实现都可渲染, 所以后面跟一个 8-bit 兜底.
 */
export const PREFERRED_TEXTURE_FORMATS: GPUTextureFormat[] = ['rgba16float', 'rgba8unorm'];

/** 兜底格式: 取候选里的最后一个, 保证它与候选列表不会各改各的 */
export const FALLBACK_TEXTURE_FORMAT: GPUTextureFormat =
    PREFERRED_TEXTURE_FORMATS[PREFERRED_TEXTURE_FORMATS.length - 1];

/** 画布上下文的 alpha 模式 */
export const CANVAS_ALPHA_MODE = 'premultiplied' as const;
