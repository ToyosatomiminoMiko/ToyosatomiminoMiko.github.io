// ============================================================
// common.wgsl -- 451 余烬粒子系统: 公共常量与工具函数
// 被 compute.wgsl / render.wgsl / composite.wgsl 拼接复用
// ============================================================

struct SimUniforms {
    time        : f32,   // 运行时间(秒)
    dt          : f32,   // 仿真步长(秒)
    width       : f32,   // 逻辑宽度(CSS 像素)
    height      : f32,   // 逻辑高度(CSS 像素)
    dpr         : f32,   // 设备像素比(渲染时换算物理像素)
    pointerX    : f32,   // 指针位置(用于风向扰动)
    pointerY    : f32,
    windScale   : f32,   // 指针影响强度(0 = 无交互)
};

struct Particle {
    pos    : vec2<f32>,  // 逻辑像素坐标
    vel    : vec2<f32>,  // 逻辑像素/秒
    size   : f32,        // 基础半径
    age    : f32,        // 已存活时间(秒)
    life   : f32,        // 总寿命(秒)
    flick  : f32,        // 闪烁相位
    seed   : f32,        // 稳定随机种子
    color  : vec3<f32>,  // 基础暖色
    rise   : f32,        // 这颗自己的巡航上升速度(px/s, 正数表示向上)
};

// ---------- 上升运动的调参 ----------
// 老实现把"能升多高"交给了"寿命"和一条 -34px/s 的拖底,
// 而纵向阻力(2.6/s)会在几百毫秒内把初速拖光, 稳态只剩 ~23px/s,
// 寿命又只有 1.6~3.8s -- 乘起来一生只升几十像素, 于是全部挤在画面最底下一条.
// 现在改成显式的"巡航速度 x 寿命", 并且行程按屏高给, 这样 768p 和 4K 观感一致.

/** 巡航上升速度范围(px/s): 太慢会像静止的噪点, 太快就不像灰烬 */
const RISE_MIN : f32 = 60.0;
const RISE_MAX : f32 = 140.0;

/**
 * 一生大致升过几个屏高.
 * 下限取 1.0 是关键: 保证连最慢的火星也能升到画面顶部, 于是稳态下整屏都有粒子,
 * 而不是"底下堆一层,中间空一条". 上限大于 1 让一部分能飘出顶部再消失.
 */
const SPAN_MIN : f32 = 1.0;
const SPAN_MAX : f32 = 1.6;

// ---------- 随机数 (PCG 风格哈希, 无状态) ----------
fn hash11(p : f32) -> f32 {
    var x = fract(p * 0.1031);
    x = x * (x + 33.33);
    x = x * (x + x);
    return fract(x);
}

fn hash21(p : vec2<f32>) -> f32 {
    var x = fract(p * vec2<f32>(0.1031, 0.1030));
    let d = dot(x, x + 33.33);
    x = x + d;
    return fract((x.x + x.y) * x.x);
}

// ---------- 暖色火色调色板 (对应原 CPU 版的 colorPalette) ----------
fn emberPalette(t : f32) -> vec3<f32> {
    let p0 = vec3<f32>(1.000, 0.494, 0.227); // #ff7e3a
    let p1 = vec3<f32>(1.000, 0.341, 0.133); // #ff5722
    let p2 = vec3<f32>(1.000, 0.227, 0.000); // #ff3a00
    let p3 = vec3<f32>(1.000, 0.569, 0.302); // #ff914d
    let p4 = vec3<f32>(0.890, 0.302, 0.110); // #e34d1c
    let p5 = vec3<f32>(1.000, 0.702, 0.278); // #ffb347
    let p6 = vec3<f32>(0.753, 0.255, 0.063); // #c04110

    let s = clamp(t, 0.0, 1.0) * 6.0;
    if (s < 1.0) { return mix(p0, p1, s); }
    if (s < 2.0) { return mix(p1, p2, s - 1.0); }
    if (s < 3.0) { return mix(p2, p3, s - 2.0); }
    if (s < 4.0) { return mix(p3, p4, s - 3.0); }
    if (s < 5.0) { return mix(p4, p5, s - 4.0); }
    return mix(p5, p6, s - 5.0);
}

// 重设一个粒子 -- 在底部区域"重生", 模拟灰烬飘升 (像素 / 秒)
fn respawn(seed : f32, time : f32, w : f32, h : f32) -> Particle {
    let k = seed + time * 0.137;
    let r1 = hash11(k + 1.7);
    let r2 = hash11(k + 9.3);
    let r3 = hash11(k + 21.1);
    let r4 = hash11(k + 4.9);
    let r5 = hash11(k + 63.7);
    let r6 = hash11(k + 87.5);
    let r7 = hash11(k + 41.3);

    var p : Particle;

    // 这颗的巡航速度, 以及"一生要升过多少个屏高"
    let rise = RISE_MIN + r4 * (RISE_MAX - RISE_MIN);
    let span = h * (SPAN_MIN + r7 * (SPAN_MAX - SPAN_MIN));

    // 底部偏下的重生带(最多低于画面约 88px):
    // 起点在屏幕外, 升进来时刚好是"刚出现"的样子
    p.pos   = vec2<f32>(r1 * w, h + 8.0 + r2 * 80.0);
    // 初速比巡航快 1.5~2.4 倍: 刚诞生的火星先窜一下, 再被阻力收敛到巡航速度
    p.vel   = vec2<f32>((r3 - 0.5) * 96.0, -rise * (1.5 + r5 * 0.9));
    p.size  = 1.5 + r5 * 6.0;
    p.age   = r6 * 0.35;                 // 初始略为错开, 避免同时熄灭
    // 寿命由目标行程反推: 初速衰减到巡航那一段大约多走 1.2 个 rise, 这里一并算进去
    p.life  = span / rise + 1.2;
    p.flick = r3 * 6.2831853;
    p.seed  = seed;
    p.color = emberPalette(hash11(k + 33.3) * 0.999);
    p.rise  = rise;
    return p;
}
