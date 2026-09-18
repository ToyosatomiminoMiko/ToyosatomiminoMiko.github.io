/**
 * 尺寸计算 -- 纯函数,不依赖真实 DOM(只要对象上有 clientWidth/clientHeight),
 * 因此可以直接单测.
 *
 * 仿真用逻辑像素 + 秒,渲染时乘 dpr 换算物理像素,所以窗口缩放后粒子位置不会错位.
 */
import {
    DEFAULT_DEVICE_PIXEL_RATIO,
    MAX_DPR,
    MAX_PIXELS,
    VIEWPORT_DPR_TOLERANCE,
    VIEWPORT_MIN_DIMENSION,
    VIEWPORT_SIZE_TOLERANCE,
} from './config';

/** canvas 这类元素只需要这两个属性 */
export interface SizedElement {
    clientWidth: number;
    clientHeight: number;
}

export interface Viewport {
    /** 逻辑(CSS)像素 */
    cssWidth: number;
    cssHeight: number;
    /** 实际渲染分辨率 */
    physWidth: number;
    physHeight: number;
    /** 经上限裁剪后的设备像素比 */
    dpr: number;
}

export interface ViewportLimits {
    maxDpr: number;
    maxPixels: number;
}

export const DEFAULT_VIEWPORT_LIMITS: ViewportLimits = { maxDpr: MAX_DPR, maxPixels: MAX_PIXELS };

/**
 * @param element  量取逻辑尺寸的元素(通常是 canvas)
 * @param fallback 元素量不到尺寸时的兜底(通常是视口)
 */
export function computeViewport(
    element: SizedElement,
    fallback: { width: number; height: number },
    devicePixelRatio: number,
    limits: ViewportLimits = DEFAULT_VIEWPORT_LIMITS
): Viewport {
    const cssWidth = Math.max(VIEWPORT_MIN_DIMENSION, element.clientWidth || fallback.width);
    const cssHeight = Math.max(VIEWPORT_MIN_DIMENSION, element.clientHeight || fallback.height);

    let dpr = Math.min(devicePixelRatio || DEFAULT_DEVICE_PIXEL_RATIO, limits.maxDpr);
    let physWidth = Math.round(cssWidth * dpr);
    let physHeight = Math.round(cssHeight * dpr);

    // 超过像素上限就整体等比缩小,宁可软一点也不要把填充率拉爆
    const pixels = physWidth * physHeight;
    if (pixels > limits.maxPixels) {
        const scale = Math.sqrt(limits.maxPixels / pixels);
        physWidth = Math.max(VIEWPORT_MIN_DIMENSION, Math.round(physWidth * scale));
        physHeight = Math.max(VIEWPORT_MIN_DIMENSION, Math.round(physHeight * scale));
        dpr = dpr * scale;
    }

    return { cssWidth, cssHeight, physWidth, physHeight, dpr };
}

/**
 * 移动端地址栏收放会反复触发 resize: 小于容差的抖动直接忽略.
 * 容差见 config.ts 的 VIEWPORT_SIZE_TOLERANCE / VIEWPORT_DPR_TOLERANCE.
 */
export function isSameViewport(previous: Viewport | null, next: Viewport): boolean {
    if (!previous) return false;
    return (
        Math.abs(previous.cssWidth - next.cssWidth) < VIEWPORT_SIZE_TOLERANCE &&
        Math.abs(previous.cssHeight - next.cssHeight) < VIEWPORT_SIZE_TOLERANCE &&
        Math.abs(previous.dpr - next.dpr) < VIEWPORT_DPR_TOLERANCE
    );
}
