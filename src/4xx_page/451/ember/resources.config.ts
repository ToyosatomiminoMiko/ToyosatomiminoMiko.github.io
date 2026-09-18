/**
 * 粒子缓冲 CPU 侧播种(random seed)的常量.
 * 从 resources.ts 抽出: 暖色端点 / 各字段随机范围 / 重铺偏移.
 * 单位为逻辑像素(px)或秒(s), 见每条注释.
 */
import { PARTICLE_STRIDE } from './config';

/** PARTICLE_STRIDE 里有几个 f32(4 字节一个) */
export const FLOATS_PER_PARTICLE = PARTICLE_STRIDE / 4;

/** 首帧用的近似暖色 #ff7e3a(r,g,b, 0..1), 着色器重生时会覆盖 */
export const SEED_COLOR_WARM: readonly [number, number, number] = [1.0, 0.494, 0.227];

/** 首帧用的近似深色 #c04110(r,g,b, 0..1) */
export const SEED_COLOR_DEEP: readonly [number, number, number] = [0.753, 0.255, 0.063];

/** 初始上升速度下限(px/s) */
export const SEED_RISE_MIN = 46;

/** 初始上升速度额外随机跨度(px/s) */
export const SEED_RISE_SPAN = 50;

/** 水平初速度随机半宽(px/s): (random - 0.5) * span */
export const SEED_VEL_X_SPAN = 96;

/** 垂直初速度倍率下限(无量纲): 上升速度再乘它 */
export const SEED_VEL_Y_FACTOR_MIN = 1.5;

/** 垂直初速度倍率额外随机跨度(无量纲) */
export const SEED_VEL_Y_FACTOR_SPAN = 0.9;

/** 初始粒子尺寸下限(px) */
export const SEED_SIZE_MIN = 1.5;

/** 初始粒子尺寸额外随机跨度(px) */
export const SEED_SIZE_SPAN = 6;

/** 初始年龄随机跨度(s) */
export const SEED_AGE_SPAN = 4;

/** 闪烁相位随机跨度(rad): 一整圈 */
export const SEED_FLICK_SPAN = Math.PI * 2;

/** 重铺时年龄随机跨度(s): 错开一点, 避免同时熄灭 */
export const RESEED_AGE_SPAN = 0.3;

/** 重铺时屏幕下方起点偏移下限(px) */
export const RESEED_BELOW_MIN = 10;

/** 重铺时屏幕下方起点额外随机跨度(px) */
export const RESEED_BELOW_SPAN = 80;

/** 乒乓历史纹理张数 */
export const HISTORY_TEXTURE_COUNT = 2;

/** 粒子缓冲的调试标签 */
export const PARTICLE_BUFFER_LABEL = '451-particles';

/** 历史纹理调试标签前缀(后面接 0/1) */
export const HISTORY_TEXTURE_LABEL_PREFIX = '451-history-';

/** 离屏纹理首帧清屏色: 不透明黑, 避免采样到垃圾数据 */
export const HISTORY_CLEAR_VALUE = { r: 0, g: 0, b: 0, a: 1 } as const;
