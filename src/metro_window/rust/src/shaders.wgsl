/*
WGSL 着色器
- vs_main:全屏四边形顶点着色器
- cs_main:水滴物理模拟(出界重置/重力/滑动)
- cs_refraction:按像素记录"归哪颗水珠管"(圆心 / 归一化距离 / 偏移大小)
- fs_main:合成 窗外实景 / 折射虚像 / 污渍 / 雾气 / 车厢灯光

struct DropletParams 由 Rust 侧 src/droplet_params.rs 生成并注入,
不要在本文件重复声明,以免与 Rust 字段清单漂移.

水滴形状统一在"各向同性空间"里判定(uv.x 先乘上 uniform 的 aspect),
否则 [0,1]² 的 uv 会把正圆拉成画布宽高比倍的椭圆;
半径也因此定义在"画布高度"尺度上.详见 toIsotropic 上方的注释.

折射偏移拆成两半:cs_refraction 只存"可无损重建"的三个量(圆心 / 归一化距离 s /
偏移大小),真正的偏移量由 fs_main 用 lateralProfile(s) 逐像素解析算出.
这样水珠边缘的清晰度不再受低分辨率偏移图限制(详见 cs_refraction 上方注释).

贴图通道语义(与 src/textures.rs 的生成代码是一份契约,改一边要改另一边):
- textureBG / Far / Mid / Near:城市美术素材,RGB = 颜色,A = 该层不透明度;
- textureDirt:RGB = 污渍的"乘性颜色"(接近 1 的暖灰,不是遮罩),A = 浓度,
  所以下面写的是 c * dirt.rgb;
- textureFog / textureInterior:RGB = 颜色,A = 浓度;
- 用 textureSampler 采样的程序化贴图都必须在 x 上可平铺(u 方向是 Repeat),
  否则会出现贯穿画面,随 time 缓慢横扫的竖直硬缝.
*/
struct Uniforms {
    time: f32,
    deltaTime: f32,
    styleId: u32,
    // 画布宽高比 = 画布宽 / 画布高,与 Rust `uniforms.rs` 的 `aspect` 一一对应.
    // 水滴要在屏幕上呈正圆就必须用它(见下面的 toIsotropic).
    aspect: f32,
};

