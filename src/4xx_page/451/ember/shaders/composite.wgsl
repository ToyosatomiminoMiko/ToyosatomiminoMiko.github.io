// ============================================================
// composite.wgsl -- 把离屏图像合成到画布 (全屏三角形, 一次纹理采样)
//
// 采样的是乒乓两张离屏纹理里"上一帧写入的那张"(轮换见 index.ts 的 pingPong),
// 因此画布内容固定落后粒子 pass 一帧.
// 粒子 pass 每帧以透明黑 clear 自己的目标纹理, 只写入本帧粒子与底噪, 两张离屏
// 纹理之间不会累积; 这里只取采样结果的 RGB, alpha 直接输出 1.
// ============================================================

@group(0) @binding(0) var prevTex : texture_2d<f32>;
@group(0) @binding(1) var prevSampler : sampler;

struct VSOut {
    @builtin(position) pos : vec4<f32>,
    @location(0) uv        : vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vi : u32) -> VSOut {
    // 单个大三角形覆盖全屏, 无顶点缓冲
    var xy = array<vec2<f32>, 3>(
        vec2<f32>(-1.0, -3.0),
        vec2<f32>(-1.0,  1.0),
        vec2<f32>( 3.0,  1.0)
    );
    let p = xy[vi];
    var out : VSOut;
    out.pos = vec4<f32>(p, 0.0, 1.0);
    out.uv  = vec2<f32>((p.x + 1.0) * 0.5, (1.0 - p.y) * 0.5);
    return out;
}

@fragment
fn fs_main(in : VSOut) -> @location(0) vec4<f32> {
    let col = textureSample(prevTex, prevSampler, in.uv).rgb;
    return vec4<f32>(col, 1.0);
}
