/**
 * 451 余烬粒子的调参常量.
 * 性能吃紧时优先动 MAX_DPR / MAX_PIXELS(填充率),其次才是 PARTICLE_COUNT.
 */

/** 粒子数量. 原来的 180 实际只有 135 在跑(见 PARTICLE_STRIDE), 现在补齐并加大 */
export const PARTICLE_COUNT = 560;

/** compute pass 的工作组大小,与 compute.wgsl 里的 @workgroup_size 必须一致 */
export const WORKGROUP_SIZE = 64;

/**
 * Particle 结构: 16 x f32 = 64 字节.
 *
 * 这里曾经写的是 48(12 x f32), 但 WGSL 里 color 是 vec3<f32>, 对齐要求 16,
 * 于是真实布局是
 *     pos(0,8) vel(8,8) size(16) age(20) life(24) flick(28) seed(32)
 *     [36..48 填充] color(48,12) rise(60)
 * 一共 64 字节. 后果很隐蔽: 缓冲只开了 180x48=8640 字节, GPU 按 64 字节读,
 * arrayLength 只有 135 -- 真正在跑的粒子比声明的少 1/4, 而且 CPU 播种的数据
 * 整片错位(第 i 颗写在 48i, 读的是 64i).
 * 字段下标见 PARTICLE_FIELD, 布局有单测兜底(见 resources.test.ts).
 */
export const PARTICLE_STRIDE = 64;

/** PARTICLE_STRIDE 里的 f32 下标, 与 shaders/common.wgsl 的 struct Particle 一一对应 */
export const PARTICLE_FIELD = {
    posX: 0,
    posY: 1,
    velX: 2,
    velY: 3,
    size: 4,
    age: 5,
    life: 6,
    flick: 7,
    seed: 8,
    // [9..11]: vec3 的对齐填充
    colorR: 12,
    colorG: 13,
    colorB: 14,
    /** 这颗火星自己的巡航上升速度(px/s), 由 respawn() 给出 */
    rise: 15,
} as const;

/**
 * 初始播种用的寿命范围(秒).
 * CPU 播种只是为了让首帧不是空的; 这些粒子会在一个寿命周期内自然重生,
 * 之后完全由 GPU 接管, 所以不必和 respawn() 的公式逐位一致.
 */
export const SEED_LIFE_MIN = 9;
export const SEED_LIFE_MAX = 20;

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