struct Droplet {
    posVel: vec4f,
    radiusStrength: vec4f,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

// 水滴参数:生成 / 重置 / 物理 / 折射 / 高光全部可调值,
// 内存布局与字段名由 Rust 侧 DropletParams::WGSL_DECL 生成并注入.
@group(0) @binding(3) var<uniform> dropletParams: DropletParams;

// 计算着色器专用绑定
// 水滴数组长度 N = 64,必须与 Rust 里的 DROPLET_COUNT 保持一致.
@group(0) @binding(1) var<storage, read_write> droplets: array<Droplet, 64>;
@group(0) @binding(2) var refractionOffset: texture_storage_2d<rgba16float, write>;

// 片段着色器专用绑定
@group(0) @binding(10) var textureSampler: sampler;
@group(0) @binding(11) var textureBG: texture_2d<f32>;
@group(0) @binding(12) var textureFar: texture_2d<f32>;
@group(0) @binding(13) var textureMid: texture_2d<f32>;
@group(0) @binding(14) var textureNear: texture_2d<f32>;
@group(0) @binding(15) var textureDirt: texture_2d<f32>;
@group(0) @binding(16) var textureFog: texture_2d<f32>;
@group(0) @binding(17) var textureInterior: texture_2d<f32>;
@group(0) @binding(18) var textureRefraction: texture_2d<f32>;
@group(0) @binding(19) var refractionSampler: sampler;

struct VsOut {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
};

@vertex
fn vs_main(@location(0) pos: vec2f, @location(1) uv: vec2f) -> VsOut {
    var out: VsOut;
    out.position = vec4f(pos, 0.0, 1.0);
    out.uv = uv;
    return out;
}

// 整数哈希随机数,用于水滴出界重置.
//   散列公式:x = seed.x * A + seed.y * B + C
//             z = (x XOR (x >> 16)) * D
//             r = float(z >> 8) / 2^24
//   A/B/D 是散射用大奇数,C 是种子偏移;
//   >> 8 取高 24 位,2^24 = 16777216 用于归一化到 [0, 1).
fn rand(v: vec2u) -> f32 {
    // A = 747796405u:第一轮 x 分量乘法常数.
    let x = v.x * 747796405u + v.y * 2891336453u + 12345u;
    // B = 2891336453u:y 分量乘法常数;C = 12345u:基础种子偏移;
    // 16u:x 右移 16 位,与自身异或,做一次位扩散.
    let z = (x ^ (x >> 16u)) * 1274126177u;
    // D = 1274126177u:第二轮乘法常数,进一步打散低位;
    // 8u:取高 24 位;16777216.0 = 2^24 归一化到 [0, 1).
    return f32(z >> 8u) / 16777216.0;
}

// 水滴物理:重力 + 风 + 阻尼 + 出界重置.
// 每帧更新公式(Euler 积分):
//   dt = min(ΔT, dt_max)
//   v'  = (v + (g + w) * dt) * (1 - c_drag * dt)
//   p'  = p + v' * dt
@compute @workgroup_size(64) // 64 与 DROPLET_COUNT 一致,一个 workgroup 处理全部水滴
fn cs_main(@builtin(global_invocation_id) gid: vec3u) {
    let i = gid.x;
    if (i >= 64u) { // i 超出水滴总数 N = 64 时跳过
        return;
    }
    var d = droplets[i];
    // dt = min(ΔT, dt_max):
    //   dt_max 是单步最大时间(秒),即帧步长下限;
    //   防止页面切走/掉帧后 ΔT 过大,让 Euler 积分数值爆炸.
    let dt = min(uniforms.deltaTime, dropletParams.dt_max);
    // ===== 水滴物理参数 =====
    // 重力加速度 g = (0, gravity_y):
    //   0.0:水平方向没有重力分量;
    //   y 向下为正;数值越大下落越快.
    // gravity_scale:实时倍率,用于"下落速度"滑块.
    let gravity = vec2f(0.0, dropletParams.gravity_y * dropletParams.gravity_scale);
    // per = 水滴强度,来自 radiusStrength.y,
    // 同时影响风力个性与折射强度.
    let per = d.radiusStrength.y;
    // 实际半径 = 基础半径 × droplet_size,由"水滴大小"滑块实时缩放.
    let radius = d.radiusStrength.x * dropletParams.droplet_size;
    // 后吹风 w_back = -车速 × wind_backward_factor:
    //   车速越快,水滴被风向后吹得越明显(屏幕向左);
    // 横向风 w_x = w_back + A * sin(ω * t + φ) * wind_sway_scale:
    //   ω = wind_frequency_base + per * wind_frequency_per
    //   φ = i * wind_phase_step
    //   A = wind_amplitude_base + per * wind_amplitude_per
    let wind = vec2f(
        -dropletParams.vehicle_speed * dropletParams.wind_backward_factor
            + sin(
                uniforms.time
                    * (dropletParams.wind_frequency_base + per * dropletParams.wind_frequency_per)
                    + f32(i) * dropletParams.wind_phase_step,
            ) * (dropletParams.wind_amplitude_base + per * dropletParams.wind_amplitude_per)
                * dropletParams.wind_sway_scale,
        0.0 // y 方向不施加风,保持 0
    );
    var vel = d.posVel.zw;
    // v' = v + (g + w) * dt:先施加重力与风力(半隐式 Euler).
    vel = vel + (gravity + wind) * dt;
    // 线性空气阻力系数 c_drag = max(drag_min, drag_base - r * drag_radius_sensitivity):
    //   drag_min:阻力下限,防止大水滴完全无阻力;
    //   drag_base:基础阻力;
    //   drag_radius_sensitivity:半径灵敏度;
    //   即大水珠阻力小落得快,小水珠阻力大落得慢,避免全部同步下流.
    let drag = max(
        dropletParams.drag_min,
        dropletParams.drag_base - radius * dropletParams.drag_radius_sensitivity,
    );
    // v'' = v' * (1 - c_drag * dt):线性阻尼,阻力越大速度衰减越快.
    vel = vel * (1.0 - drag * dt);
    // p' = p + v'' * dt:按阻尼后的速度推进位置.
    var pos = d.posVel.xy + vel * dt;

    // 出界判定:四边各留 reset_margin 屏宽的余量,
    // 即 |坐标 - 0.5| > 0.5 + reset_margin 时重置,
    // 让水滴完全离开画面再重新进入,避免在边缘突然消失.
    if (pos.y < -dropletParams.reset_margin
        || pos.y > 1.0 + dropletParams.reset_margin
        || pos.x < -dropletParams.reset_margin
        || pos.x > 1.0 + dropletParams.reset_margin) {
        // 随机种子 = (水滴序号 + 序号偏移, 时间帧 + 时间偏移):
        //   时间帧 = floor(t * random_time_scale),每秒重新取随机数;
        //   每组偏移互不相同,使 r1~r6 互相独立.
        //   r1:基础随机流,序号/时间都不加偏移.
        let r1 = rand(vec2u(i, u32(uniforms.time * dropletParams.random_time_scale)));
        //   r2:序号偏移 131u/时间偏移 7u,与 r1 解耦.
        let r2 = rand(vec2u(
            i + 131u,
            u32(uniforms.time * dropletParams.random_time_scale) + 7u,
        ));
        //   r3:序号偏移 257u/时间偏移 13u.
        let r3 = rand(vec2u(
            i + 257u,
            u32(uniforms.time * dropletParams.random_time_scale) + 13u,
        ));
        //   r4:序号偏移 389u/时间偏移 23u.
        let r4 = rand(vec2u(
            i + 389u,
            u32(uniforms.time * dropletParams.random_time_scale) + 23u,
        ));
        // 重置位置(插值公式与初始值相同,只是 y 改为屏幕上方区域):
        //   x = spawn_x_min + r1 * spawn_x_span
        //   y = reset_y_min + r2 * reset_y_span:从屏幕上方重新进入.
        pos = vec2f(
            dropletParams.spawn_x_min + r1 * dropletParams.spawn_x_span,
            dropletParams.reset_y_min + r2 * dropletParams.reset_y_span,
        );
        // 重置速度(公式与初始值相同):
        //   vx = (r3 - 0.5) * velocity_x_span - 车速 × 后吹风系数
        //   vy = velocity_y_min + r4 * velocity_y_span
        vel = vec2f(
            (r3 - 0.5) * dropletParams.velocity_x_span
                - dropletParams.vehicle_speed * dropletParams.wind_backward_factor,
            dropletParams.velocity_y_min + r4 * dropletParams.velocity_y_span,
        );
        //   r5:序号偏移 521u/时间偏移 31u.
        let r5 = rand(vec2u(
            i + 521u,
            u32(uniforms.time * dropletParams.random_time_scale) + 31u,
        ));
        //   r6:序号偏移 677u/时间偏移 41u.
        let r6 = rand(vec2u(
            i + 677u,
            u32(uniforms.time * dropletParams.random_time_scale) + 41u,
        ));
        // 重置半径与强度(公式与初始值相同):
        //   r = radius_min + r5 * radius_span
        //   s = strength_min + r6 * strength_span
        //   最后两个 0.0 是预留分量.
        d.radiusStrength = vec4f(
            dropletParams.radius_min + r5 * dropletParams.radius_span,
            dropletParams.strength_min + r6 * dropletParams.strength_span,
            0.0,
            0.0,
        );
    }

    d.posVel = vec4f(pos, vel);
    droplets[i] = d;
}

// "无穷远"哨兵:归一化距离 s(= dist / radius)的初值.
// 半径最小的水珠在画面最远处 s 也只有个位数,取 1000 足够大到"任何水珠都更近".
const FAR_DISTANCE: f32 = 1000.0;

// 水滴轮廓的抗锯齿过渡带(用法见 fs_main 的 edgeWidth):
// EDGE_AA_SCALE:过渡带相对"1 个屏幕像素"的倍率.轮廓附近 s 沿半径方向线性变化,
//   梯度 ≈ 1/radius,所以 fwidth(s) 差不多就是"1 个屏幕像素"对应的 s 变化量;
//   1.0 对应总宽约 2 像素;调大 => 轮廓更柔(像蒙了层雾),调小 => 更硬.
// EDGE_AA_MIN:过渡带半宽的下限(无量纲).正常情况下不生效,只在 s 退化成常数
//   (附近没有水珠 / 正好在圆心,fwidth = 0)时兜底,避免 smoothstep 两端相等而除零.
const EDGE_AA_SCALE: f32 = 1.0;
const EDGE_AA_MIN: f32 = 0.0005;

// ===== 水滴的形状:uv 空间 -> 各向同性空间 =====
// uv ∈ [0,1]² 是归一化坐标:x 方向 1 个单位跨画布宽 W 像素,y 方向 1 个单位跨
// 画布高 H 像素,所以两根轴的"单位长度"不相等.直接比较 |Δuv| < r 时,屏幕上的
// 边界满足 (ΔX / (r·W))² + (ΔY / (r·H))² = 1,即一个半轴为 r·W × r·H 的椭圆:
// 16:9 画布上水珠横向被拉长 1.78 倍,看起来是扁的,不是水珠该有的正圆.
// 把 uv.x 乘上宽高比 aspect = W/H,两根轴的单位长度就都等于"画布高度",
// 再用欧氏距离判定,屏幕上的水滴才是正圆:
//   toIsotropic(uv) = (uv.x · aspect, uv.y).
// 半径也因此定义在"画布高度"这个尺度上:半径 r 的水珠直径 = 2r·H 像素
// (横向直径同样是 2r·H,而不是 2r·W).
fn toIsotropic(uv: vec2f) -> vec2f {
    return vec2f(uv.x * uniforms.aspect, uv.y);
}

// 各向同性空间的偏移 -> uv 偏移:x 方向除回 aspect.
// 折射偏移最终是直接加到 uv 上采样背景的(见 fs_main 的 uvBG),必须换回 uv 空间.
fn toUvOffset(offset: vec2f) -> vec2f {
    return vec2f(offset.x / uniforms.aspect, offset.y);
}

// 斯涅尔折射:把水滴当成球面水透镜,算出"沿圆心方向"的横向偏移量(标量,带符号).
// 球面单位法线 n = (dir2 * s, sqrt(1 - s²)),其中 s = dist / R ∈ [0, 1).
// 相对折射率 η = n_air / n_water = 1.0 / refraction_eta_water ≈ 0.7502.
// 斯涅尔向量公式:
//   k = 1 - η² * (1 - cos²θ_i) = 1 - η² * sin²θ_i
//   t = η * i - (η * cosθ_i + sqrt(k)) * n
// 横向偏移 lateral = t.xy / -t.z:把折射方向投影到 z = -1 平面.
// t.xy 恒与 dir2 平行(球面法线的水平分量只能是 dir2 方向),所以向量可以拆成
//
//   lateral = dir2 * lateralProfile(s)
//
// 这里只算后面那个标量(靠近轮廓处它会变号:光线被往反方向偏).
// 拆开的意义:偏移场对位置的依赖只剩"圆心方向"和 s,两者都能在片段着色器里
// 逐像素精确重建(圆心在一颗水珠内是常数,s 沿半径线性),于是低分辨率的折射
// 偏移图不再决定水珠边缘的清晰度 -- 它只负责"哪颗水珠管这个像素".
// 若 k ≤ 0 发生全反射,水滴边缘看不到窗外光线,返回无偏移.
fn lateralProfile(s: f32) -> f32 {
    // s ≥ 1:像素在水滴外.
    if (s >= 1.0) {
        return 0.0;
    }
    // nz = sqrt(max(0, 1 - s²)):单位球面在高度 s 处的 z 分量,
    // 来自球面方程 x² + y² + z² = 1;max 防止浮点误差产生负数.
    let nz = sqrt(max(0.0, 1.0 - s * s));
    // η = 1.0 / refraction_eta_water:空气折射率 1.0 除以水折射率.
    let eta = 1.0 / dropletParams.refraction_eta_water;
    // 入射光 i = (0, 0, -1),于是 cosθ_i = n · i = -nz,
    // 判别式 k = 1 - η²(1 - cos²θ_i) 化简成 1 - η² s².
    let k = 1.0 - eta * eta * s * s;
    if (k <= 0.0) {
        return 0.0;
    }
    let sqrtK = sqrt(k);
    // t.xy 的标量部分 = (η·nz - sqrt(k))·s;
    // -t.z = η·s² + sqrt(k)·nz,lateral_z_epsilon 防止 t.z ≈ 0 时除零.
    let denominator = max(eta * s * s + sqrtK * nz, dropletParams.lateral_z_epsilon);
    return (eta * nz - sqrtK) * s / denominator;
}

// 低分辨率折射偏移图:只负责回答"这个像素归哪颗水珠管,以及它离圆心多远",
// 真正的折射偏移由片段着色器逐像素解析算出来(见 fs_main).
//
// 为什么这么拆:偏移场 = dir2 * lateralProfile(s) * 半径强度(见 lateralProfile),
// 其中 "圆心" 在一颗水珠内是常数,"s" 沿半径线性,两者都能从低分辨率图里无损
// 重建;而"最终偏移向量"是随位置快速变化的量,直接把它按 1/8 分辨率存进纹理,
// 再双线性放大,会把水珠轮廓上原本圆滑的弧线压成 8 像素一级的方块(实测:同一颗
// 水珠,1/8 分辨率的偏移图把建物边缘的圆弧挤成矩形,全分辨率则是圆滑弧线).
// 所以这里只存可无损重建的三个量,边缘清晰度就不再受这个分辨率影响.
@compute @workgroup_size(8, 8, 1) // 每个 workgroup 处理 8×8 个低分辨率像素
fn cs_refraction(@builtin(global_invocation_id) gid: vec3u) {
    let dims = textureDimensions(refractionOffset);
    if (gid.x >= dims.x || gid.y >= dims.y) {
        return;
    }
    // 像素中心坐标:uv = (gid + 0.5) / dims,0.5 用于对齐纹素中心.
    let uv = (vec2f(gid.xy) + 0.5) / vec2f(dims);
    // 胜出的水珠:取"归一化距离最小"的那颗 = 旧实现的"覆盖度最强",
    // 多颗重叠时只留一颗,避免把偏移叠加糊成一大片.
    var winnerCenter = vec2f(0.0);
    var winnerS = FAR_DISTANCE;
    // winnerMagnitude = 半径 × 强度放大因子,即偏移向量的整体大小.
    var winnerMagnitude = 0.0;
    // 遍历全部 64 颗水滴,与 DROPLET_COUNT 保持一致.
    for (var i = 0u; i < 64u; i = i + 1u) {
        let d = droplets[i];
        let radius = d.radiusStrength.x * dropletParams.droplet_size;
        // radius_epsilon:半径过小直接跳过,避免无意义计算与除零.
        if (radius <= dropletParams.radius_epsilon) {
            continue;
        }
        // 距离换算到各向同性空间(见 toIsotropic),水珠才是正圆.
        let delta = toIsotropic(uv) - toIsotropic(d.posVel.xy);
        let s = length(delta) / radius;
        if (s < winnerS) {
            winnerS = s;
            winnerCenter = d.posVel.xy;
            // (1 + 强度 × refraction_strength_per) 是原来的强度放大因子,
            // 半径自动跟随 radiusStrength.x,强度自动跟随 radiusStrength.y.
            winnerMagnitude =
                radius * (1.0 + d.radiusStrength.y * dropletParams.refraction_strength_per);
        }
    }
    // 通道语义(与 fs_main 一一对应):
    //   rg = 胜出水珠的圆心(uv),b = 归一化距离 s,a = 偏移整体大小.
    textureStore(
        refractionOffset,
        vec2i(gid.xy),
        vec4f(winnerCenter, winnerS, winnerMagnitude),
    );
}

fn applyStyle(c: vec3f, uv: vec2f, time: f32, id: u32) -> vec3f {
    var col = c;
    if (id == 0u) {
        // 泡沫时期东京的电车:暖色钨丝灯 + 旧胶片青色暗部
        col = col * vec3f(1.12, 0.97, 0.82);
        col = mix(col, vec3f(0.72, 0.84, 0.95), col.b * 0.05);
        col = col + vec3f(0.055, 0.028, 0.008) * smoothstep(0.74, 0.30, distance(uv, vec2f(0.5, 0.48)));
    } else if (id == 1u) {
        // 赛博朋克:高对比/品红/青色霓虹/网格与扫描线
        col = (col - 0.5) * 1.35 + 0.5;
        col = mix(col, vec3f(0.98, 0.12, 0.55), 0.05 + 0.10 * (1.0 - col.g));
        col = mix(col, vec3f(0.0, 0.88, 1.0), 0.05 + 0.12 * col.b);
        let gx = abs(fract(uv.x * 9.0 - 0.5) - 0.5) / fwidth(uv.x * 9.0);
        let gy = abs(fract(uv.y * 6.0 - 0.5) - 0.5) / fwidth(uv.y * 6.0);
        let grid = 1.0 - smoothstep(0.5, 1.0, max(gx, gy));
        col = col + vec3f(1.0, 0.1, 0.8) * grid * 0.10;
        col = col + vec3f(0.0, 0.9, 1.0) * grid * 0.06;
        col = col * (1.0 - 0.12 * step(0.5, fract(uv.y * 480.0)));
    } else {
        // 上海磁悬浮:冷白高速感 + 速度线
        col = col * vec3f(0.92, 0.99, 1.12);
        col = mix(col, vec3f(0.90, 0.96, 1.00), 0.18);
        let speed = pow(1.0 - abs(fract(uv.y * 22.0 + time * 2.2) * 2.0 - 1.0), 16.0);
        col = col + vec3f(0.75, 0.90, 1.0) * speed * 0.08;
    }
    return col;
}

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
    let time = uniforms.time;

