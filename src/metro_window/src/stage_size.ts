/*
 * 首屏舞台的后备缓冲尺寸(纯函数,所以能直接单测).
 *
 * 为什么不是"后备缓冲 = 视口尺寸":
 *   城市四层 / 污渍 / 雾气都是拿 uv 直接铺满画布的(见 shaders.wgsl 的 uvBG 等),
 *   uv 是 [0,1]²,画布比例一变整幅场景就被横向拉伸(21:9 上建筑变胖,竖屏上被压扁).
 *   所以后备缓冲**恒为 16:9**,取"覆盖宿主所需"的那个尺寸:
 *   两边都至少铺满,多出来的部分由 CSS 的 object-fit: cover 裁掉.
 *
 * 为什么乘 dpr:
 *   后备缓冲是**物理像素**,CSS 盒子是 CSS 像素.乘上 dpr 才是 1:1 显示,
 *   否则在高分屏上等于让浏览器把位图放大 dpr 倍(水珠边缘按 2 个缓冲像素
 *   收敛的设计会白做 -- 见 shaders.wgsl 的 edgeWidth).
 *
 * 与 Rust 侧的约定:调用方先改 `<canvas>` 的 width/height,再调 wasm 的 resize,
 * 两边拿到的是同一个尺寸;`aspect` 在 Rust 那边由 surface 配置算出,不另存一份.
 */
import {
    CANVAS_HEIGHT,
    CANVAS_WIDTH,
    MAX_BACKING_PIXELS,
    MAX_DEVICE_PIXEL_RATIO,
    MIN_BACKING_DIMENSION,
    MIN_DEVICE_PIXEL_RATIO,
} from '@/metro_window/src/config';

/** 后备缓冲尺寸(物理像素) */
export interface BackingSize {
    readonly width: number;
    readonly height: number;
}

/**
 * 算"覆盖宿主所需的 16:9 后备缓冲尺寸".
 *
 * @param viewportWidth  宿主的 CSS 宽度(px)
 * @param viewportHeight 宿主的 CSS 高度(px)
 * @param devicePixelRatio 设备像素比
 * @returns 尺寸;**宿主不可见(宽或高为 0)时返回 null**,调用方跳过这次调整
 */
export function computeBackingSize(
    viewportWidth: number,
    viewportHeight: number,
    devicePixelRatio: number,
): BackingSize | null {
    // 宿主不可见(标签页被切走时 display:none,量出来就是 0):
    // 这时候算出来的尺寸没有意义,而且会把后备缓冲缩到 1×1.
    if (viewportWidth <= 0 || viewportHeight <= 0) {
        return null;
    }

    const ratio = CANVAS_WIDTH / CANVAS_HEIGHT;
    // dpr 下限取 1:有些环境(强制缩放)会报出小于 1 的值,按小于 1 算等于故意糊画面.
    const dpr = Math.min(Math.max(devicePixelRatio, MIN_DEVICE_PIXEL_RATIO), MAX_DEVICE_PIXEL_RATIO);

    // 覆盖:两边都要铺满,所以取需要更大的那一边,另一边按 16:9 顺出来.
    let width = Math.max(viewportWidth, viewportHeight * ratio) * dpr;
    let height = width / ratio;

    // 可选的像素总数上限(MAX_BACKING_PIXELS = 0 表示不限).
    if (MAX_BACKING_PIXELS > 0 && width * height > MAX_BACKING_PIXELS) {
        const scale = Math.sqrt(MAX_BACKING_PIXELS / (width * height));
        width *= scale;
        height *= scale;
    }

    return {
        width: Math.max(MIN_BACKING_DIMENSION, Math.round(width)),
        height: Math.max(MIN_BACKING_DIMENSION, Math.round(height)),
    };
}
