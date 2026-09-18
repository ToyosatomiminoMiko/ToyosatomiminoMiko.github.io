/*
WGSL 着色器
- vs_main:全屏四边形顶点着色器
- cs_main:水滴物理模拟(出界重置/重力/滑动)
- cs_refraction:计算低分辨率斯涅尔折射偏移图
- fs_main:合成 窗外实景 / 折射虚像 / 污渍 / 雾气 / 车厢灯光

struct DropletParams 由 Rust 侧 src/droplet_params.rs 生成并注入,
不要在本文件重复声明,以免与 Rust 字段清单漂移.

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
    // 补齐到 16 字节:与 Rust `uniforms.rs` 的 `_padding` 一一对应.
    _padding: u32,
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

// 斯涅尔折射:把水滴当成球面水透镜,计算光线穿过后的横向偏移.
// 球面单位法线 n = (dir * s, sqrt(1 - s²)),其中 s = d/R ∈ [0,1).
// 相对折射率 η = n_air / n_water = 1.0 / refraction_eta_water ≈ 0.7502.
// 斯涅尔向量公式:
//   k = 1 - η² * (1 - cos²θ_i) = 1 - η² * sin²θ_i
//   t = η * i - (η * cosθ_i + sqrt(k)) * n
// 若 k ≤ 0 发生全反射,水滴边缘看不到窗外光线,返回无偏移.
fn dropletOffset(uv: vec2f, d: Droplet) -> vec2f {
    let delta = uv - d.posVel.xy;
    let dist = length(delta);
    let radius = d.radiusStrength.x * dropletParams.droplet_size;
    // radius_epsilon:半径过小时跳过,避免后续除零;dist >= radius 时像素在水滴外.
    if (dist >= radius || radius <= dropletParams.radius_epsilon) {
        return vec2f(0.0);
    }
    // s = dist / radius ∈ [0,1):0 = 水滴中心, 1 = 边缘.
    let s = dist / radius;
    // dir2:像素相对圆心的单位方向;dist < radius_epsilon 时取 (0,1)
    // 避免 0/0;radius_epsilon 是"圆心附近"的判定阈值.
    let dir2 = select(delta / dist, vec2f(0.0, 1.0), dist < dropletParams.radius_epsilon);
    // nz = sqrt(max(0, 1 - s²)):单位球面在高度 s 处的 z 分量,
    // 来自球面方程 x² + y² + z² = 1;max 防止浮点误差产生负数.
    let nz = sqrt(max(0.0, 1.0 - s * s));
    // n = (dir2 * s, nz) 是单位球面法线,长度 = sqrt(s² + nz²) = 1.
    let n = vec3f(dir2 * s, nz);
    // i:入射光方向,窗外光线沿 -z 射向眼睛.
    let i = vec3f(0.0, 0.0, -1.0);
    // η = 1.0 / refraction_eta_water:空气折射率 1.0 除以水折射率.
    let eta = 1.0 / dropletParams.refraction_eta_water;
    // cosθ_i = n · i:入射角余弦.
    let cosI = dot(n, i);
    // k = 1 - η² * (1 - cos²θ_i):斯涅尔公式的判别式.
    let k = 1.0 - eta * eta * (1.0 - cosI * cosI);
    if (k <= 0.0) {
        return vec2f(0.0);
    }
    // t = η * i - (η * cosθ_i + sqrt(k)) * n:折射光方向向量.
    let t = eta * i - (eta * cosI + sqrt(k)) * n;
    // lateral = t.xy / -t.z:把折射方向投影到 z = -1 平面,
    // 得到单位距离处的横向偏移;lateral_z_epsilon 防止 t.z ≈ 0 时除零.
    let lateral = t.xy / max(-t.z, dropletParams.lateral_z_epsilon);
    // 最终偏移 = lateral * R * (1 + s * refraction_strength_per) * refraction_scale:
    //   R = radius 把无量纲方向放大成 UV 偏移;
    //   (1 + s * refraction_strength_per):强度放大因子.
    //   refraction_scale:实时滑块控制的整体折射强度.
    //   半径自动跟随 radiusStrength.x,强度自动跟随 radiusStrength.y.
    return lateral
        * radius
        * (1.0 + d.radiusStrength.y * dropletParams.refraction_strength_per)
        * dropletParams.refraction_scale;
}

// 水滴覆盖度 coverage = (1 - s)²:
//   中心 s = 0 时为 1,边缘 s = 1 时为 0,二次衰减.
fn dropletCoverage(uv: vec2f, d: Droplet) -> f32 {
    let delta = uv - d.posVel.xy;
    let dist = length(delta);
    let radius = d.radiusStrength.x * dropletParams.droplet_size;
    if (dist >= radius) {
        return 0.0;
    }
    let s = dist / radius;
    let t = 1.0 - s;
    return t * t;
}

// 低分辨率折射偏移图:把水滴的折射写进纹理,
// 片段着色器只需一次采样,避免逐像素循环导致的卡顿.
@compute @workgroup_size(8, 8, 1) // 每个 workgroup 处理 8×8 个低分辨率像素
fn cs_refraction(@builtin(global_invocation_id) gid: vec3u) {
    let dims = textureDimensions(refractionOffset);
    if (gid.x >= dims.x || gid.y >= dims.y) {
        return;
    }
    // 像素中心坐标:uv = (gid + 0.5) / dims,0.5 用于对齐纹素中心.
    let uv = (vec2f(gid.xy) + 0.5) / vec2f(dims);
    var offset = vec2f(0.0);
    var coverage = 0.0;
    // 遍历全部 64 颗水滴,与 DROPLET_COUNT 保持一致.
    for (var i = 0u; i < 64u; i = i + 1u) {
        let d = droplets[i];
        let radius = d.radiusStrength.x * dropletParams.droplet_size;
        // radius_epsilon:半径过小直接跳过,避免无意义计算.
        if (radius <= dropletParams.radius_epsilon) {
            continue;
        }
        let delta = uv - d.posVel.xy;
        // AABB 快速剔除:圆心与当前像素的 x/y 距离任一个超过半径,
        // 就一定不在水滴内,直接跳过,避免对每颗水滴都做 length/sqrt.
        if (abs(delta.x) >= radius || abs(delta.y) >= radius) {
            continue;
        }
        // 取覆盖度最强的一颗水滴,而不是把所有水滴叠加,
        // 避免重叠区域糊成一大片.
        let o = dropletOffset(uv, d);
        let w = dropletCoverage(uv, d);
        if (w > coverage) {
            coverage = w;
            offset = o;
        }
    }
    // 偏移上限:offset = clamp(raw, -refraction_offset_clamp, refraction_offset_clamp),
    // 防止折射把画面拉得太远.
    offset = clamp(
        offset,
        vec2f(-dropletParams.refraction_offset_clamp),
        vec2f(dropletParams.refraction_offset_clamp),
    );
    textureStore(refractionOffset, vec2i(gid.xy), vec4f(offset, coverage, 1.0));
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

    // Layer 1: 窗外虚像 - 采样低分辨率折射偏移图(斯涅尔折射)
    let refr = textureSample(textureRefraction, refractionSampler, uv);
    let offset = refr.rg;
    let dropletCover = refr.b;

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