    // Layer 1: 窗外虚像 - 折射偏移逐像素解析重建(斯涅尔折射)
    // 通道语义见 cs_refraction:rg = 胜出圆心,b = 归一化距离 s,a = 偏移整体大小.
    let refr = textureSample(textureRefraction, refractionSampler, uv);
    let center = refr.rg;
    let s = refr.b;
    let magnitude = refr.a;
    // ===== 边缘:把轮廓收敛成 1~2 像素宽的清晰边缘 =====
    // s = dist / radius:圆内 s < 1,圆外 s > 1.轮廓附近 s 沿半径方向线性变化,
    // 用屏幕空间导数 fwidth(s) 当过渡带半宽,过渡带就恒为"约 2 个屏幕像素",
    // 与折射偏移图的分辨率无关.
    // EDGE_AA_SCALE 决定过渡带相对 1 像素的倍率;EDGE_AA_MIN 兜底:s 在
    // "附近没有水珠"(恒为 FAR_DISTANCE)或正好落在圆心时导数为 0,
    // 而 smoothstep(e, e, x) 会除零算出 NaN.
    let edgeWidth = max(fwidth(s) * EDGE_AA_SCALE, EDGE_AA_MIN);
    let inside = 1.0 - smoothstep(1.0 - edgeWidth, 1.0 + edgeWidth, s);
    // 圆心方向:各向同性空间里从圆心指向当前像素的单位向量.
    // 圆心在一颗水珠内是常数(低分辨率采样得到的就是精确值),所以这个方向
    // 是逐像素精确的,不像"直接存偏移向量"那样被打成 8 像素的格子.
    let radial = toIsotropic(uv) - toIsotropic(center);
    let radialLength = length(radial);
    let dir2 = select(
        radial / radialLength,
        vec2f(0.0, 1.0),
        radialLength < dropletParams.radius_epsilon,
    );
    // 偏移 = 圆心方向 × 斯涅尔横向偏移量 × 整体大小 × 强度倍率,
    // 再换算回 uv 空间并限制上限(防止折射把画面拉得太远).
    let rawOffset =
        toUvOffset(dir2 * lateralProfile(s) * inside)
        * magnitude
        * dropletParams.refraction_scale;
    let offset = clamp(
        rawOffset,
        vec2f(-dropletParams.refraction_offset_clamp),
        vec2f(dropletParams.refraction_offset_clamp),
    );
    // 覆盖度 coverage = (1 - s)²(中心 1,边缘 0,二次衰减),
    // 只在圆内非零;公式与旧实现一致,只是现在由解析的 s 算出来,更平滑.
    let coverage = clamp(1.0 - s, 0.0, 1.0);
    let dropletCover = coverage * coverage;

