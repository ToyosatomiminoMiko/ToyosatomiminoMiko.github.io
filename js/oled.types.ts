// ================================================================
// OLED 像素画板 全部类型定义
// ================================================================

/** 像素坐标 */
export interface PixelPos {
    x: number;
    y: number;
}

/** 绘制工具类型 */
export type DrawTool = 'free' | 'line' | 'rectangle';

/** 字节顺序模式
 *  - 'lsb' : 低位在前 (Least Significant Bit first),页内 bit0 对应顶部像素
 *  - 'msb' : 高位在前 (Most  Significant Bit first),页内 bit7 对应顶部像素
 */
export type ByteOrderMode = 'lsb' | 'msb';

/** 像素颜色模式
 *  - 'dark'  : 画笔为黑色 (默认)
 *  - 'light' : 画笔为白色
 */
export type PixelColorMode = 'dark' | 'light';

/** OLED 画板初始化配置 */
export interface OLEDConfig {
    /** canvas 元素的 id,默认 'pixelCanvas' */
    canvasId: string;
    /** 物理像素宽度,默认 128 */
    width: number;
    /** 物理像素高度,默认 64 */
    height: number;
    /** 预览线/矩形的颜色 (CSS 颜色),默认 '#FF0000' */
    previewColor: string;
    /** 预览透明度 0~1,默认 0.6 */
    previewOpacity: number;
}

/** 导入数据的解析结果 */
export interface ImportResult {
    success: boolean;
    message: string;
}

/** Bresenham 直线迭代回调
 *  每走到一个像素点调用一次
 */
export type BresenhamCallback = (x: number, y: number) => void;

/** 导出的 C 数据格式 */
export interface ExportedData {
    /** 原始字节数组 (1024 字节 / 128×64 像素) */
    buffer: Uint8Array;
    /** 格式化后的 C 源码字符串 */
    cSource: string;
}