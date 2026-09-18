/**
 * WebGPU 能力获取: 申请适配器/设备,以及挑一个能用的离屏纹理格式.
 * 这里只负责"拿不到就返回 null",是否放弃绘制由调用方决定.
 */
import { log } from './log';
import {
    ADAPTER_POWER_PREFERENCE,
    FALLBACK_TEXTURE_FORMAT,
    OPTIONAL_DEVICE_FEATURES,
    PREFERRED_TEXTURE_FORMATS,
} from './capabilities.config';

export interface GpuContext {
    device: GPUDevice;
    /** 适配器信息,便于在控制台确认实际跑在哪块 GPU 上 */
    adapterInfo: GPUAdapterInfo | null;
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
    const device = await adapter.requestDevice({ requiredFeatures });
    if (!device) {
        log('requestDevice() 返回 null, 放弃绘制');
        return null;
    }

    return { device, adapterInfo: adapter.info ?? null };
}

/** 挑一个既能当渲染目标,又能被采样的离屏格式 (优先 16F, 加法叠加不易断层) */
export function pickTextureFormat(device: GPUDevice): GPUTextureFormat {
    const candidates = PREFERRED_TEXTURE_FORMATS;
    for (const format of candidates) {
        const probe = (device as DeviceWithFormatCaps).getTextureFormatCapabilities;
        if (typeof probe !== 'function') return FALLBACK_TEXTURE_FORMAT;
        try {
            if (probe.call(device, format)?.renderable !== false) return format;
        } catch {
            /* 单个格式查询失败就试下一个 */
        }
    }
    return FALLBACK_TEXTURE_FORMAT;
}