    // Layer 0: 窗外实景,多层城市按不同速度滚动.
    // 速度 = 基础速度 × 车速倍率 / 该层距离;
    // 距离滑块越大,该层看起来越远,滚动越慢.
    let uvBG = uv + offset;
    let uvFar = uv
        + vec2f(
            time * 0.012 * dropletParams.vehicle_speed / dropletParams.far_distance,
            0.0,
        )
        + offset;
    let uvMid = uv
        + vec2f(
            time * 0.045 * dropletParams.vehicle_speed / dropletParams.mid_distance,
            0.0,
        )
        + offset;
    let uvNear = uv
        + vec2f(
            time * 0.14 * dropletParams.vehicle_speed / dropletParams.near_distance,
            0.0,
        )
        + offset;

    var c = textureSample(textureBG, textureSampler, uvBG).rgb;
    let far = textureSample(textureFar, textureSampler, uvFar);
    let mid = textureSample(textureMid, textureSampler, uvMid);
    let near = textureSample(textureNear, textureSampler, uvNear);
    c = mix(c, far.rgb, far.a);
    c = mix(c, mid.rgb, mid.a);
    c = mix(c, near.rgb, near.a);

    // 水滴边缘高光:
    //   edge = smoothstep(highlight_edge0, highlight_edge1, 1.0 - coverage)
    //   highlight_edge0:高光开始出现的阈值;
    //   highlight_edge1:高光达到饱和的阈值;
    //   1.0 - coverage:水滴中心接近 0,边缘接近 1.
    //   highlight_color_rgb:高光颜色;highlight_strength:叠加强度.
    let edge = smoothstep(
        dropletParams.highlight_edge0,
        dropletParams.highlight_edge1,
        1.0 - dropletCover,
    );
    c = mix(
        c,
        vec3f(
            dropletParams.highlight_color_r,
            dropletParams.highlight_color_g,
            dropletParams.highlight_color_b,
        ),
        edge * dropletParams.highlight_strength,
    );

