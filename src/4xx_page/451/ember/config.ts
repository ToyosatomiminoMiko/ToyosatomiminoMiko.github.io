/**
 * 451 余烬粒子的调参常量.
 * 性能吃紧时优先动 MAX_DPR / MAX_PIXELS(填充率),其次才是 PARTICLE_COUNT.
 */

/** 粒子数量,与原 CPU 版保持一致 */
export const PARTICLE_COUNT = 180;

/** compute pass 的工作组大小,与 compute.wgsl 里的 @workgroup_size 必须一致 */
export const WORKGROUP_SIZE = 64;

/** Particle 结构: 12 x f32 (pos/vel/size/age/life/flick/seed/color/_pad) */
export const PARTICLE_STRIDE = 48;

/** SimUniforms 结构: 12 x f32(实际只写前 8 个) */
export const UNIFORM_STRIDE = 48;

/** 固定仿真步长: dt 恒定,120Hz 屏与 60Hz 屏看到的余烬速度一致 */
export const FIXED_DT = 1 / 60;

/** 掉帧时最多补几步,防止切回标签页后雪崩 */
export const MAX_STEPS_PER_FRAME = 2;

/** 单帧最多推进多少秒(超过就当作掉帧,直接丢弃) */
export const MAX_FRAME_DELTA = 0.25;

/** 限制像素比: 高 DPI 下省一半以上填充率 */
export const MAX_DPR = 1.5;

/** 分辨率上限(约 2560x1016) */
export const MAX_PIXELS = 2_600_000;

/**
 * 帧率上限.余烬是慢速漂移的装饰,60Hz 已经绰绰有余,
 * 而 144/240Hz 屏上不设限等于把整条 合成/光栅 流水线按刷新率白烧一遍.
 */
export const MAX_FPS = 60;

/** prefers-reduced-motion 生效时降到的帧率 */
export const REDUCED_MOTION_FPS = 30;

/** 允许的调度抖动: rAF 少给一两毫秒就把整帧丢掉太亏,给一点余量 */
export const FRAME_JITTER_MS = 1.5;
