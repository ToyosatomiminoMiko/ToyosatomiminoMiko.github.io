/*
WGSL 着色器(地铁车窗)
- vs_main:全屏四边形顶点着色器
- fs_main:合成 窗外实景 / 玻璃污渍 / 窗内雾气 / 车厢灯光

struct GlassParams 由 Rust 侧 src/glass_params.rs 生成并注入,
不要在本文件重复声明,以免与 Rust 字段清单漂移.

> 水珠(物理 / 折射 / 高光 / 背景景深)已经整体拆到仓库根目录的
> `water_droplet_demo/`,本文件不再有任何水珠相关的绑定或分支.

贴图通道语义(与 src/textures.rs 的生成代码是一份契约,改一边要改另一边):
- textureBG / Far / Mid / Near:城市美术素材,RGB = 颜色,A = 该层不透明度;
  Far / Mid / Near 的 RGB 是**预乘 alpha** 的(合成写成 c*(1-a) + rgb,见 fs_main);
- textureDirt:RGB = 污渍的"乘性颜色"(接近 1 的暖灰,不是遮罩),A = 浓度,
  所以下面写的是 c * dirt.rgb;
- textureFog / textureInterior:RGB = 颜色,A = 浓度;
- 用 textureSampler 采样的程序化贴图都必须在 x 上可平铺(u 方向是 Repeat),
  否则会出现贯穿画面,随 time 缓慢横扫的竖直硬缝.
- 所有贴图都是单级(没有 mip 链):城市层的视差只改采样坐标,不需要缩小过滤.
*/
struct Uniforms {
    time: f32,
    styleId: u32,
    // 对齐填充(凑满 16 字节),着色器里不读.
    _padding0: f32,
    _padding1: f32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

// 车窗玻璃参数:车速 / 背景层距离 / 污渍 / 雾气 / 车厢灯光,
// 内存布局与字段名由 Rust 侧 GlassParams::WGSL_DECL 生成并注入.
@group(0) @binding(3) var<uniform> glassParams: GlassParams;

@group(0) @binding(10) var textureSampler: sampler;
@group(0) @binding(11) var textureBG: texture_2d<f32>;
@group(0) @binding(12) var textureFar: texture_2d<f32>;
@group(0) @binding(13) var textureMid: texture_2d<f32>;
@group(0) @binding(14) var textureNear: texture_2d<f32>;
@group(0) @binding(15) var textureDirt: texture_2d<f32>;
@group(0) @binding(16) var textureFog: texture_2d<f32>;
@group(0) @binding(17) var textureInterior: texture_2d<f32>;

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

fn applyStyle(c: vec3f, uv: vec2f, time: f32, id: u32) -> vec3f {
    var col = c;
    if (id == 0u) {
        // 东京的电车:暖色钨丝灯 + 旧胶片青色暗部
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

    // Layer 0: 窗外实景,多层城市按不同速度滚动.
    // 速度 = 基础速度 × 车速倍率 / 该层距离;
    // 距离滑块越大,该层看起来越远,滚动越慢.
    let uvFar = uv
        + vec2f(
            time * 0.012 * glassParams.vehicle_speed / glassParams.far_distance,
            0.0,
        );
    let uvMid = uv
        + vec2f(
            time * 0.045 * glassParams.vehicle_speed / glassParams.mid_distance,
            0.0,
        );
    let uvNear = uv
        + vec2f(
            time * 0.14 * glassParams.vehicle_speed / glassParams.near_distance,
            0.0,
        );

    var c = textureSample(textureBG, textureSampler, uv).rgb;
    let far = textureSample(textureFar, textureSampler, uvFar);
    let mid = textureSample(textureMid, textureSampler, uvMid);
    let near = textureSample(textureNear, textureSampler, uvNear);
    // 远景/中景/近景的 RGB 是**预乘 alpha** 的(见 textures.rs 的 premultiply_alpha):
    // 这批 PNG 的透明像素是 (0,0,0,0),直乘 alpha 的图在建筑轮廓外会渗出一圈黑边.
    c = c * (1.0 - far.a) + far.rgb;
    c = c * (1.0 - mid.a) + mid.rgb;
    c = c * (1.0 - near.a) + near.rgb;

    c = applyStyle(c, uv, time, uniforms.styleId);

    // Layer 2: 玻璃杂质与污渍
    // dirt.rgb 是污渍的"乘性颜色"(接近 1 的暖灰,不是遮罩),dirt.a 是浓度;
    // 贴图由 generate_dirt 生成,三种污渍(污渍/划痕/灰尘)都已混进这个颜色里.
    // 坐标放大 2 倍后 v 会超过 1,而 textureSampler 的 v 是 ClampToEdge:
    // 不折回的话下半屏会一直采到贴图最后一行,被水平拉成一道竖条纹,
    // 所以先 fract 折回 [0,1);generate_dirt 的贴图双向可平铺,折回处无缝.
    let dirtUv = fract(uv * vec2f(2.0, 2.0));
    let dirt = textureSample(textureDirt, textureSampler, dirtUv);
    c = mix(c, c * dirt.rgb, dirt.a * glassParams.dirt_opacity);

    // Layer 3: 窗内雾气(冷凝水汽)
    // 同理:u 被 time 无限向右推(不折回会在平铺点留下一条竖缝),
    // v 也会被推过 1(1.3 倍 => 画面 77% 以下会被 ClampToEdge 拉伸成横条),
    // 两个方向都靠 fract 折回 + generate_fog 的双向平铺解决.
    let fogUv = fract(uv * vec2f(1.6, 1.3) + vec2f(time * 0.004, -time * 0.002));
    let fog = textureSample(textureFog, textureSampler, fogUv);
    c = mix(
        c,
        vec3f(fog.rgb * 0.80 + 0.20),
        fog.a * glassParams.fog_opacity,
    );

    // Layer 4: 窗内灯光与乘客倒影
    let interiorUv = uv + vec2f(sin(time * 0.4 + uv.y * 4.0) * 0.002, 0.0);
    let interior = textureSample(textureInterior, textureSampler, interiorUv);
    let flicker = 0.92 + 0.08 * sin(time * 3.0 + uv.x * 40.0);
    c = mix(
        c,
        interior.rgb,
        interior.a * flicker * glassParams.interior_opacity,
    );
    c = c + interior.rgb * interior.a * glassParams.interior_opacity * 0.18;

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
