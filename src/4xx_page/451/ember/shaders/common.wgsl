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
    _pad   : f32,
};

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

    var p : Particle;
    // 底部偏下的重生带(最多低于画面约 78px): 粒子寿命有限,
    // 重生点太靠下会来不及升入可见区域就熄灭, 显得粒子很稀疏
    p.pos   = vec2<f32>(r1 * w, h + 8.0 + r2 * 70.0);
    // 上升速度 42~174 px/s, 横向 -48~48 px/s
    p.vel   = vec2<f32>((r3 - 0.5) * 96.0, -(42.0 + r4 * 132.0));
    p.size  = 1.8 + r5 * 6.0;
    p.age   = r6 * 0.35;                 // 初始略为错开, 避免同时熄灭
    p.life  = 1.6 + r2 * 2.2;
    p.flick = r3 * 6.2831853;
    p.seed  = seed;
    p.color = emberPalette(hash11(k + 33.3) * 0.999);
    p._pad  = 0.0;
    return p;
}
