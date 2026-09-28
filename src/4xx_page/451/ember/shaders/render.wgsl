// ============================================================
// render.wgsl -- 实例化四边形绘制粒子 (加法混合)
// 每个粒子 = 1 个实例 = 6 个顶点 = 2 个三角形
// ============================================================

@group(0) @binding(0) var<storage, read> particles : array<Particle>;
@group(0) @binding(1) var<uniform> sim : SimUniforms;

// 环境底噪的每帧衰减系数. 粒子 pass 每帧都以透明黑 clear 掉目标纹理, 也不绑定
// 任何上一帧纹理, 因此这里并不存在帧间反馈; FADE_DECAY 只用来按 60Hz 归一化地
// 调制下面那份 AMBIENT 的强弱.
const FADE_DECAY : f32 = 0.868;
// 屏幕底部的暖色底噪
const AMBIENT : vec3<f32> = vec3<f32>(0.013, 0.0045, 0.0022);

struct VSOut {
    @builtin(position) pos : vec4<f32>,
    @location(0) uv       : vec2<f32>,
    @location(1) color    : vec3<f32>,
    @location(2) alpha    : f32,
    @location(3) soft     : f32,   // 大颗粒额外叠加的柔和外晕
    @location(4) screenUV : vec2<f32>, // 全屏 UV, 给底部暖色底噪用
};

// 0..5 -> 单位四边形两个三角形
fn cornerOf(vi : u32) -> vec2<f32> {
    switch (vi) {
        case 0u: { return vec2<f32>(-1.0, -1.0); }
        case 1u: { return vec2<f32>( 1.0, -1.0); }
        case 2u: { return vec2<f32>(-1.0,  1.0); }
        case 3u: { return vec2<f32>(-1.0,  1.0); }
        case 4u: { return vec2<f32>( 1.0, -1.0); }
        default: { return vec2<f32>( 1.0,  1.0); }
    }
}

@vertex
fn vs_main(@builtin(vertex_index) vi : u32,
           @builtin(instance_index) ii : u32) -> VSOut {
    let p = particles[ii];
    let corner = cornerOf(vi);

    // 寿命进度: 0 -> 刚重生, 1 -> 即将熄灭
    let t = clamp(p.age / max(p.life, 0.001), 0.0, 1.0);

    // 亮度收尾: 前 37.5% 生命保持满亮, 之后线性衰减到 0 (t = age/life,
    // 寿命约等于"升过一屏"的时间, 所以整屏亮度均匀)
    let fade = clamp((1.0 - t) * 1.6, 0.0, 1.0);
    let flicker = 0.82 + 0.18 * sin(sim.time * 3.0 + p.flick);
    // 刚重生时淡入, 避免突兀出现
    let birth = smoothstep(0.0, 0.12, t);

    var size = p.size * (1.0 - 0.35 * t);          // 生命末期逐渐缩小
    let haloScale = select(1.0, 1.7, p.size > 3.0); // 大颗粒多一圈光晕

    let radius = size * haloScale;
    let pixelDelta = corner * radius * sim.dpr;

    // 逻辑像素 -> NDC (y 轴翻转, 屏幕坐标原点在左上)
    let logical = p.pos + pixelDelta;
    let ndc = vec2<f32>(
        (logical.x / (sim.width * 0.5)) - 1.0,
        1.0 - (logical.y / (sim.height * 0.5))
    );

    var out : VSOut;
    out.pos      = vec4<f32>(ndc, 0.0, 1.0);
    out.uv       = corner;
    out.color    = p.color;
    out.alpha    = fade * flicker * birth * 0.85;
    out.soft     = select(0.0, 1.0, p.size > 3.0);
    out.screenUV = vec2<f32>(logical.x / sim.width, logical.y / sim.height);
    return out;
}

@fragment
fn fs_main(in : VSOut) -> @location(0) vec4<f32> {
    // 混合状态 (src-alpha, one): 输出 RGB 已按 alpha 预乘, 再与目标相加;
    // 目标每帧被 clear, 因此相加的只有本帧此前画下的火星与底噪.
    // dt 按 60Hz 折算, 保证 30/60/120Hz 屏幕上底噪的每帧增量一致
    let step = clamp(sim.dt, 0.0, 0.25) * 60.0;
    let ambient = AMBIENT * (0.30 + 0.70 * pow(1.0 - clamp(in.screenUV.y, 0.0, 1.0), 2.0)) * step;

    // ---- 本帧粒子: 柔和径向衰减 ----
    let d = length(in.uv);
    var a = 0.0;
    var ember = vec3<f32>(0.0);
    if (d <= 1.0) {
        let glow = pow(1.0 - d, 1.85);
        let core = vec3<f32>(1.0, 0.953, 0.749);          // #fff3bf 亮核
        let rgb = mix(in.color, core, smoothstep(0.75, 0.0, d) * 0.8);
        a = in.alpha * glow * 0.95;
        if (in.soft > 0.5) {
            a = a + in.alpha * pow(1.0 - d, 0.8) * 0.07;  // 大颗粒的柔和外晕
        }
        // 预热色: 中心偏白热, 边缘偏红; 乘 a 即为预乘 alpha
        ember = mix(vec3<f32>(1.0, 0.17, 0.0), rgb, glow) * a;
    }

    // 输出 = 本帧火星 + 环境底噪: keep = 1 - a 在本帧火星较亮处压暗底噪,
    // fade = FADE_DECAY^(dt*60) * dt 让底噪按固定步长归一化.
    // 这里不采样任何上一帧纹理, 目标每帧也被 clear, 所以不会累积出残影.
    let keep = 1.0 - a;
    let fade = pow(FADE_DECAY, step) * step;
    let color = ember + ambient * fade * keep;
    let alpha = a + fade * keep;
    return vec4<f32>(color, alpha);
}