    c = applyStyle(c, uv, time, uniforms.styleId);

    // Layer 2: 玻璃杂质与污渍
    // dirt.rgb 是污渍的"乘性颜色"(接近 1 的暖灰,不是遮罩),dirt.a 是浓度;
    // 贴图由 generate_dirt 生成,三种污渍(污渍/划痕/灰尘)都已混进这个颜色里.
    // 坐标放大 2 倍后 v 会超过 1,而 textureSampler 的 v 是 ClampToEdge:
    // 不折回的话下半屏会一直采到贴图最后一行,被水平拉成一道竖条纹,
    // 所以先 fract 折回 [0,1);generate_dirt 的贴图双向可平铺,折回处无缝.
    let dirtUv = fract(uv * vec2f(2.0, 2.0));
    let dirt = textureSample(textureDirt, textureSampler, dirtUv);
    c = mix(c, c * dirt.rgb, dirt.a * dropletParams.dirt_opacity);

    // Layer 3: 窗内雾气(冷凝水汽)
    // 同理:u 被 time 无限向右推(不折回会在平铺点留下一条竖缝),
    // v 也会被推过 1(1.3 倍 => 画面 77% 以下会被 ClampToEdge 拉伸成横条),
    // 两个方向都靠 fract 折回 + generate_fog 的双向平铺解决.
    let fogUv = fract(uv * vec2f(1.6, 1.3) + vec2f(time * 0.004, -time * 0.002));
    let fog = textureSample(textureFog, textureSampler, fogUv);
    c = mix(c, vec3f(fog.rgb * 0.80 + 0.20), fog.a * dropletParams.fog_opacity);

    // Layer 4: 窗内灯光与乘客倒影
    let interiorUv = uv + vec2f(sin(time * 0.4 + uv.y * 4.0) * 0.002, 0.0);
    let interior = textureSample(textureInterior, textureSampler, interiorUv);
    let flicker = 0.92 + 0.08 * sin(time * 3.0 + uv.x * 40.0);
    c = mix(
        c,
        interior.rgb,
        interior.a * flicker * dropletParams.interior_opacity,
    );
    c = c + interior.rgb * interior.a * dropletParams.interior_opacity * 0.18;

    // 车窗边框柔化
    let d = distance(uv, vec2f(0.5, 0.5));
    let frame = smoothstep(0.0, 0.035, uv.x)
              * smoothstep(1.0, 0.965, uv.x)
              * smoothstep(0.0, 0.035, uv.y)
              * smoothstep(1.0, 0.965, uv.y);
    c = c * frame + vec3f(0.015, 0.018, 0.025) * (1.0 - frame);
    c = c * (1.0 - smoothstep(0.48, 0.52, d) * 0.05);

    return vec4f(c, 1.0);
}
