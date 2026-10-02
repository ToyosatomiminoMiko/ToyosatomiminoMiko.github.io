/**
 * WebGPU 能力获取: 申请适配器/设备,以及挑一个能用的离屏纹理格式.
 * 每一步拿不到就返回 null.
 */
import { log } from './log';
import {
    ADAPTER_POWER_PREFERENCE,
    FALLBACK_TEXTURE_FORMAT,
    OPTIONAL_DEVICE_FEATURES,
    PREFERRED_TEXTURE_FORMATS,
    TIMESTAMP_QUERY_FEATURE,
} from './capabilities.config';

/** acquireGpuContext() 的产物: 设备 + 可选特性协商的结果 */
interface GpuContext {
    device: GPUDevice;
    /**
     * 设备是否真的带上了 timestamp-query.
     * 为什么在这里算: requestDevice 返回的 device.features 恰好等于本次申请的
     * requiredFeatures, 所以"设备有没有这个特性"在这一处就已知, GPU 计时器
     * 不必再拿 device 去 probe 一遍.
     */
    timestampQuery: boolean;
}

/** 极少数实现上 getTextureFormatCapabilities 还没有进入 lib.dom */
interface TextureFormatCapabilities {
    renderable?: boolean;
}

type DeviceWithFormatCaps = GPUDevice & {
    getTextureFormatCapabilities?(format: GPUTextureFormat): TextureFormatCapabilities;
};

/** 申请适配器与设备;任何一步失败都返回 null */
export async function acquireGpuContext(): Promise<GpuContext | null> {
    if (!('gpu' in navigator) || !navigator.gpu) {
        log('navigator.gpu 不存在, 放弃绘制');
        return null;
    }

    const adapter = await navigator.gpu.requestAdapter({ powerPreference: ADAPTER_POWER_PREFERENCE });
    if (!adapter) {
        log('没有可用的 GPU 适配器(浏览器/驱动未启用 WebGPU?), 放弃绘制');
        return null;
    }

    const requiredFeatures = OPTIONAL_DEVICE_FEATURES.filter((feature) => adapter.features.has(feature));
    // requestDevice() 拿不到设备时是 reject(由调用方兜住), 不存在返回 null 的分支
    const device = await adapter.requestDevice({ requiredFeatures });

    return { device, timestampQuery: requiredFeatures.includes(TIMESTAMP_QUERY_FEATURE) };
}

/** 挑一个当渲染目标时不报 not-renderable 的离屏格式; 查询接口缺失就直接用兜底 */
export function pickTextureFormat(device: GPUDevice): GPUTextureFormat {
    const probe = (device as DeviceWithFormatCaps).getTextureFormatCapabilities;
    if (typeof probe !== 'function') return FALLBACK_TEXTURE_FORMAT;

    for (const format of PREFERRED_TEXTURE_FORMATS) {
        try {
            if (probe.call(device, format)?.renderable !== false) return format;
        } catch {
            /* 单个格式查询失败就试下一个 */
        }
    }
    return FALLBACK_TEXTURE_FORMAT;
}
