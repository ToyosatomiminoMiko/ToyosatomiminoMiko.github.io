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

/**
 * 跨模块共用的单位 / 布局 / 交互常量.
 * 下面这些分散在 index / viewport / frame_clock / pointer_wind / log 里,
 * 集中在此以免同一数值各写一份.
 */

/** 毫秒 / 秒换算(ms per s) */
export const MS_PER_SECOND = 1000;

/** 一个 f32 占的字节数 */
export const FLOAT_BYTES = 4;

/** devicePixelRatio 缺失时按 1 处理 */
export const DEFAULT_DEVICE_PIXEL_RATIO = 1;

/** 系统"减少动态效果"媒体查询串 */
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** 引擎日志前缀, 控制台按它筛选 451 的输出 */
export const LOG_PREFIX = '[451/ember]';

/** SimUniforms 每帧实际写入的 f32 个数(前 8 个字段) */
export const UNIFORM_FLOAT_COUNT = 8;

/** 一个粒子实例的顶点数(一个四边形拆两个三角形) */
export const PARTICLE_VERTEX_COUNT = 6;

/** 最终合成的全屏三角形顶点数 */
export const COMPOSITE_VERTEX_COUNT = 3;

/** 粒子 pass 的 loadOp:clear 颜色(全透明黑 = 上一帧历史清零) */
export const PARTICLE_CLEAR_VALUE = { r: 0, g: 0, b: 0, a: 0 } as const;

/** 合成 pass 的 loadOp:clear 颜色(不透明黑 = 画布底色) */
export const COMPOSITE_CLEAR_VALUE = { r: 0, g: 0, b: 0, a: 1 } as const;

/** 指针风场: 停手多久后开始衰减(ms) */
export const POINTER_IDLE_AFTER_MS = 140;

/** 指针风场: 指针初始位置(屏幕外, 逻辑像素) */
export const POINTER_OFFSCREEN = 10_000;

/** 指针风场: 仿真步长下限(s), dt 为 0 时也留一点最小推进 */
export const POINTER_MIN_DT = 1 / 240;

/** 指针风场: 强度逼近系数(无量纲), 越大越跟手 */
export const POINTER_SMOOTHING = 6;

/** 视口: 逻辑 / 物理尺寸的下限(px) */
export const VIEWPORT_MIN_DIMENSION = 1;

/** 视口: 小于这么多像素的抖动忽略(移动端地址栏收放) */
export const VIEWPORT_SIZE_TOLERANCE = 2;

/** 视口: 小于这么多 dpr 的抖动忽略 */
export const VIEWPORT_DPR_TOLERANCE = 0.01;
